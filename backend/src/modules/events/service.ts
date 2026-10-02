import { StaffRole, type Event } from "@prisma/client";
import type { AuthContext, AuthDependencies } from "../auth/http.js";
import { accountActor, recordAudit } from "../auth/audit.js";
import { ApiError, unavailable } from "../auth/errors.js";
import { executeIdempotentCommand } from "./command-safety.js";
import { decodeEventCursor, encodeEventCursor } from "./cursor.js";
import { managementDetail, managementListItem } from "./serializers.js";
import { lockCommandActor } from "./management-command.js";
import { managementEventScope } from "./policy.js";
import type { EventListQuery } from "./validation.js";

export async function listManagementEvents(
  deps: AuthDependencies,
  actorUserId: string,
  query: EventListQuery,
  correlationId: string,
) {
  const boundary = query.cursor
    ? decodeEventCursor(
        query.cursor,
        actorUserId,
        query.view,
        deps.config.jwtSecret,
      )
    : undefined;
  try {
    if (query.view === "owned") {
      const owner = await deps.db.user.findUnique({
        where: { id: actorUserId },
        select: { organizerCapable: true },
      });
      if (!owner?.organizerCapable) {
        throw new ApiError(403, "FORBIDDEN", "Organizer access required");
      }
    } else {
      const assignments = await deps.db.eventRoleAssignment.count({
        where: {
          userId: actorUserId,
          role: StaffRole.EVENT_ADMIN,
          revokedAt: null,
        },
      });
      if (assignments === 0) {
        throw new ApiError(403, "FORBIDDEN", "Event Admin access required");
      }
    }
    const rows = await deps.db.event.findMany({
      where: {
        ...(query.view === "owned"
          ? { ownerUserId: actorUserId, owner: { organizerCapable: true } }
          : {
              assignments: {
                some: {
                  userId: actorUserId,
                  role: StaffRole.EVENT_ADMIN,
                  revokedAt: null,
                },
              },
            }),
        ...(boundary
          ? {
              OR: [
                { createdAt: { lt: new Date(boundary.created_at) } },
                {
                  createdAt: new Date(boundary.created_at),
                  id: { lt: boundary.event_id },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        state: true,
        startAt: true,
        endAt: true,
        timeZone: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((event) => managementListItem(event, query.view)),
      next_cursor:
        rows.length > query.limit && last
          ? encodeEventCursor(
              {
                v: 1,
                actor: actorUserId,
                view: query.view,
                created_at: last.createdAt.toISOString(),
                event_id: last.id,
              },
              deps.config.jwtSecret,
            )
          : null,
      as_of: new Date().toISOString(),
      correlation_id: correlationId,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unavailable();
  }
}

export async function createDraftEvent(
  deps: AuthDependencies,
  actor: AuthContext,
  name: string,
  idempotencyKey: string,
  correlationId: string,
) {
  const actorUserId = actor.userId;
  try {
    const owner = await deps.db.user.findUnique({
      where: { id: actorUserId },
      select: { organizerCapable: true },
    });
    if (!owner?.organizerCapable) {
      throw new ApiError(403, "FORBIDDEN", "Organizer access required");
    }
    return await executeIdempotentCommand(
      deps.db,
      {
        actorUserId,
        action: "EVENT_CREATE",
        resourceKey: "owned:create",
        idempotencyKey,
        request: { name },
      },
      async (tx) => {
        const event: Event = await tx.event.create({
          data: { ownerUserId: actorUserId, name: name.trim() },
        });
        await recordAudit(tx, {
          actorKind: accountActor,
          actorUserId,
          eventId: event.id,
          action: "EVENT_CREATED",
          outcome: "ACCEPTED",
          correlationId,
        });
        return {
          status: 201,
          body: managementDetail(event, [], new Date(), correlationId, true),
        };
      },
      async (tx) => {
        if (!(await lockCommandActor(tx, actor)))
          throw new ApiError(403, "FORBIDDEN", "Organizer access required");
      },
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unavailable();
  }
}

export async function getManagementEvent(
  deps: AuthDependencies,
  actorUserId: string,
  eventId: string,
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
    const event = await deps.db.event.findFirst({
      where: { id: eventId, ...managementEventScope(actorUserId) },
      include: {
        gates: { select: { id: true, eventId: true } },
        owner: { select: { organizerCapable: true } },
      },
    });
    if (!event) throw notFound();
    return managementDetail(
      event,
      event.gates,
      new Date(),
      correlationId,
      event.ownerUserId === actorUserId && event.owner.organizerCapable,
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unavailable();
  }
}
