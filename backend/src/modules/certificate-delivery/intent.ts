import type { Prisma, CertificateDelivery } from "@prisma/client";
import { recordAudit } from "../auth/audit.js";

export async function latestEmail(
  tx: Prisma.TransactionClient,
  userId: string | null,
) {
  return userId
    ? tx.verifiedContact.findFirst({
        where: { userId, type: "EMAIL" },
        orderBy: [{ verifiedAt: "desc" }, { id: "asc" }],
      })
    : null;
}
export async function ensureDelivery(
  tx: Prisma.TransactionClient,
  certificateId: string,
  correlationId: string,
) {
  const existing = await tx.certificateDelivery.findUnique({
    where: { certificateId },
  });
  if (existing) return { delivery: existing, created: false };
  const cert = await tx.certificate.findUniqueOrThrow({
    where: { id: certificateId },
    select: { id: true, eventId: true, registrationId: true, status: true },
  });
  const row = await tx.registration.findUniqueOrThrow({
    where: { id: cert.registrationId },
  });
  const email = await latestEmail(tx, row.userId);
  const reasonCode =
    cert.status === "REVOKED"
      ? "CERTIFICATE_REVOKED"
      : !email
        ? "NOT_DELIVERABLE"
        : null;
  const delivery = await tx.certificateDelivery.create({
    data: {
      certificateId,
      eventId: cert.eventId,
      status: reasonCode ? "NOT_REQUIRED" : "PENDING",
      reasonCode,
      attemptCount: reasonCode ? 0 : 1,
    },
  });
  if (!reasonCode)
    await tx.certificateDeliveryAttempt.create({
      data: { deliveryId: delivery.id, attemptNumber: 1 },
    });
  await recordAudit(tx, {
    actorKind: "SYSTEM",
    eventId: cert.eventId,
    action: "CERTIFICATE_DELIVERY_REQUESTED",
    outcome: "SUCCESS",
    correlationId,
    metadata: {
      delivery_id: delivery.id,
      certificate_id: cert.id,
      reason_code: reasonCode,
    },
  });
  return { delivery, created: true };
}
export function deliveryView(row: CertificateDelivery) {
  return {
    delivery_id: row.id,
    certificate_id: row.certificateId,
    status: row.status,
    reason_code: row.reasonCode,
    attempt_count: row.attemptCount,
    max_attempts: 3,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    last_attempt_at: row.lastAttemptAt?.toISOString() ?? null,
    sent_at: row.sentAt?.toISOString() ?? null,
  };
}
