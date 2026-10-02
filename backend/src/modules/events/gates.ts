import type { AuthContext, AuthDependencies } from "../auth/http.js";
import { accountActor, recordAudit } from "../auth/audit.js";
import { ApiError, unavailable } from "../auth/errors.js";
import { executeIdempotentCommand } from "./command-safety.js";
import {
  lockManagementEvent,
  validateManagementEventId,
} from "./management-command.js";
import { managementReadiness } from "./readiness.js";

export function parseGateBody(body: unknown): Record<string, never> {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 0
  )
    throw new ApiError(
      400,
      "VALIDATION",
      "Gate configuration requires an empty object",
    );
  return {};
}

export async function createEventGate(
  deps: AuthDependencies,
  actor: AuthContext,
  eventId: string,
  revision: number,
  key: string,
  body: Record<string, never>,
  correlationId: string,
) {
  validateManagementEventId(eventId);
  eventId = eventId.toLowerCase();
  try {
    return await executeIdempotentCommand(
      deps.db,
      {
        actorUserId: actor.userId,
        action: "GATE_CREATE",
        resourceKey: eventId,
        idempotencyKey: key,
        request: body,
      },
      async (tx) => {
        const event = await tx.event.findUniqueOrThrow({
          where: { id: eventId },
          include: { gates: { select: { id: true, eventId: true } } },
        });
        if (event.revision !== revision)
          throw new ApiError(409, "VERSION_CONFLICT", "Event data changed", {
            details: { current_revision: event.revision },
          });
        if (event.state !== "DRAFT" && event.state !== "PUBLISHED")
          throw new ApiError(
            422,
            "WRONG_LIFECYCLE_STATE",
            "Gate cannot be created in the current event state",
          );
        const gate = await tx.gate.create({ data: { eventId } });
        const updated = await tx.event.update({
          where: { id: eventId, revision },
          data: { revision: { increment: 1 } },
        });
        const now = new Date();
        await recordAudit(tx, {
          actorKind: accountActor,
          actorUserId: actor.userId,
          eventId,
          action: "GATE_CREATED",
          outcome: "ACCEPTED",
          correlationId,
          metadata: {
            gate_id: gate.id,
            previous_revision: revision,
            revision: updated.revision,
          },
        });
        return {
          status: 201,
          body: {
            gate_id: gate.id,
            event_id: eventId,
            readiness: managementReadiness(updated, [...event.gates, gate]),
            revision: updated.revision,
            as_of: now.toISOString(),
            correlation_id: correlationId,
          },
        };
      },
      async (tx) => {
        await lockManagementEvent(tx, actor, eventId);
      },
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unavailable();
  }
}
