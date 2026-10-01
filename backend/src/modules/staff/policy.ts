import { Prisma, StaffRole } from "@prisma/client";
import { ApiError } from "../auth/errors.js";

type Database = Prisma.TransactionClient;

export async function requireStaffAuthority(
  tx: Database,
  actorUserId: string,
  eventId: string,
  action: "READ" | "GRANT" | "REVOKE",
  role?: StaffRole,
): Promise<"OWNER" | "ADMIN"> {
  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: { ownerUserId: true },
  });
  if (!event) throw new ApiError(404, "NOT_FOUND", "Event not found");
  if (event.ownerUserId === actorUserId) return "OWNER";
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "EventRoleAssignment"
    WHERE "eventId" = ${eventId}::uuid AND "userId" = ${actorUserId}::uuid
      AND role = 'EVENT_ADMIN' AND "revokedAt" IS NULL
    FOR SHARE
  `;
  if (rows.length && (action === "READ" || role !== StaffRole.EVENT_ADMIN))
    return "ADMIN";
  throw new ApiError(403, "FORBIDDEN", "Action not permitted");
}

export async function requireGateScope(
  tx: Database,
  actorUserId: string,
  eventId: string,
  gateId: string,
): Promise<void> {
  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: { ownerUserId: true },
  });
  if (!event) throw new ApiError(404, "NOT_FOUND", "Event not found");
  const gate = await tx.gate.findUnique({
    where: { eventId_id: { eventId, id: gateId } },
    select: { id: true },
  });
  if (!gate) throw new ApiError(404, "NOT_FOUND", "Gate not found");
  if (event.ownerUserId === actorUserId) return;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "EventRoleAssignment"
    WHERE "eventId" = ${eventId}::uuid AND "userId" = ${actorUserId}::uuid
      AND "revokedAt" IS NULL
      AND (role = 'EVENT_ADMIN' OR (role = 'GATE_SECURITY' AND "gateId" = ${gateId}::uuid))
    FOR SHARE
  `;
  if (!rows.length)
    throw new ApiError(403, "FORBIDDEN", "Action not permitted");
}
