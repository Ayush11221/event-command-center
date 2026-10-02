import { Prisma } from "@prisma/client";
import type { AuthContext, AuthDependencies } from "../auth/http.js";
import { accountActor, recordAudit } from "../auth/audit.js";
import { ApiError, unavailable } from "../auth/errors.js";
import { parseEventEdit, validateEventEdit } from "./edit-validation.js";
import {
  lockEventForCommand,
  revokePrivateAccessLink,
} from "./private-links.js";
import { managementDetail } from "./serializers.js";

export async function editManagementEvent(
  deps: AuthDependencies,
  actor: AuthContext,
  eventId: string,
  revision: number,
  body: unknown,
  correlationId: string,
) {
  const notFound = () =>
    new ApiError(404, "EVENT_NOT_FOUND", "Event not found");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      eventId,
    )
  )
    throw notFound();
  try {
    return await deps.db.$transaction(
      async (tx) => {
        // Serialize commands first. Recheck and hold current authority through commit;
        // an in-flight assignment/session revocation cannot race a stale grant.
        if (!(await lockEventForCommand(tx, eventId))) throw notFound();
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
        const event = await tx.event.findUniqueOrThrow({
          where: { id: eventId },
          include: { gates: { select: { id: true, eventId: true } } },
        });
        const owner =
          event.ownerUserId === actor.userId &&
          users[0]?.organizerCapable === true;
        if (!owner) {
          const assignments = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "EventRoleAssignment"
          WHERE "eventId" = ${eventId}::uuid AND "userId" = ${actor.userId}::uuid
            AND role = 'EVENT_ADMIN' AND "revokedAt" IS NULL FOR SHARE
        `;
          if (!assignments.length) throw notFound();
        }
        const edit = parseEventEdit(body, owner);
        if (event.state !== "DRAFT" && event.state !== "PUBLISHED")
          throw new ApiError(
            422,
            "WRONG_LIFECYCLE_STATE",
            "Event cannot be edited in its current state",
          );
        if (event.revision !== revision)
          throw new ApiError(409, "VERSION_CONFLICT", "Event data changed", {
            details: { current_revision: event.revision },
          });
        validateEventEdit(event, edit);
        const updated = await tx.event.update({
          where: { id: eventId, revision },
          data: { ...edit, revision: { increment: 1 } },
        });
        const now = new Date();
        if (event.visibility === "PRIVATE" && updated.visibility !== "PRIVATE")
          await revokePrivateAccessLink(tx, eventId, now);
        await recordAudit(tx, {
          actorKind: accountActor,
          actorUserId: actor.userId,
          eventId,
          action: "EVENT_UPDATED",
          outcome: "ACCEPTED",
          correlationId,
          metadata: {
            fields: Object.keys(body as object),
            previous_revision: revision,
            revision: updated.revision,
            published_material_edit:
              event.state === "PUBLISHED" &&
              Object.entries(edit).some(
                ([key, value]) =>
                  JSON.stringify(value) !==
                  JSON.stringify(event[key as keyof typeof edit]),
              ),
          },
        });
        return managementDetail(
          updated,
          event.gates,
          now,
          correlationId,
          owner,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unavailable();
  }
}
