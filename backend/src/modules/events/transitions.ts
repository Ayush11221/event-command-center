import type { AuthContext, AuthDependencies } from "../auth/http.js";
import { accountActor, recordAudit } from "../auth/audit.js";
import { ApiError, unavailable } from "../auth/errors.js";
import { managementAvailability } from "./availability.js";
import { executeIdempotentCommand } from "./command-safety.js";
import { parseTransitionBody, requireLifecycleEdge } from "./lifecycle.js";
import {
  lockManagementEvent,
  validateManagementEventId,
} from "./management-command.js";
import { managementReadiness } from "./readiness.js";

export async function transitionEvent(
  deps: AuthDependencies,
  actor: AuthContext,
  eventId: string,
  revision: number,
  key: string,
  body: unknown,
  correlationId: string,
) {
  validateManagementEventId(eventId);
  eventId = eventId.toLowerCase();
  try {
    return await executeIdempotentCommand(
      deps.db,
      {
        actorUserId: actor.userId,
        action: "EVENT_TRANSITION",
        resourceKey: eventId,
        idempotencyKey: key,
        request: body ?? null,
      },
      async (tx) => {
        const command = parseTransitionBody(body);
        const event = await tx.event.findUniqueOrThrow({
          where: { id: eventId },
          include: { gates: { select: { id: true, eventId: true } } },
        });
        if (event.revision !== revision)
          throw new ApiError(409, "VERSION_CONFLICT", "Event data changed", {
            details: { current_revision: event.revision },
          });
        requireLifecycleEdge(event.state, command.target_state);
        const readiness = managementReadiness(event, event.gates);
        if (
          command.target_state === "PUBLISHED" ||
          command.target_state === "LIVE"
        ) {
          if (!readiness.configured_gate_present)
            throw new ApiError(
              422,
              "MISSING_CONFIGURED_GATE",
              "A configured event gate is required",
            );
          if (
            command.target_state === "PUBLISHED" &&
            readiness.publish_blockers.length
          )
            throw new ApiError(
              422,
              "VALIDATION",
              "Publication configuration is incomplete",
              {
                details: { blockers: readiness.publish_blockers },
              },
            );
        }
        const now = new Date();
        const updated = await tx.event.update({
          where: { id: eventId, revision },
          data: {
            state: command.target_state,
            revision: { increment: 1 },
            ...(command.target_state === "PUBLISHED"
              ? { publishedAt: now }
              : {}),
          },
        });
        // The immutable audit is the timestamp/reason history for every edge.
        // No registration, attendance or private-link mutation belongs here.
        await recordAudit(tx, {
          actorKind: accountActor,
          actorUserId: actor.userId,
          eventId,
          action: "EVENT_TRANSITIONED",
          outcome: "ACCEPTED",
          correlationId,
          metadata: {
            previous_state: event.state,
            state: updated.state,
            previous_revision: revision,
            revision: updated.revision,
            transitioned_at: now.toISOString(),
            ...(command.reason !== undefined ? { reason: command.reason } : {}),
          },
        });
        return {
          status: 200,
          body: {
            event_id: eventId,
            previous_state: event.state,
            state: updated.state,
            revision: updated.revision,
            readiness,
            availability: managementAvailability(updated, now),
            as_of: now.toISOString(),
            correlation_id: correlationId,
          },
        };
      },
      async (tx) => {
        const { owner } = await lockManagementEvent(tx, actor, eventId);
        if (!owner)
          throw new ApiError(
            403,
            "FORBIDDEN",
            "Only the owning Organizer may change lifecycle",
          );
      },
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unavailable();
  }
}
