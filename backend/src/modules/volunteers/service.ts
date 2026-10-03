import { Prisma, type VolunteerTask } from "@prisma/client";
import type { AuthContext, AuthDependencies } from "../auth/http.js";
import { ApiError, unavailable } from "../auth/errors.js";
import { recordAudit } from "../auth/audit.js";
import {
  executeIdempotentCommand,
  idempotencyKeyHash,
} from "../events/command-safety.js";
import {
  ScopedCursor,
  page,
  queryFields,
  invalid,
} from "../events/scoped-cursor.js";
import { scope, assignable, taskView } from "./access.js";
import {
  details,
  object,
  volunteer,
  text,
  timeWindow,
  type Details,
} from "./contract.js";
type Action = "CREATE" | "EDIT" | "ASSIGN" | "STATUS" | "CANCEL";
export class VolunteerTasks {
  constructor(readonly deps: AuthDependencies) {}
  async read(actor: AuthContext, eventId: string, id: string) {
    return this.deps.db.$transaction(async (tx) => {
      const { task } = await scope(tx, actor, eventId, "either", id);
      return { task: taskView(task!), etag: `"${task!.revision}"` };
    });
  }
  async list(
    actor: AuthContext,
    eventId: string,
    query: Record<string, unknown>,
  ) {
    queryFields(query, ["view", "cursor", "limit"]);
    if (query.view !== "manage" && query.view !== "own") invalid("view");
    const view = query.view,
      pagination = page(query);
    return this.deps.db.$transaction(async (tx) => {
      const access = await scope(tx, actor, eventId, view);
      const cursor = new ScopedCursor(
          "TASKS",
          actor.userId,
          eventId,
          { view },
          this.deps.config.contactKey,
        ),
        boundary = cursor.decode(pagination.cursor);
      const where: Prisma.VolunteerTaskWhereInput = {
        eventId,
        ...(view === "own"
          ? {
              assignedVolunteerId: actor.userId,
              assignedRoleGrantId: { in: access.volunteers },
              status: { not: "CANCELLED" },
            }
          : {}),
        ...(boundary
          ? {
              OR: [
                { createdAt: { lt: new Date(boundary.last_at) } },
                {
                  createdAt: new Date(boundary.last_at),
                  id: { lt: boundary.last_id },
                },
              ],
            }
          : {}),
      };
      const rows = await tx.volunteerTask.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: pagination.limit + 1,
      });
      const items = rows.slice(0, pagination.limit),
        last = items.at(-1);
      return {
        event: { event_id: eventId, event_name: access.event.name },
        items: items.map(taskView),
        next_cursor:
          rows.length > pagination.limit && last
            ? cursor.encode({
                last_at: last.createdAt.toISOString(),
                last_id: last.id,
              })
            : null,
      };
    });
  }
  async command(
    actor: AuthContext,
    eventId: string,
    id: string | undefined,
    action: Action,
    body: unknown,
    key: string,
    revision: number | undefined,
    correlationId: string,
  ) {
    let current: VolunteerTask | undefined;
    const result = await executeIdempotentCommand(
      this.deps.db,
      {
        actorUserId: actor.userId,
        action: `VOLUNTEER_TASK_${action}`,
        resourceKey: id ? `${eventId}:${id}` : eventId,
        idempotencyKey: key,
        request: { body, revision: revision ?? null },
      },
      async (tx) => {
        let task: VolunteerTask;
        const before = current;
        if (action === "CREATE") {
          const hash = idempotencyKeyHash(key);
          if (
            await tx.volunteerTask.findFirst({
              where: {
                eventId,
                createdByUserId: actor.userId,
                creationKeyHash: hash,
              },
            })
          )
            throw new ApiError(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Expired creation identity cannot be reused",
            );
          const data = details(body, true) as Details,
            raw = object(body, [
              "assigned_volunteer_id",
              "title",
              "instructions",
              "location",
              "starts_at",
              "ends_at",
            ]);
          timeWindow(data);
          const who = volunteer(raw.assigned_volunteer_id),
            grant = await assignable(tx, eventId, who);
          task = await tx.volunteerTask.create({
            data: {
              ...data,
              eventId,
              assignedVolunteerId: who,
              assignedRoleGrantId: grant,
              createdByUserId: actor.userId,
              creationKeyHash: hash,
            },
          });
        } else {
          if (!before) throw unavailable();
          if (before.revision !== revision)
            throw new ApiError(
              409,
              "VERSION_CONFLICT",
              "Task revision has changed",
            );
          const edit: Prisma.VolunteerTaskUncheckedUpdateInput = {};
          if (action === "EDIT") {
            if (!["ASSIGNED", "IN_PROGRESS"].includes(before.status))
              throw new ApiError(409, "TASK_NOT_EDITABLE", "Task is immutable");
            const data = details(body);
            timeWindow({ ...before, ...data });
            Object.assign(edit, data);
          } else if (action === "ASSIGN") {
            if (before.status !== "ASSIGNED")
              throw new ApiError(
                409,
                "TASK_NOT_REASSIGNABLE",
                "Task cannot be reassigned",
              );
            const raw = object(
                body,
                ["assigned_volunteer_id"],
                ["assigned_volunteer_id"],
              ),
              who = volunteer(raw.assigned_volunteer_id);
            edit.assignedVolunteerId = who;
            edit.assignedRoleGrantId = await assignable(tx, eventId, who);
          } else if (action === "STATUS") {
            const raw = object(body, ["status"], ["status"]);
            if (raw.status !== "IN_PROGRESS" && raw.status !== "COMPLETED")
              invalid("status");
            if (!(
              (before.status === "ASSIGNED" && raw.status === "IN_PROGRESS") ||
              (before.status === "IN_PROGRESS" && raw.status === "COMPLETED")
            ))
              throw new ApiError(
                409,
                "INVALID_TRANSITION",
                "Invalid task transition",
              );
            edit.status = raw.status;
          } else {
            const raw = object(body, ["reason"], ["reason"]),
              reason = text(raw.reason, "reason", 500);
            if (!["ASSIGNED", "IN_PROGRESS"].includes(before.status))
              throw new ApiError(
                409,
                "INVALID_TRANSITION",
                "Task cannot be cancelled",
              );
            edit.status = "CANCELLED";
            edit.cancellationReason = reason;
            edit.cancelledByUserId = actor.userId;
          }
          const changed = Object.entries(edit).some(
            ([k, v]) =>
              JSON.stringify(before[k as keyof VolunteerTask]) !==
              JSON.stringify(v),
          );
          if (!changed)
            return {
              status: 200,
              body: { task: taskView(before), etag: `"${before.revision}"` },
            };
          const at = new Date(Math.max(Date.now(), before.updatedAt.getTime()));
          if (action === "CANCEL") edit.cancelledAt = at;
          task = await tx.volunteerTask.update({
            where: { id: before.id },
            data: { ...edit, revision: { increment: 1 }, updatedAt: at },
          });
        }
        await recordAudit(tx, {
          actorKind: "ACCOUNT",
          actorUserId: actor.userId,
          eventId,
          action: {
            CREATE: "VOLUNTEER_TASK_CREATED",
            EDIT: "VOLUNTEER_TASK_UPDATED",
            ASSIGN: "VOLUNTEER_TASK_REASSIGNED",
            STATUS: "VOLUNTEER_TASK_STATUS_CHANGED",
            CANCEL: "VOLUNTEER_TASK_CANCELLED",
          }[action],
          outcome: "ACCEPTED",
          correlationId,
          metadata: {
            task_id: task.id,
            previous_status: before?.status ?? null,
            status: task.status,
            ...(action === "EDIT"
              ? {
                  fields: Object.keys(body as object)
                    .filter((field) => {
                      const key =
                        (
                          {
                            starts_at: "startsAt",
                            ends_at: "endsAt",
                          } as Record<string, string>
                        )[field] ?? field;
                      return (
                        JSON.stringify(before![key as keyof VolunteerTask]) !==
                        JSON.stringify(task[key as keyof VolunteerTask])
                      );
                    })
                    .sort(),
                }
              : {}),
            ...(action === "CREATE"
              ? {
                  volunteer_id: task.assignedVolunteerId,
                  grant_id: task.assignedRoleGrantId,
                }
              : {}),
            ...(action === "ASSIGN"
              ? {
                  previous_volunteer_id: before!.assignedVolunteerId,
                  previous_grant_id: before!.assignedRoleGrantId,
                  volunteer_id: task.assignedVolunteerId,
                  grant_id: task.assignedRoleGrantId,
                }
              : {}),
            ...(action === "CANCEL" ? { reason: task.cancellationReason } : {}),
          },
        });
        return {
          status: action === "CREATE" ? 201 : 200,
          body: { task: taskView(task), etag: `"${task.revision}"` },
        };
      },
      async (tx) => {
        current = (
          await scope(
            tx,
            actor,
            eventId,
            action === "STATUS" ? "own" : "manage",
            id,
          )
        ).task;
      },
    );
    return result;
  }
}
