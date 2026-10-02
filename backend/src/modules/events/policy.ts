import type { EventState, Prisma } from "@prisma/client";

export function managementEventScope(
  actorUserId: string,
): Prisma.EventWhereInput {
  return {
    OR: [
      { ownerUserId: actorUserId, owner: { organizerCapable: true } },
      {
        assignments: {
          some: { userId: actorUserId, role: "EVENT_ADMIN", revokedAt: null },
        },
      },
    ],
  };
}

export function managementActions(state: EventState, owner: boolean): string[] {
  if (state === "COMPLETED" || state === "CANCELLED") return [];
  const actions =
    state === "DRAFT" || state === "PUBLISHED"
      ? ["EDIT_EVENT", "CREATE_GATE"]
      : [];
  if (owner) actions.push("CANCEL");
  return actions;
}
