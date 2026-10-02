import type { EventRelationship, ManagementEvent } from "../services/events";

const CONTEXT_STORAGE_KEY = "eoc.active_context.v1";

export interface EventContext {
  eventId: string;
  relationship: EventRelationship;
  name: string;
  state: ManagementEvent["state"];
}

export function contextsFromLists(
  owned: ManagementEvent[],
  assigned: ManagementEvent[],
): EventContext[] {
  return [...owned, ...assigned].map((event) => ({
    eventId: event.event_id,
    relationship: event.relationship,
    name: event.name,
    state: event.state,
  }));
}

export function contextKey(
  context: Pick<EventContext, "eventId" | "relationship">,
) {
  return `${context.relationship}:${context.eventId}`;
}

export function rememberedContext(): Pick<
  EventContext,
  "eventId" | "relationship"
> | null {
  try {
    const raw = localStorage.getItem(CONTEXT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as Record<string, unknown>;
    if (
      typeof value.eventId === "string" &&
      (value.relationship === "owned" || value.relationship === "assigned")
    ) {
      return { eventId: value.eventId, relationship: value.relationship };
    }
  } catch {
    // Stale or unavailable browser storage is not authorization evidence.
  }
  return null;
}

export function rememberContext(context: EventContext | null): void {
  try {
    if (context) {
      localStorage.setItem(
        CONTEXT_STORAGE_KEY,
        JSON.stringify({
          eventId: context.eventId,
          relationship: context.relationship,
        }),
      );
    } else {
      localStorage.removeItem(CONTEXT_STORAGE_KEY);
    }
  } catch {
    // The current server scoped selection remains usable in memory.
  }
}

export function selectAuthorizedContext(
  contexts: EventContext[],
  preferred: Pick<EventContext, "eventId" | "relationship"> | null,
): EventContext | null {
  if (contexts.length === 0) return null;
  if (contexts.length === 1) return contexts[0];
  return (
    contexts.find(
      (item) => preferred && contextKey(item) === contextKey(preferred),
    ) ?? contexts[0]
  );
}
