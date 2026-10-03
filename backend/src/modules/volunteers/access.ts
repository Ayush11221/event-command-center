import type { Prisma, VolunteerTask } from "@prisma/client";
import type { AuthContext } from "../auth/http.js";
import { ApiError } from "../auth/errors.js";
import {
  lockCommandActor,
  validateManagementEventId,
} from "../events/management-command.js";
import { lockEventForCommand } from "../events/private-links.js";
import { uuid } from "../events/scoped-cursor.js";
export type Tx = Prisma.TransactionClient;
export const missingTask = () =>
  new ApiError(404, "TASK_NOT_FOUND", "Task not found");
export async function scope(
  tx: Tx,
  actor: AuthContext,
  eventId: string,
  mode: "manage" | "own" | "either",
  taskId?: string,
) {
  validateManagementEventId(eventId);
  if (!(await lockEventForCommand(tx, eventId)))
    throw new ApiError(404, "EVENT_NOT_FOUND", "Event not found");
  const capable = await lockCommandActor(tx, actor);
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId } });
  const grants = await tx.$queryRaw<
    { id: string; role: string }[]
  >`SELECT id,role FROM "EventRoleAssignment" WHERE "eventId"=${eventId}::uuid AND "userId"=${actor.userId}::uuid AND "revokedAt" IS NULL FOR SHARE`;
  const manager =
    (event.ownerUserId === actor.userId && capable) ||
    grants.some((g) => g.role === "EVENT_ADMIN");
  const volunteers = grants
    .filter((g) => g.role === "VOLUNTEER")
    .map((g) => g.id);
  if (
    (mode === "manage" && !manager) ||
    (mode === "own" && !volunteers.length && !manager) ||
    (!manager && !volunteers.length)
  )
    throw new ApiError(404, "EVENT_NOT_FOUND", "Event not found");
  let task: VolunteerTask | undefined;
  if (taskId !== undefined) {
    if (!uuid.test(taskId)) throw missingTask();
    await tx.$queryRaw`SELECT id FROM "VolunteerTask" WHERE id=${taskId}::uuid AND "eventId"=${eventId}::uuid FOR UPDATE`;
    task =
      (await tx.volunteerTask.findFirst({ where: { id: taskId, eventId } })) ??
      undefined;
    if (!task) throw missingTask();
    const own =
      task.status !== "CANCELLED" &&
      task.assignedVolunteerId === actor.userId &&
      volunteers.includes(task.assignedRoleGrantId);
    if (mode === "own" && !own) {
      if (manager && task.status !== "CANCELLED")
        throw new ApiError(
          403,
          "FORBIDDEN",
          "Only the assigned Volunteer may progress this task",
        );
      throw missingTask();
    }
    if (mode === "either" && !manager && !own) throw missingTask();
  } else if (mode === "own" && !volunteers.length)
    throw new ApiError(403, "FORBIDDEN", "Volunteer assignment required");
  return { event, task, manager, volunteers };
}
export async function assignable(tx: Tx, eventId: string, userId: string) {
  const grants = await tx.$queryRaw<
    { id: string }[]
  >`SELECT a.id FROM "EventRoleAssignment" a WHERE a."eventId"=${eventId}::uuid AND a."userId"=${userId}::uuid AND a.role='VOLUNTEER' AND a."revokedAt" IS NULL AND EXISTS(SELECT 1 FROM "VerifiedContact" c WHERE c."userId"=a."userId") FOR SHARE OF a`;
  if (!grants[0])
    throw new ApiError(
      409,
      "VOLUNTEER_NOT_ASSIGNABLE",
      "Volunteer is not assignable",
    );
  return grants[0].id;
}
export function taskView(t: VolunteerTask) {
  return {
    id: t.id,
    event_id: t.eventId,
    assigned_volunteer_id: t.assignedVolunteerId,
    title: t.title,
    instructions: t.instructions,
    location: t.location,
    starts_at: t.startsAt?.toISOString() ?? null,
    ends_at: t.endsAt?.toISOString() ?? null,
    status: t.status,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
    cancelled_at: t.cancelledAt?.toISOString() ?? null,
    cancelled_by_user_id: t.cancelledByUserId,
    cancellation_reason: t.cancellationReason,
  };
}
