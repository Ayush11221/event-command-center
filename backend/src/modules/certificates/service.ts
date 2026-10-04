import { createHash, randomUUID } from "node:crypto";
import { operation } from "../../observability/telemetry.js";
import { Prisma, type CertificateIssueWork } from "@prisma/client";
import { ApiError, unavailable } from "../auth/errors.js";
import type { AuthContext, AuthDependencies } from "../auth/http.js";
import { recordAudit } from "../auth/audit.js";
import {
  executeIdempotentCommand,
  idempotencyKeyHash,
  requestFingerprint,
  COMMAND_REPLAY_RETENTION_MS,
} from "../events/command-safety.js";
import { lockEventForCommand } from "../events/private-links.js";
import {
  auditActor,
  commandActor,
  type Identity,
} from "../registrations/identity.js";
import {
  activeEvent,
  certificateSelect,
  certificateView,
  evidence,
  ownerScope,
  staffScope,
  statusView,
  workView,
  workScope,
} from "./access.js";
import { ensureDelivery } from "../certificate-delivery/intent.js";
import { RULE, issueDate, type Selection } from "./contract.js";
import { renderPdf, rendererAvailable, type Renderer } from "./renderer.js";
import type { RenderInput } from "./pdf.js";

type Tx = Prisma.TransactionClient;
type Body = Record<string, unknown>;
export interface Result {
  status: number;
  body: Body;
}
const conflict = (code: string) =>
  new ApiError(
    409,
    code,
    "Certificate operation is not available in the current state",
  );
async function clock(tx: Tx) {
  const [row] = await tx.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  return row.now;
}
async function lockWork(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "CertificateIssueWork" WHERE id = ${id}::uuid FOR UPDATE`;
  return tx.certificateIssueWork.findUniqueOrThrow({ where: { id } });
}
const inputFor = (work: CertificateIssueWork): RenderInput => ({
  template_id: work.templateId as Selection["template_id"],
  template_version: 1,
  font_id: work.fontId as Selection["font_id"],
  recipientName: work.recipientName,
  eventName: work.eventName,
  eventStartAt: work.eventStartAt.toISOString(),
  eventTimeZone: work.eventTimeZone,
  issuedAt: work.generationStartedAt!.toISOString(),
  certificateNumber: work.id,
  preview: false,
});

export class CertificateService {
  private processing = false;
  constructor(
    readonly deps: AuthDependencies,
    private render: Renderer = renderPdf,
  ) {}
  private tx<T>(action: (tx: Tx) => Promise<T>) {
    return this.deps.db.$transaction(action, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 2000,
      timeout: 5000,
    });
  }
  async ownerStatus(identity: Identity, id: string, correlationId: string) {
    return this.tx(async (tx) => {
      const { row } = await ownerScope(tx, this.deps, identity, id);
      await recordAudit(tx, {
        ...auditActor(identity),
        eventId: row.eventId,
        action: "CERTIFICATE_STATUS_VIEWED",
        outcome: "SUCCESS",
        correlationId,
        metadata: { registration_id: id },
      });
      return statusView(tx, row, false);
    });
  }
  async staffStatus(
    actor: AuthContext,
    eventId: string,
    id: string,
    correlationId: string,
  ) {
    return this.tx(async (tx) => {
      const { row } = await staffScope(tx, actor, eventId, id);
      await recordAudit(tx, {
        actorKind: "ACCOUNT",
        actorUserId: actor.userId,
        eventId,
        action: "CERTIFICATE_STATUS_VIEWED",
        outcome: "SUCCESS",
        correlationId,
        metadata: { registration_id: id },
      });
      return statusView(tx, row!, true);
    });
  }
  async setName(
    identity: Identity,
    id: string,
    name: string,
    key: string,
    correlationId: string,
  ) {
    // Derive the event without granting access; authorize again inside the replay transaction.
    const initial = await this.deps.db.registration.findUnique({
      where: { id },
    });
    if (!initial)
      throw new ApiError(
        404,
        "REGISTRATION_NOT_FOUND",
        "Registration not found",
      );
    return executeIdempotentCommand(
      this.deps.db,
      {
        ...commandActor(identity),
        action: "CERTIFICATE_RECIPIENT_NAME",
        resourceKey: initial.eventId,
        idempotencyKey: key,
        request: { registration_id: id, recipient_name: name },
      },
      async (tx) => {
        const { row } = await ownerScope(tx, this.deps, identity, id);
        if (row.state === "CANCELLED") throw conflict("ALREADY_CANCELLED");
        if (
          await tx.certificate.findUnique({
            where: { registrationId: id },
            select: { id: true },
          })
        )
          throw conflict("NAME_LOCKED");
        const previous = await tx.certificateRecipientName.findUnique({
          where: { registrationId: id },
        });
        const current =
          previous?.name === name
            ? previous
            : await tx.certificateRecipientName.upsert({
                where: { registrationId: id },
                create: { registrationId: id, eventId: row.eventId, name },
                update: {
                  name,
                  revision: { increment: 1 },
                  updatedAt: await clock(tx),
                },
              });
        await recordAudit(tx, {
          ...auditActor(identity),
          eventId: row.eventId,
          action: previous
            ? "CERTIFICATE_NAME_CHANGED"
            : "CERTIFICATE_NAME_SET",
          outcome: "SUCCESS",
          correlationId,
          metadata: { registration_id: id },
        });
        return {
          status: 200,
          body: {
            event_id: row.eventId,
            registration_id: id,
            recipient_name_set: true,
            updated_at: current.updatedAt.toISOString(),
          },
        };
      },
      async (tx) => {
        await ownerScope(tx, this.deps, identity, id);
      },
    );
  }
  async preview(
    actor: AuthContext,
    eventId: string,
    id: string,
    selected: Selection,
  ) {
    const snapshot = await this.tx(async (tx) => {
      const { event } = await staffScope(tx, actor, eventId, id);
      activeEvent(event.state);
      const name = await tx.certificateRecipientName.findUnique({
        where: { registrationId: id },
      });
      if (!name)
        throw new ApiError(
          422,
          "NAME_MISSING",
          "The owner must set a certificate recipient name",
        );
      if (!event.startAt || !event.timeZone)
        throw new ApiError(422, "VALIDATION", "Event schedule is unavailable");
      return { name, event, now: await clock(tx) };
    });
    const bytes = await this.render({
      ...selected,
      recipientName: snapshot.name.name,
      eventName: snapshot.event.name,
      eventStartAt: snapshot.event.startAt!.toISOString(),
      eventTimeZone: snapshot.event.timeZone!,
      issuedAt: snapshot.now.toISOString(),
      certificateNumber: "PREVIEW",
      preview: true,
    });
    await this.tx(async (tx) => {
      const { event } = await staffScope(tx, actor, eventId, id);
      activeEvent(event.state);
      const current = await tx.certificateRecipientName.findUnique({
        where: { registrationId: id },
      });
      if (
        !current ||
        current.revision !== snapshot.name.revision ||
        event.name !== snapshot.event.name ||
        event.startAt?.getTime() !== snapshot.event.startAt?.getTime() ||
        event.timeZone !== snapshot.event.timeZone
      )
        throw conflict("VERSION_CONFLICT");
    });
    return bytes;
  }
  async artifact(identity: Identity, id: string, correlationId: string) {
    return this.tx(async (tx) => {
      const { row } = await ownerScope(tx, this.deps, identity, id);
      const cert = await tx.certificate.findUnique({
        where: { registrationId: id },
      });
      if (!cert || cert.status !== "ISSUED")
        throw new ApiError(
          404,
          "CERTIFICATE_NOT_FOUND",
          "Certificate not found",
        );
      await recordAudit(tx, {
        ...auditActor(identity),
        eventId: row.eventId,
        action: "CERTIFICATE_ARTIFACT_VIEWED",
        outcome: "SUCCESS",
        correlationId,
        metadata: { certificate_id: cert.id, registration_id: id },
      });
      return { bytes: cert.pdfBytes, number: cert.certificateNumber };
    });
  }
  async revoke(
    actor: AuthContext,
    eventId: string,
    id: string,
    reason: string | null,
    key: string,
    correlationId: string,
  ) {
    return executeIdempotentCommand(
      this.deps.db,
      {
        actorUserId: actor.userId,
        action: "CERTIFICATE_REVOKE",
        resourceKey: eventId,
        idempotencyKey: key,
        request: { registration_id: id, reason },
      },
      async (tx) => {
        const cert = await tx.certificate.findUnique({
          where: { registrationId: id },
          select: certificateSelect,
        });
        if (!cert) throw conflict("NOT_ISSUED");
        if (cert.status === "REVOKED") throw conflict("ALREADY_REVOKED");
        const updated = await tx.certificate.update({
          where: { id: cert.id },
          data: {
            status: "REVOKED",
            revokedByUserId: actor.userId,
            revokedAt: await clock(tx),
            revokeReason: reason,
          },
          select: certificateSelect,
        });
        await recordAudit(tx, {
          actorKind: "ACCOUNT",
          actorUserId: actor.userId,
          eventId,
          action: "CERTIFICATE_REVOKED",
          outcome: "SUCCESS",
          correlationId,
          metadata: { certificate_id: cert.id, registration_id: id, reason },
        });
        return {
          status: 200,
          body: { certificate: certificateView(updated, true) },
        };
      },
      async (tx) => {
        await staffScope(tx, actor, eventId, id);
      },
    );
  }
  async issue(
    actor: AuthContext,
    eventId: string,
    id: string,
    selected: Selection,
    key: string,
    correlationId: string,
  ): Promise<Result> {
    const hash = idempotencyKeyHash(key),
      fingerprint = requestFingerprint({ registration_id: id, ...selected });
    const accepted = await this.tx(async (tx) => {
      const { event, row } = await staffScope(tx, actor, eventId, id);
      const existing = await tx.commandReplay.findFirst({
        where: {
          actorUserId: actor.userId,
          action: "CERTIFICATE_ISSUE",
          resourceKey: eventId,
          idempotencyKeyHash: hash,
        },
      });
      const now = await clock(tx);
      if (existing) {
        if (existing.requestFingerprint !== fingerprint)
          throw conflict("IDEMPOTENCY_CONFLICT");
        if (existing.status === "COMPLETED") {
          if (existing.expiresAt <= now)
            throw new ApiError(
              410,
              "CERTIFICATE_REPLAY_EXPIRED",
              "Inspect current certificate status",
            );
          return {
            replay: {
              status: existing.responseStatus!,
              body: existing.responseBody as Body,
            },
          };
        }
        const work = await tx.certificateIssueWork.findUnique({
          where: { commandReplayId: existing.id },
        });
        if (!work) throw unavailable();
        return { work };
      }
      const cert = await tx.certificate.findUnique({
        where: { registrationId: id },
        select: certificateSelect,
      });
      if (cert)
        throw new ApiError(
          409,
          "ALREADY_ISSUED",
          "A certificate already exists",
          {
            details: {
              certificate_id: cert.id,
              certificate_number: cert.certificateNumber,
              status: cert.status,
            },
          },
        );
      const previous = await tx.certificateIssueWork.findUnique({
        where: { registrationId: id },
      });
      if (previous?.status === "PENDING")
        throw new ApiError(
          409,
          "ISSUE_IN_PROGRESS",
          "Observe the existing issue work",
          { details: { issue_work_id: previous.id } },
        );
      activeEvent(event.state);
      const source = await evidence(tx, row!);
      if (!source) throw conflict("NOT_ELIGIBLE");
      const name = await tx.certificateRecipientName.findUnique({
        where: { registrationId: id },
      });
      if (!name)
        throw new ApiError(
          422,
          "NAME_MISSING",
          "The owner must set a certificate recipient name",
        );
      if (!event.startAt || !event.timeZone)
        throw new ApiError(422, "VALIDATION", "Event schedule is unavailable");
      const replay = await tx.commandReplay.create({
        data: {
          actorUserId: actor.userId,
          action: "CERTIFICATE_ISSUE",
          resourceKey: eventId,
          idempotencyKeyHash: hash,
          requestFingerprint: fingerprint,
          expiresAt: new Date(now.getTime() + COMMAND_REPLAY_RETENTION_MS),
        },
      });
      const data = {
        commandReplayId: replay.id,
        executionByUserId: actor.userId,
        executionSessionId: actor.sessionId,
        executionBatchId: null,
        correlationId,
        templateId: selected.template_id,
        templateVersion: selected.template_version,
        fontId: selected.font_id,
        eligibilityRuleVersion: RULE,
        attendanceTransitionId: source.id,
        firstAcceptedCheckInAt: source.acceptedAt,
        recipientName: name.name,
        recipientNameRevision: name.revision,
        eventName: event.name,
        eventStartAt: event.startAt,
        eventTimeZone: event.timeZone,
        retryAt: now,
        updatedAt: now,
      };
      const work = previous
        ? await tx.certificateIssueWork.update({
            where: { id: previous.id },
            data: {
              ...data,
              status: "PENDING",
              generationCycle: { increment: 1 },
              attemptCount: 0,
              claimToken: null,
              leaseExpiresAt: null,
              lastErrorCode: null,
              lastErrorAt: null,
              failedAt: null,
              generationStartedAt: null,
            },
          })
        : await tx.certificateIssueWork.create({
            data: {
              ...data,
              registrationId: id,
              eventId,
              requestedByUserId: actor.userId,
            },
          });
      await this.audit(
        tx,
        work,
        previous
          ? "CERTIFICATE_GENERATION_RECOVERY_REQUESTED"
          : "CERTIFICATE_ISSUE_REQUESTED",
        "SUCCESS",
      );
      return { work };
    });
    if (accepted.replay) return accepted.replay;
    const work = accepted.work!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.process(work.id),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    // Recheck requesting authority before returning any outcome, including an asynchronous completion.
    return this.tx(async (tx) => {
      await staffScope(tx, actor, eventId, id);
      const replay = await tx.commandReplay.findUniqueOrThrow({
        where: { id: work.commandReplayId },
      });
      if (replay.status === "COMPLETED")
        return {
          status: replay.responseStatus!,
          body: replay.responseBody as Body,
        };
      return {
        status: 202,
        body: {
          issue_work: workView(
            await tx.certificateIssueWork.findUniqueOrThrow({
              where: { id: work.id },
            }),
          ),
        },
      };
    });
  }
  private async audit(
    tx: Tx,
    work: CertificateIssueWork,
    action: string,
    outcome: string,
    code?: string,
  ) {
    await recordAudit(tx, {
      actorKind: action.endsWith("REQUESTED") ? "ACCOUNT" : "SYSTEM",
      actorUserId: work.executionByUserId,
      eventId: work.eventId,
      action,
      outcome,
      correlationId: work.correlationId,
      metadata: {
        registration_id: work.registrationId,
        issue_work_id: work.id,
        requested_by_user_id: work.requestedByUserId,
        generation_cycle: work.generationCycle,
        attempt_count: work.attemptCount,
        fencing_token: work.fencingToken.toString(),
        template_id: work.templateId,
        template_version: work.templateVersion,
        font_id: work.fontId,
        eligibility_rule_version: work.eligibilityRuleVersion,
        attendance_transition_id: work.attendanceTransitionId,
        ...(code ? { code } : {}),
      },
    });
  }
  private async terminal(
    tx: Tx,
    work: CertificateIssueWork,
    error: ApiError,
    now: Date,
  ) {
    await tx.certificateIssueWork.update({
      where: { id: work.id },
      data: {
        status: "FAILED",
        failedAt: now,
        updatedAt: now,
        lastErrorCode: error.code,
        lastErrorAt: now,
        retryAt: null,
        claimToken: null,
        leaseExpiresAt: null,
      },
    });
    await this.audit(
      tx,
      work,
      "CERTIFICATE_GENERATION_FAILED",
      "FAILED",
      error.code,
    );
    await tx.commandReplay.update({
      where: { id: work.commandReplayId },
      data: {
        status: "COMPLETED",
        completedAt: now,
        expiresAt: new Date(now.getTime() + COMMAND_REPLAY_RETENTION_MS),
        responseStatus: error.status,
        responseBody: {
          code: error.code,
          message: "Certificate generation did not complete",
          retryable: false,
        },
      },
    });
  }
  private validClaim(
    current: CertificateIssueWork,
    claimed: CertificateIssueWork,
    now: Date,
  ) {
    return (
      current.status === "PENDING" &&
      current.claimToken === claimed.claimToken &&
      current.fencingToken === claimed.fencingToken &&
      current.leaseExpiresAt !== null &&
      current.leaseExpiresAt > now
    );
  }
  async process(id: string): Promise<void> {
    if (this.processing || (this.render === renderPdf && !rendererAvailable()))
      return;
    this.processing = true;
    try {
      const snapshot = await this.deps.db.certificateIssueWork.findUnique({
        where: { id },
      });
      if (!snapshot || snapshot.status !== "PENDING") return;
      const claimed = await this.tx(async (tx) => {
        await lockEventForCommand(tx, snapshot.eventId);
        const work = await lockWork(tx, id),
          now = await clock(tx);
        if (
          work.status !== "PENDING" ||
          (work.leaseExpiresAt && work.leaseExpiresAt > now) ||
          (work.retryAt && work.retryAt > now)
        )
          return null;
        try {
          const { event, row } = await workScope(tx, work);
          activeEvent(event.state);
          if (!(await evidence(tx, row!))) throw conflict("NOT_ELIGIBLE");
          if (work.attemptCount >= 3) throw unavailable();
          const name = await tx.certificateRecipientName.findUniqueOrThrow({
            where: { registrationId: work.registrationId },
          });
          const updated = await tx.certificateIssueWork.update({
            where: { id },
            data: {
              claimToken: randomUUID(),
              fencingToken: { increment: 1 },
              attemptCount: { increment: 1 },
              leaseExpiresAt: new Date(now.getTime() + 10000),
              retryAt: null,
              generationStartedAt: now,
              updatedAt: now,
              recipientName: name.name,
              recipientNameRevision: name.revision,
              eventName: event.name,
              eventStartAt: event.startAt!,
              eventTimeZone: event.timeZone!,
            },
          });
          await this.audit(
            tx,
            updated,
            "CERTIFICATE_GENERATION_CLAIMED",
            "SUCCESS",
          );
          return updated;
        } catch (error) {
          if (!(error instanceof ApiError)) throw error;
          await this.terminal(tx, work, error, now);
          return null;
        }
      });
      if (!claimed) return;
      try {
        const bytes = await this.render(inputFor(claimed));
        await this.tx(async (tx) => {
          await lockEventForCommand(tx, claimed.eventId);
          const current = await lockWork(tx, id);
          if (!this.validClaim(current, claimed, await clock(tx))) return;
          const { event, row } = await workScope(tx, claimed);
          activeEvent(event.state);
          const source = await evidence(tx, row!);
          if (!source || source.id !== claimed.attendanceTransitionId)
            throw conflict("NOT_ELIGIBLE");
          const name = await tx.certificateRecipientName.findUniqueOrThrow({
            where: { registrationId: claimed.registrationId },
          });
          const now = await clock(tx);
          if (
            name.revision !== claimed.recipientNameRevision ||
            name.name !== claimed.recipientName ||
            event.name !== claimed.eventName ||
            event.startAt?.getTime() !== claimed.eventStartAt.getTime() ||
            event.timeZone !== claimed.eventTimeZone ||
            issueDate(now, claimed.eventTimeZone) !==
              issueDate(claimed.generationStartedAt!, claimed.eventTimeZone)
          )
            throw conflict("VERSION_CONFLICT");
          if (!this.validClaim(current, claimed, now)) return;
          const cert = await tx.certificate.create({
            data: {
              id,
              registrationId: claimed.registrationId,
              eventId: claimed.eventId,
              certificateNumber: id,
              recipientName: claimed.recipientName,
              templateId: claimed.templateId,
              templateVersion: claimed.templateVersion,
              fontId: claimed.fontId,
              eligibilityRuleVersion: RULE,
              attendanceTransitionId: claimed.attendanceTransitionId,
              firstAcceptedCheckInAt: claimed.firstAcceptedCheckInAt,
              pdfBytes: Uint8Array.from(bytes),
              pdfSha256: createHash("sha256").update(bytes).digest("hex"),
              issuedByUserId: claimed.executionByUserId,
              issuedAt: now,
            },
            select: certificateSelect,
          });
          await tx.certificateIssueWork.update({
            where: { id },
            data: {
              status: "COMPLETED",
              completedCertificateId: id,
              completedAt: now,
              updatedAt: now,
              retryAt: null,
              claimToken: null,
              leaseExpiresAt: null,
              lastErrorCode: null,
              lastErrorAt: null,
            },
          });
          await this.audit(tx, claimed, "CERTIFICATE_ISSUED", "SUCCESS");
          await ensureDelivery(tx, cert.id, claimed.correlationId);
          await tx.commandReplay.update({
            where: { id: claimed.commandReplayId },
            data: {
              status: "COMPLETED",
              responseStatus: 201,
              responseBody: { certificate: certificateView(cert, true) },
              completedAt: now,
              expiresAt: new Date(now.getTime() + COMMAND_REPLAY_RETENTION_MS),
            },
          });
        });
      } catch (error) {
        // A lost DB commit acknowledgement is unknown. Never overwrite durable state on that guess.
        if (!(error instanceof ApiError)) throw unavailable();
        await this.tx(async (tx) => {
          await lockEventForCommand(tx, claimed.eventId);
          const current = await lockWork(tx, id),
            now = await clock(tx);
          if (!this.validClaim(current, claimed, now)) return;
          if (
            (error.status === 503 || error.code === "VERSION_CONFLICT") &&
            current.attemptCount < 3
          ) {
            await tx.certificateIssueWork.update({
              where: { id },
              data: {
                claimToken: null,
                leaseExpiresAt: null,
                retryAt: new Date(
                  now.getTime() + (current.attemptCount === 1 ? 1000 : 5000),
                ),
                lastErrorCode: error.code,
                lastErrorAt: now,
                updatedAt: now,
              },
            });
            await this.audit(
              tx,
              current,
              "CERTIFICATE_GENERATION_RETRY_SCHEDULED",
              "FAILED",
              error.code,
            );
          } else await this.terminal(tx, current, error, now);
        });
      }
    } finally {
      this.processing = false;
    }
  }
  async recover() {
    const [now] = await this.deps.db.$queryRaw<
      { now: Date }[]
    >`SELECT clock_timestamp() AS now`;
    const work = await this.deps.db.certificateIssueWork.findFirst({
      where: {
        status: "PENDING",
        OR: [
          { retryAt: { lte: now.now } },
          { leaseExpiresAt: { lte: now.now } },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    if (work) await this.process(work.id);
  }
}

export function startCertificateRecovery(
  service: CertificateService,
  onUnavailable: (err: unknown) => void,
) {
  let stopped = false,
    pending: Promise<void> | undefined;
  const tick = () => {
    if (stopped || pending) return;
    pending = operation("certificate_recovery", () => service.recover())
      .catch(onUnavailable)
      .finally(() => {
        pending = undefined;
      });
  };
  tick();
  const timer = setInterval(tick, 1000);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await pending;
  };
}
