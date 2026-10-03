import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthContext, AuthDependencies } from "../auth/http.js";
import { ApiError } from "../auth/errors.js";
import { decryptContact, normalizeContact } from "../auth/contact.js";
import { recordAudit } from "../auth/audit.js";
import { staffScope, ownerScope } from "../certificates/access.js";
import type { Identity } from "../registrations/identity.js";
import { lockEventForCommand } from "../events/private-links.js";
import { durableCommand } from "./command.js";
import { ensureDelivery, deliveryView, latestEmail } from "./intent.js";
import {
  createCertificateSender,
  type CertificateSender,
  type SendOutcome,
} from "./sender.js";

export class CertificateDeliveries {
  private processing = false;
  constructor(
    readonly deps: AuthDependencies,
    private sender: CertificateSender = createCertificateSender(deps.config),
  ) {}
  private tx<T>(action: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.deps.db.$transaction(action, { maxWait: 2000, timeout: 5000 });
  }
  async read(
    actor: AuthContext | Identity,
    eventId: string | null,
    id: string,
  ) {
    return this.tx(async (tx) => {
      if (eventId) await staffScope(tx, actor as AuthContext, eventId, id);
      else await ownerScope(tx, this.deps, actor as Identity, id);
      const cert = await tx.certificate.findUnique({
        where: { registrationId: id },
        select: { id: true },
      });
      const delivery = cert
        ? await tx.certificateDelivery.findUnique({
            where: { certificateId: cert.id },
          })
        : null;
      return delivery ? deliveryView(delivery) : null;
    });
  }
  enroll(
    actor: AuthContext,
    eventId: string,
    id: string,
    key: string,
    correlationId: string,
  ) {
    return durableCommand(
      this.deps,
      actor,
      eventId,
      "CERTIFICATE_DELIVERY",
      key,
      { registration_id: id },
      async (tx) => {
        await staffScope(tx, actor, eventId, id);
        const cert = await tx.certificate.findUnique({
          where: { registrationId: id },
          select: { id: true, status: true },
        });
        if (!cert || cert.status !== "ISSUED")
          throw new ApiError(
            409,
            "NOT_ISSUED",
            "An issued certificate is required",
          );
        const result = await ensureDelivery(tx, cert.id, correlationId);
        return {
          status: result.created ? 201 : 200,
          body: { delivery: deliveryView(result.delivery) },
        };
      },
    );
  }
  retry(
    actor: AuthContext,
    eventId: string,
    id: string,
    key: string,
    correlationId: string,
  ) {
    return durableCommand(
      this.deps,
      actor,
      eventId,
      "CERTIFICATE_DELIVERY_RETRY",
      key,
      { registration_id: id },
      async (tx) => {
        await staffScope(tx, actor, eventId, id);
        const cert = await tx.certificate.findUnique({
          where: { registrationId: id },
          select: { id: true, status: true },
        });
        const delivery = cert
          ? await tx.certificateDelivery.findUnique({
              where: { certificateId: cert.id },
            })
          : null;
        if (
          !delivery ||
          cert?.status !== "ISSUED" ||
          delivery.status !== "FAILED"
        )
          throw new ApiError(
            409,
            "DELIVERY_NOT_RETRYABLE",
            "Only a failed delivery for an issued certificate can be retried",
          );
        if (delivery.attemptCount >= 3)
          throw new ApiError(
            409,
            "ATTEMPT_LIMIT_REACHED",
            "Delivery attempt limit reached",
          );
        const updated = await tx.certificateDelivery.update({
          where: { id: delivery.id },
          data: {
            status: "PENDING",
            reasonCode: null,
            attemptCount: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        await tx.certificateDeliveryAttempt.create({
          data: {
            deliveryId: delivery.id,
            attemptNumber: updated.attemptCount,
          },
        });
        await recordAudit(tx, {
          actorKind: "ACCOUNT",
          actorUserId: actor.userId,
          eventId,
          action: "CERTIFICATE_DELIVERY_RETRY_REQUESTED",
          outcome: "SUCCESS",
          correlationId,
          metadata: {
            delivery_id: delivery.id,
            attempt_number: updated.attemptCount,
          },
        });
        return { status: 202, body: { delivery: deliveryView(updated) } };
      },
    );
  }
  async process(id: string) {
    if (this.processing) return;
    this.processing = true;
    try {
      const initial = await this.deps.db.certificateDelivery.findUnique({
        where: { id },
      });
      if (!initial || !["PENDING", "SENDING"].includes(initial.status)) return;
      const claimed = await this.tx(async (tx) => {
        await lockEventForCommand(tx, initial.eventId);
        const delivery = await tx.certificateDelivery.findUniqueOrThrow({
          where: { id },
        });
        const attempt = await tx.certificateDeliveryAttempt.findUniqueOrThrow({
          where: {
            deliveryId_attemptNumber: {
              deliveryId: id,
              attemptNumber: delivery.attemptCount,
            },
          },
        });
        const [clock] = await tx.$queryRaw<
          { now: Date }[]
        >`SELECT clock_timestamp() AS now`;
        const now = clock.now;
        if (delivery.status === "SENDING") {
          if (attempt.leaseExpiresAt && attempt.leaseExpiresAt <= now)
            await this.finish(
              tx,
              initial.eventId,
              attempt.id,
              id,
              "UNKNOWN",
              "SUBMISSION_OUTCOME_UNKNOWN",
              now,
            );
          return null;
        }
        if (delivery.status !== "PENDING") return null;
        const cert = await tx.certificate.findUniqueOrThrow({
          where: { id: delivery.certificateId },
        });
        const row = await tx.registration.findUniqueOrThrow({
          where: { id: cert.registrationId },
        });
        const email = await latestEmail(tx, row.userId);
        let recipient: string | undefined;
        let reason =
          cert.status === "REVOKED"
            ? "CERTIFICATE_REVOKED"
            : !email
              ? "NOT_DELIVERABLE"
              : null;
        if (!reason && email) {
          await tx.$queryRaw`SELECT id FROM "VerifiedContact" WHERE id=${email.id}::uuid AND "userId"=${row.userId}::uuid FOR SHARE`;
          try {
            recipient = normalizeContact(
              "EMAIL",
              decryptContact(email.encrypted, this.deps.config.contactKey),
              this.deps.config.contactKey,
            ).value;
          } catch {
            reason = "RECIPIENT_UNAVAILABLE";
          }
        }
        if (reason) {
          await this.finish(
            tx,
            initial.eventId,
            attempt.id,
            id,
            reason === "RECIPIENT_UNAVAILABLE" ? "FAILED" : "NOT_REQUIRED",
            reason,
            now,
          );
          return null;
        }
        const token = randomUUID();
        await tx.certificateDeliveryAttempt.update({
          where: { id: attempt.id },
          data: {
            status: "SENDING",
            recipientUserId: row.userId,
            recipientContactId: email!.id,
            encryptedRecipient: email!.encrypted,
            claimToken: token,
            fencingToken: { increment: 1 },
            leaseExpiresAt: new Date(now.getTime() + 30000),
            startedAt: now,
          },
        });
        await tx.certificateDelivery.update({
          where: { id },
          data: { status: "SENDING", lastAttemptAt: now, updatedAt: now },
        });
        await recordAudit(tx, {
          actorKind: "SYSTEM",
          eventId: initial.eventId,
          action: "CERTIFICATE_DELIVERY_SUBMISSION_AUTHORIZED",
          outcome: "SUCCESS",
          correlationId: attempt.id,
          metadata: {
            delivery_id: id,
            attempt_id: attempt.id,
            attempt_number: attempt.attemptNumber,
          },
        });
        return {
          attemptId: attempt.id,
          token,
          fence: attempt.fencingToken + 1n,
          recipient: recipient!,
          certificateNumber: cert.certificateNumber,
          pdf: cert.pdfBytes,
        };
      });
      if (!claimed) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let outcome: SendOutcome;
      try {
        outcome = await Promise.race([
          this.sender
            .send({
              attemptId: claimed.attemptId,
              recipient: claimed.recipient,
              certificateNumber: claimed.certificateNumber,
              pdf: claimed.pdf,
            })
            .catch(() => "UNKNOWN" as const),
          new Promise<SendOutcome>((resolve) => {
            timer = setTimeout(() => resolve("UNKNOWN"), 15000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      // SENDING is the durable authorization boundary. Revocation after that
      // commit must not suppress the actual outcome or authorize another send.
      await this.tx(async (tx) => {
        await lockEventForCommand(tx, initial.eventId);
        const current = await tx.certificateDeliveryAttempt.findUniqueOrThrow({
          where: { id: claimed.attemptId },
        });
        if (
          current.status !== "SENDING" ||
          current.claimToken !== claimed.token ||
          current.fencingToken !== claimed.fence
        )
          return;
        await this.finish(
          tx,
          initial.eventId,
          claimed.attemptId,
          id,
          outcome,
          outcome === "SENT"
            ? null
            : outcome === "FAILED"
              ? "SUBMISSION_REJECTED"
              : "SUBMISSION_OUTCOME_UNKNOWN",
          new Date(),
        );
      });
    } finally {
      this.processing = false;
    }
  }
  private async finish(
    tx: Prisma.TransactionClient,
    eventId: string,
    attemptId: string,
    id: string,
    status: string,
    reasonCode: string | null,
    now: Date,
  ) {
    await tx.certificateDeliveryAttempt.update({
      where: { id: attemptId },
      data: {
        status,
        reasonCode,
        claimToken: null,
        leaseExpiresAt: null,
        completedAt: now,
      },
    });
    await tx.certificateDelivery.update({
      where: { id },
      data: {
        status,
        reasonCode,
        updatedAt: now,
        sentAt: status === "SENT" ? now : null,
      },
    });
    await recordAudit(tx, {
      actorKind: "SYSTEM",
      eventId,
      action: "CERTIFICATE_DELIVERY_OUTCOME",
      outcome: status,
      correlationId: attemptId,
      metadata: {
        delivery_id: id,
        attempt_id: attemptId,
        reason_code: reasonCode,
      },
    });
  }
  async recover() {
    const expired = await this.deps.db.certificateDeliveryAttempt.findFirst({
      where: { status: "SENDING", leaseExpiresAt: { lte: new Date() } },
      orderBy: { leaseExpiresAt: "asc" },
    });
    const pending = await this.deps.db.certificateDelivery.findFirst({
      where: { status: "PENDING" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (expired) await this.process(expired.deliveryId);
    if (pending) await this.process(pending.id);
  }
}
