import type { Prisma, CertificateBatch, Registration } from "@prisma/client";
import { ApiError } from "../auth/errors.js";
import { recordAudit } from "../auth/audit.js";
import { activeEvent, evidence } from "../certificates/access.js";
import { RULE } from "../certificates/contract.js";
import {
  idempotencyKeyHash,
  requestFingerprint,
  COMMAND_REPLAY_RETENTION_MS,
} from "../events/command-safety.js";

// Called with the event lock held. Existing pending work retains its original
// cycle, command replay and execution policy; overlapping batches only observe it.
export async function batchIssueWork(
  tx: Prisma.TransactionClient,
  batch: CertificateBatch,
  row: Registration,
) {
  const previous = await tx.certificateIssueWork.findUnique({
    where: { registrationId: row.id },
  });
  if (previous?.status === "PENDING") return previous;
  const event = await tx.event.findUniqueOrThrow({
    where: { id: batch.eventId },
  });
  activeEvent(event.state);
  const source = await evidence(tx, row);
  if (!source)
    throw new ApiError(409, "NOT_ELIGIBLE", "Accepted attendance is required");
  const name = await tx.certificateRecipientName.findUnique({
    where: { registrationId: row.id },
  });
  if (!name)
    throw new ApiError(
      422,
      "NAME_MISSING",
      "The owner must set a recipient name",
    );
  if (!event.startAt || !event.timeZone)
    throw new ApiError(422, "VALIDATION", "Event schedule is unavailable");
  const replay = await tx.commandReplay.create({
    data: {
      actorUserId: batch.requestedByUserId,
      action: "CERTIFICATE_ISSUE",
      resourceKey: batch.eventId,
      idempotencyKeyHash: idempotencyKeyHash(`batch:${batch.id}:${row.id}`),
      requestFingerprint: requestFingerprint({
        batch_id: batch.id,
        registration_id: row.id,
      }),
      expiresAt: new Date(Date.now() + COMMAND_REPLAY_RETENTION_MS),
    },
  });
  const data = {
    commandReplayId: replay.id,
    executionByUserId: batch.requestedByUserId,
    executionSessionId: batch.acceptanceSessionId,
    executionBatchId: batch.id,
    correlationId: batch.correlationId,
    templateId: batch.templateId,
    templateVersion: batch.templateVersion,
    fontId: batch.fontId,
    eligibilityRuleVersion: RULE,
    attendanceTransitionId: source.id,
    firstAcceptedCheckInAt: source.acceptedAt,
    recipientName: name.name,
    recipientNameRevision: name.revision,
    eventName: event.name,
    eventStartAt: event.startAt,
    eventTimeZone: event.timeZone,
    retryAt: new Date(),
    updatedAt: new Date(),
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
          registrationId: row.id,
          eventId: batch.eventId,
          requestedByUserId: batch.requestedByUserId,
        },
      });
  await recordAudit(tx, {
    actorKind: "SYSTEM",
    actorUserId: batch.requestedByUserId,
    eventId: batch.eventId,
    action: "CERTIFICATE_BATCH_ISSUE_REQUESTED",
    outcome: "SUCCESS",
    correlationId: batch.correlationId,
    metadata: {
      batch_id: batch.id,
      registration_id: row.id,
      issue_work_id: work.id,
      generation_cycle: work.generationCycle,
    },
  });
  return work;
}
