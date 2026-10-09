import { randomUUID } from "node:crypto";
import { Prisma, type Event, type Registration } from "@prisma/client";
import QRCode from "qrcode";
import type { AuthDependencies } from "../auth/http.js";
import { ApiError } from "../auth/errors.js";
import { recordAudit } from "../auth/audit.js";
import { executeIdempotentCommand } from "../events/command-safety.js";
import { managementAvailability } from "../events/availability.js";
import {
  lockEventForCommand,
  privateLinkKeys,
  privateLinkVerifierMatches,
} from "../events/private-links.js";
import { validateManagementEventId } from "../events/management-command.js";
import { issueCredential, recoverCredential } from "./credential.js";
import {
  auditActor,
  commandActor,
  identityWhere,
  lockIdentity,
  type Identity,
} from "./identity.js";

const missing = () =>
  new ApiError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
const eventMissing = () =>
  new ApiError(404, "EVENT_NOT_FOUND", "Event not found");
const conflict = (code: string, message: string) =>
  new ApiError(409, code, message);
export function registrationView(row: Registration, event: Event, own = true) {
  return {
    registration_id: row.id,
    event_id: row.eventId,
    state: row.state,
    relationship: own ? "own" : "managed",
    created_at: row.createdAt.toISOString(),
    cancelled_at: row.cancelledAt?.toISOString() ?? null,
    event_state: event.state,
    cancellation_cutoff_at:
      (
        event.registrationCancellationCutoffAt ?? event.startAt
      )?.toISOString() ?? null,
  };
}
async function lockedEvent(
  tx: Prisma.TransactionClient,
  identity: Identity,
  deps: AuthDependencies,
  eventId: string,
) {
  validateManagementEventId(eventId);
  if (
    identity.kind === "GUEST" &&
    identity.proof.contextEventId !== null &&
    identity.proof.contextEventId !== eventId
  )
    throw eventMissing();
  if (!(await lockEventForCommand(tx, eventId))) throw eventMissing();
  const organizer = await lockIdentity(tx, identity, deps, eventId);
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId } });
  return { event, organizer };
}
async function privateAccess(
  tx: Prisma.TransactionClient,
  event: Event,
  proof: string | undefined,
  deps: AuthDependencies,
) {
  if (event.visibility !== "PRIVATE") return;
  const active = await tx.privateAccessLink.findFirst({
    where: { eventId: event.id, revokedAt: null },
  });
  const key = privateLinkKeys(deps.config.contactKey).verifier;
  if (
    event.state !== "PUBLISHED" ||
    !active ||
    active.verifierKeyVersion !== key.version ||
    !proof ||
    !privateLinkVerifierMatches(proof, active.verifierHash, key)
  )
    throw eventMissing();
}
export async function register(
  deps: AuthDependencies,
  identity: Identity,
  eventId: string,
  proof: string | undefined,
  key: string,
  correlationId: string,
) {
  validateManagementEventId(eventId);
  let event: Event;
  return executeIdempotentCommand(
    deps.db,
    {
      ...commandActor(identity),
      action: "REGISTRATION_CREATE",
      resourceKey: `event:${eventId}`,
      idempotencyKey: key,
      request: {},
    },
    async (tx) => {
      // This check is independent of the configuration-only policy object.
      if (event.state === "CANCELLED")
        throw conflict("EVENT_CANCELLED", "Event cancelled");
      if (event.state !== "PUBLISHED")
        throw conflict(
          "REGISTRATION_CLOSED",
          "Event does not accept registrations",
        );
      const now = new Date(),
        availability = managementAvailability(event, now);
      if (availability.reasons.includes("NOT_OPEN_YET"))
        throw conflict("REGISTRATION_NOT_OPEN", "Registration has not opened");
      if (availability.policy_status !== "OPEN")
        throw conflict("REGISTRATION_CLOSED", "Registration is closed");
      if (
        await tx.registration.findFirst({
          where: { eventId, state: "REGISTERED", ...identityWhere(identity) },
        })
      )
        throw conflict(
          "DUPLICATE_ACTIVE",
          "You already have an active registration",
        );
      if (
        event.registrationCapacity === null ||
        (await tx.registration.count({
          where: { eventId, state: "REGISTERED" },
        })) >= event.registrationCapacity
      )
        throw conflict("CAPACITY_FULL", "Registration capacity reached");
      const row = await tx.registration.create({
        data: {
          id: randomUUID(),
          eventId,
          userId: identity.kind === "ACCOUNT" ? identity.actor.userId : null,
          guestIdentityId: identity.kind === "GUEST" ? identity.id : null,
          createdAt: now,
        },
      });
      await tx.qRCredential.create({
        data: {
          registrationId: row.id,
          ...issueCredential(row.id, deps.config.contactKey),
        },
      });
      await recordAudit(tx, {
        ...auditActor(identity),
        eventId,
        action: "REGISTRATION_CREATED",
        outcome: "SUCCESS",
        correlationId,
        metadata: { registration_id: row.id },
      });
      return {
        status: 201,
        body: { registration: registrationView(row, event) },
      };
    },
    async (tx) => {
      ({ event } = await lockedEvent(tx, identity, deps, eventId));
      await privateAccess(tx, event, proof, deps);
      if (event.state === "DRAFT" || event.visibility === null)
        throw eventMissing();
    },
  );
}
async function scopedRegistration(
  tx: Prisma.TransactionClient,
  deps: AuthDependencies,
  identity: Identity,
  id: string,
  ownerOnly = false,
) {
  try {
    validateManagementEventId(id);
  } catch {
    throw missing();
  }
  const initial = await tx.registration.findUnique({ where: { id } });
  if (!initial) throw missing();
  if (
    identity.kind === "GUEST" &&
    identity.proof.contextEventId !== null &&
    identity.proof.contextEventId !== initial.eventId
  )
    throw missing();
  const { event, organizer } = await lockedEvent(
    tx,
    identity,
    deps,
    initial.eventId,
  );
  const row = await tx.registration.findUniqueOrThrow({ where: { id } });
  const own =
    identity.kind === "ACCOUNT"
      ? row.userId === identity.actor.userId
      : identity.id !== null && row.guestIdentityId === identity.id;
  let staff = false;
  if (!ownerOnly && identity.kind === "ACCOUNT") {
    staff = organizer && event.ownerUserId === identity.actor.userId;
    if (!staff) {
      const assignments = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "EventRoleAssignment" WHERE "eventId" = ${event.id}::uuid AND "userId" = ${identity.actor.userId}::uuid AND role = 'EVENT_ADMIN' AND "revokedAt" IS NULL FOR SHARE`;
      staff = assignments.length > 0;
    }
  }
  if (!own && !staff) throw missing();
  return { row, event, own, staff };
}
export async function ownLatest(
  deps: AuthDependencies,
  identity: Identity,
  eventId: string,
  proof: string | undefined,
  correlationId: string,
) {
  return deps.db.$transaction(
    async (tx) => {
      const { event } = await lockedEvent(tx, identity, deps, eventId);
      const row = await tx.registration.findFirst({
        where: { eventId, ...identityWhere(identity) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      // Ownership recovers history even when the discovery link no longer grants viewing.
      if (!row) {
        await privateAccess(tx, event, proof, deps);
        if (event.state === "DRAFT" || event.visibility === null)
          throw eventMissing();
      }
      if (row)
        await recordAudit(tx, {
          ...auditActor(identity),
          eventId,
          action: "REGISTRATION_VIEWED",
          outcome: "SUCCESS",
          correlationId,
          metadata: { registration_id: row.id },
        });
      return { registration: row ? registrationView(row, event) : null };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}
export async function readRegistration(
  deps: AuthDependencies,
  identity: Identity,
  id: string,
  correlationId: string,
) {
  return deps.db.$transaction(
    async (tx) => {
      const { row, event, own } = await scopedRegistration(
        tx,
        deps,
        identity,
        id,
      );
      await recordAudit(tx, {
        ...auditActor(identity),
        eventId: event.id,
        action: "REGISTRATION_VIEWED",
        outcome: "SUCCESS",
        correlationId,
        metadata: { registration_id: id },
      });
      return { registration: registrationView(row, event, own) };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}
export async function cancel(
  deps: AuthDependencies,
  identity: Identity,
  id: string,
  key: string,
  correlationId: string,
) {
  try {
    validateManagementEventId(id);
  } catch {
    throw missing();
  }
  let scope: Awaited<ReturnType<typeof scopedRegistration>>;
  return executeIdempotentCommand(
    deps.db,
    {
      ...commandActor(identity),
      action: "REGISTRATION_CANCEL",
      resourceKey: `registration:${id}`,
      idempotencyKey: key,
      request: {},
    },
    async (tx) => {
      const { row, event, staff, own } = scope;
      if (row.state === "CANCELLED")
        return {
          status: 200,
          body: { registration: registrationView(row, event, own) },
        };
      const now = new Date(),
        cutoff = event.registrationCancellationCutoffAt ?? event.startAt;
      if (!staff && (!cutoff || now >= cutoff))
        throw conflict(
          "CANCELLATION_CUTOFF_REACHED",
          "Cancellation cutoff reached",
        );
      const updated = await tx.registration.update({
        where: { id },
        data: {
          state: "CANCELLED",
          cancelledAt: now,
          cancelledActorKind: identity.kind,
          cancelledByUserId:
            identity.kind === "ACCOUNT" ? identity.actor.userId : null,
        },
      });
      await tx.qRCredential.updateMany({
        where: { registrationId: id, revokedAt: null },
        data: { revokedAt: now, protectedRepresentation: null },
      });
      await recordAudit(tx, {
        ...auditActor(identity),
        eventId: event.id,
        action: "REGISTRATION_CANCELLED",
        outcome: "SUCCESS",
        correlationId,
        metadata: { registration_id: id },
      });
      return {
        status: 200,
        body: { registration: registrationView(updated, event, own) },
      };
    },
    async (tx) => {
      scope = await scopedRegistration(tx, deps, identity, id);
      if (scope.row.firstAcceptedCheckInAt !== null)
        throw conflict(
          "ALREADY_CHECKED_IN",
          "A checked-in registration cannot be cancelled",
        );
      if (
        identity.kind === "GUEST" &&
        identity.proof.issuedAt * 1000 <= scope.row.createdAt.getTime()
      )
        throw new ApiError(
          403,
          "FRESH_GUEST_PROOF_REQUIRED",
          "Verify again to cancel this registration",
        );
    },
  );
}
export async function credential(
  deps: AuthDependencies,
  identity: Identity,
  id: string,
  correlationId: string,
) {
  return deps.db.$transaction(
    async (tx) => {
      const { row } = await scopedRegistration(tx, deps, identity, id, true);
      const current = await tx.qRCredential.findFirst({
        where: { registrationId: id, revokedAt: null },
      });
      if (row.state !== "REGISTERED" || !current?.protectedRepresentation)
        throw new ApiError(
          410,
          "CREDENTIAL_REVOKED",
          "Credential no longer active",
        );
      if (current.expiresAt && current.expiresAt <= new Date())
        throw new ApiError(410, "CREDENTIAL_EXPIRED", "Credential expired");
      if (current.keyVersion !== 1)
        throw new Error("Unsupported credential key");
      const token = recoverCredential(
        id,
        current.protectedRepresentation,
        deps.config.contactKey,
      );
      const qrSvg = await QRCode.toString(token, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 4,
      });
      await recordAudit(tx, {
        ...auditActor(identity),
        eventId: row.eventId,
        action: "CREDENTIAL_VIEWED",
        outcome: "SUCCESS",
        correlationId,
        metadata: { registration_id: id, credential_id: current.id },
      });
      return {
        credential_id: current.id,
        registration_id: id,
        status: "ACTIVE",
        expires_at: current.expiresAt?.toISOString() ?? null,
        qr_svg: qrSvg,
        entry_code: token,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}
