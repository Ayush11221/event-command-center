import type { Request } from "express";
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  authenticate,
  cookie,
  requireCsrf,
  requireOrigin,
  type AuthContext,
  type AuthDependencies,
} from "../auth/http.js";
import { validCsrfToken, verifyGuestProof } from "../auth/tokens.js";
import { ApiError } from "../auth/errors.js";
import { recordAudit } from "../auth/audit.js";
import { lockCommandActor } from "../events/management-command.js";

export type Identity =
  | { kind: "ACCOUNT"; actor: AuthContext }
  | {
      kind: "GUEST";
      id: string | null;
      token: string;
      proof: Awaited<ReturnType<typeof verifyGuestProof>>;
    };
const unauthenticated = () =>
  new ApiError(401, "UNAUTHENTICATED", "Verification required");
export async function registrationIdentity(
  request: Request,
  deps: AuthDependencies,
  mutation: boolean,
): Promise<Identity> {
  // A current account wins when both cookies exist; never silently switch an account command to a guest.
  if (cookie(request, "eoc_session")) {
    const actor = await authenticate(request, deps);
    if (mutation) requireCsrf(request, actor, deps);
    return { kind: "ACCOUNT", actor };
  }
  const token = cookie(request, "eoc_guest_proof");
  if (!token) throw unauthenticated();
  let proof;
  try {
    proof = await verifyGuestProof(token, deps.config.jwtSecret);
  } catch {
    throw unauthenticated();
  }
  if (
    proof.purpose !== "guest_ownership" ||
    !/^[0-9a-f]{64}$/.test(proof.contactLookupHash)
  )
    throw unauthenticated();
  if (mutation) {
    requireOrigin(request, deps.frontendOrigin);
    if (
      !validCsrfToken(
        request.header("X-CSRF-Token"),
        token,
        deps.config.jwtSecret,
      )
    )
      throw new ApiError(403, "FORBIDDEN", "Invalid CSRF token");
  }
  const guest = await deps.db.guestIdentity.findUnique({
    where: { lookupHash: proof.contactLookupHash },
  });
  return { kind: "GUEST", id: guest?.id ?? null, token, proof };
}
export async function establishGuest(
  identity: Identity,
  deps: AuthDependencies,
  correlationId: string,
) {
  if (identity.kind !== "GUEST" || identity.id) return;
  identity.id = await deps.db.$transaction(async (tx) => {
    const id = randomUUID();
    const inserted = await tx.$queryRaw<
      { id: string }[]
    >`INSERT INTO "GuestIdentity" (id, "lookupHash") VALUES (${id}::uuid, ${identity.proof.contactLookupHash}) ON CONFLICT ("lookupHash") DO NOTHING RETURNING id`;
    if (inserted.length)
      await recordAudit(tx, {
        actorKind: "GUEST",
        action: "GUEST_IDENTITY_ESTABLISHED",
        outcome: "SUCCESS",
        correlationId,
      });
    return (
      await tx.guestIdentity.findUniqueOrThrow({
        where: { lookupHash: identity.proof.contactLookupHash },
      })
    ).id;
  });
}
export async function lockIdentity(
  tx: Prisma.TransactionClient,
  identity: Identity,
  deps: AuthDependencies,
  eventId: string,
) {
  if (identity.kind === "ACCOUNT") {
    const organizer = await lockCommandActor(tx, identity.actor);
    const contacts = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "VerifiedContact" WHERE "userId" = ${identity.actor.userId}::uuid FOR SHARE`;
    if (!contacts.length) throw unauthenticated();
    return organizer;
  }
  // Revalidate expiry/purpose and event binding under the command lock, including replay.
  let proof;
  try {
    proof = await verifyGuestProof(identity.token, deps.config.jwtSecret);
  } catch {
    throw unauthenticated();
  }
  if (
    proof.purpose !== "guest_ownership" ||
    (proof.contextEventId !== null && proof.contextEventId !== eventId)
  )
    throw unauthenticated();
  return false;
}
export function identityWhere(
  identity: Identity,
): Prisma.RegistrationWhereInput {
  return identity.kind === "ACCOUNT"
    ? { userId: identity.actor.userId }
    : {
        guestIdentityId: identity.id ?? "00000000-0000-0000-0000-000000000000",
      };
}
export function commandActor(identity: Identity) {
  return identity.kind === "ACCOUNT"
    ? { actorUserId: identity.actor.userId }
    : { actorGuestIdentityId: identity.id! };
}
export function auditActor(identity: Identity) {
  return {
    actorKind: identity.kind,
    ...(identity.kind === "ACCOUNT"
      ? { actorUserId: identity.actor.userId }
      : {}),
  };
}
