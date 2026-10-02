import { Prisma } from "@prisma/client";
import type { AuthContext, AuthDependencies } from "../auth/http.js";
import { accountActor, recordAudit } from "../auth/audit.js";
import { ApiError, unavailable } from "../auth/errors.js";
import { parseEventEdit, validateEventEdit } from "./edit-validation.js";
import { revokePrivateAccessLink } from "./private-links.js";
import { lockManagementEvent } from "./management-command.js";
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
        const { event, owner } = await lockManagementEvent(tx, actor, eventId);
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
