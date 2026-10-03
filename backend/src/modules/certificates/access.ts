import {
  Prisma,
  type CertificateIssueWork,
  type Registration,
} from "@prisma/client";
import { ApiError } from "../auth/errors.js";
import type { AuthContext, AuthDependencies } from "../auth/http.js";
import {
  lockManagementEvent,
  validateManagementEventId,
} from "../events/management-command.js";
import { lockEventForCommand } from "../events/private-links.js";
import { lockIdentity, type Identity } from "../registrations/identity.js";
import { RULE } from "./contract.js";

export const missingRegistration = () =>
  new ApiError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
export async function ownerScope(
  tx: Prisma.TransactionClient,
  deps: AuthDependencies,
  identity: Identity,
  id: string,
) {
  try {
    validateManagementEventId(id);
  } catch {
    throw missingRegistration();
  }
  const initial = await tx.registration.findUnique({ where: { id } });
  if (
    !initial ||
    (identity.kind === "GUEST" &&
      identity.proof.contextEventId !== null &&
      identity.proof.contextEventId !== initial.eventId)
  )
    throw missingRegistration();
  await lockEventForCommand(tx, initial.eventId);
  await lockIdentity(tx, identity, deps, initial.eventId);
  const row = await tx.registration.findUniqueOrThrow({ where: { id } });
  if (
    identity.kind === "ACCOUNT"
      ? row.userId !== identity.actor.userId
      : !identity.id || row.guestIdentityId !== identity.id
  )
    throw missingRegistration();
  return {
    row,
    event: await tx.event.findUniqueOrThrow({ where: { id: row.eventId } }),
  };
}
export async function staffScope(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  eventId: string,
  registrationId?: string,
) {
  const { event } = await lockManagementEvent(tx, actor, eventId);
  if (!registrationId) return { event };
  const row = await tx.registration.findFirst({
    where: { id: registrationId, eventId },
  });
  if (!row) throw missingRegistration();
  return { event, row };
}
export function activeEvent(state: string) {
  if (state !== "LIVE" && state !== "COMPLETED")
    throw new ApiError(
      409,
      "EVENT_STATE_NOT_ALLOWED",
      "Certificate generation requires a Live or Completed event",
    );
}
// Durable batch authorization deliberately does not depend on an HTTP session.
// Current capability/assignment locks are still held through each worker commit.
export async function durableStaffScope(
  tx: Prisma.TransactionClient,
  userId: string,
  eventId: string,
) {
  if (!(await lockEventForCommand(tx, eventId)))
    throw new ApiError(404, "EVENT_NOT_FOUND", "Event not found");
  const users = await tx.$queryRaw<
    { organizerCapable: boolean }[]
  >`SELECT "organizerCapable" FROM "User" WHERE id=${userId}::uuid FOR SHARE`;
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId } });
  if (!(event.ownerUserId === userId && users[0]?.organizerCapable)) {
    const roles = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "EventRoleAssignment" WHERE "eventId"=${eventId}::uuid AND "userId"=${userId}::uuid AND role='EVENT_ADMIN' AND "revokedAt" IS NULL FOR SHARE`;
    if (!roles.length)
      throw new ApiError(
        409,
        "AUTHORITY_REVOKED",
        "Accepted work no longer has event authority",
      );
  }
  return event;
}
export async function workScope(
  tx: Prisma.TransactionClient,
  work: CertificateIssueWork,
) {
  if (!work.executionBatchId)
    return staffScope(
      tx,
      { userId: work.executionByUserId, sessionId: work.executionSessionId },
      work.eventId,
      work.registrationId,
    );
  const batch = await tx.certificateBatch.findUniqueOrThrow({
    where: { id: work.executionBatchId },
  });
  if (
    batch.eventId !== work.eventId ||
    batch.requestedByUserId !== work.executionByUserId
  )
    throw new ApiError(
      409,
      "AUTHORITY_REVOKED",
      "Invalid accepted work binding",
    );
  if (
    batch.status !== "RUNNING" ||
    !(await tx.certificateBatchItem.findFirst({
      where: {
        batchId: batch.id,
        issueWorkId: work.id,
        generationCycle: work.generationCycle,
        status: "RUNNING",
      },
    }))
  )
    throw new ApiError(
      409,
      "AUTHORITY_REVOKED",
      "Accepted work is no longer active",
    );
  const event = await durableStaffScope(
    tx,
    work.executionByUserId,
    work.eventId,
  );
  const row = await tx.registration.findFirst({
    where: { id: work.registrationId, eventId: work.eventId },
  });
  if (!row) throw missingRegistration();
  return { event, row };
}
export async function evidence(
  tx: Prisma.TransactionClient,
  row: Registration,
) {
  if (row.state !== "REGISTERED" || !row.firstAcceptedCheckInAt) return null;
  return tx.attendanceTransition.findFirst({
    where: {
      registrationId: row.id,
      eventId: row.eventId,
      kind: "CHECK_IN",
      acceptedAt: row.firstAcceptedCheckInAt,
    },
  });
}
export const certificateSelect = {
  id: true,
  registrationId: true,
  eventId: true,
  status: true,
  certificateNumber: true,
  templateId: true,
  templateVersion: true,
  fontId: true,
  eligibilityRuleVersion: true,
  attendanceTransitionId: true,
  firstAcceptedCheckInAt: true,
  issuedByUserId: true,
  issuedAt: true,
  revokedByUserId: true,
  revokedAt: true,
  revokeReason: true,
  pdfSha256: true,
} satisfies Prisma.CertificateSelect;
type Metadata = Prisma.CertificateGetPayload<{
  select: typeof certificateSelect;
}>;
export function certificateView(row: Metadata, staff = false) {
  return {
    certificate_id: row.id,
    certificate_number: row.certificateNumber,
    status: row.status,
    template_id: row.templateId,
    template_version: row.templateVersion,
    font_id: row.fontId,
    eligibility_rule_version: row.eligibilityRuleVersion,
    issued_at: row.issuedAt.toISOString(),
    revoked_at: row.revokedAt?.toISOString() ?? null,
    ...(staff
      ? {
          issued_by_user_id: row.issuedByUserId,
          revoked_by_user_id: row.revokedByUserId,
          revoke_reason: row.revokeReason,
          attendance_transition_id: row.attendanceTransitionId,
          first_accepted_check_in_at: row.firstAcceptedCheckInAt.toISOString(),
          pdf_sha256: row.pdfSha256,
        }
      : {}),
  };
}
export function workView(row: CertificateIssueWork) {
  return {
    issue_work_id: row.id,
    status: row.status,
    generation_cycle: row.generationCycle,
    attempt_count: row.attemptCount,
    requested_by_user_id: row.requestedByUserId,
    execution_by_user_id: row.executionByUserId,
    template_id: row.templateId,
    template_version: row.templateVersion,
    font_id: row.fontId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    retry_at: row.retryAt?.toISOString() ?? null,
    completed_at: row.completedAt?.toISOString() ?? null,
    failed_at: row.failedAt?.toISOString() ?? null,
    last_error_code: row.lastErrorCode,
    certificate_id: row.completedCertificateId,
  };
}
export async function statusView(
  tx: Prisma.TransactionClient,
  row: Registration,
  staff: boolean,
) {
  const name = await tx.certificateRecipientName.findUnique({
    where: { registrationId: row.id },
  });
  const cert = await tx.certificate.findUnique({
    where: { registrationId: row.id },
    select: certificateSelect,
  });
  return {
    event_id: row.eventId,
    registration_id: row.id,
    state:
      cert?.status ?? ((await evidence(tx, row)) ? "ELIGIBLE" : "NOT_ELIGIBLE"),
    eligibility_rule_version: RULE,
    recipient_name_set: name !== null,
    certificate: cert ? certificateView(cert, staff) : null,
    ...(staff
      ? {
          issue_work: await tx.certificateIssueWork
            .findUnique({ where: { registrationId: row.id } })
            .then((work) => (work ? workView(work) : null)),
        }
      : {
          recipient_name: name?.name ?? null,
          recipient_name_updated_at: name?.updatedAt.toISOString() ?? null,
          recipient_name_locked: cert !== null,
        }),
  };
}
