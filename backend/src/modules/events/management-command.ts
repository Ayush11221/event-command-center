import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/http.js";
import { ApiError } from "../auth/errors.js";
import { lockEventForCommand } from "./private-links.js";

const notFound = () => new ApiError(404, "EVENT_NOT_FOUND", "Event not found");
export function validateManagementEventId(eventId: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      eventId,
    )
  )
    throw notFound();
}

// Hold current authority through commit, including before returning command replay.
export async function lockManagementEvent(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
  eventId: string,
) {
  validateManagementEventId(eventId);
  if (!(await lockEventForCommand(tx, eventId))) throw notFound();
  const organizerCapable = await lockCommandActor(tx, actor);
  const event = await tx.event.findUniqueOrThrow({
    where: { id: eventId },
    include: { gates: { select: { id: true, eventId: true } } },
  });
  const owner = event.ownerUserId === actor.userId && organizerCapable;
  if (!owner) {
    const assignments = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "EventRoleAssignment" WHERE "eventId" = ${eventId}::uuid
      AND "userId" = ${actor.userId}::uuid AND role = 'EVENT_ADMIN' AND "revokedAt" IS NULL FOR SHARE
    `;
    if (!assignments.length) throw notFound();
  }
  return { event, owner };
}

// Reuse the same current session/capability locks for commands without an Event yet.
export async function lockCommandActor(
  tx: Prisma.TransactionClient,
  actor: AuthContext,
) {
  const sessions = await tx.$queryRaw<
    { expiresAt: Date; revokedAt: Date | null }[]
  >`
    SELECT "expiresAt", "revokedAt" FROM "Session"
    WHERE id = ${actor.sessionId}::uuid AND "userId" = ${actor.userId}::uuid FOR SHARE
  `;
  if (
    !sessions[0] ||
    sessions[0].revokedAt ||
    sessions[0].expiresAt <= new Date()
  )
    throw new ApiError(401, "UNAUTHENTICATED", "Authentication required");
  const users = await tx.$queryRaw<{ organizerCapable: boolean }[]>`
    SELECT "organizerCapable" FROM "User" WHERE id = ${actor.userId}::uuid FOR SHARE
  `;
  return users[0]?.organizerCapable === true;
}
