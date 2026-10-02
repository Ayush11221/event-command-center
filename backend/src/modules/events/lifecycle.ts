import type { EventState } from "@prisma/client";
import { ApiError } from "../auth/errors.js";

export const lifecycleTransitions = {
  DRAFT: { PUBLISHED: "PUBLISH", CANCELLED: "CANCEL" },
  PUBLISHED: { LIVE: "LIVE", CANCELLED: "CANCEL" },
  LIVE: { COMPLETED: "COMPLETE", CANCELLED: "CANCEL" },
  COMPLETED: {},
  CANCELLED: {},
} as const satisfies Record<EventState, Partial<Record<EventState, string>>>;

export interface TransitionBody {
  target_state: EventState;
  reason?: string;
}

export function lifecycleActions(state: EventState): string[] {
  return Object.values(lifecycleTransitions[state]);
}

export function requireLifecycleEdge(from: EventState, to: EventState): void {
  if (!Object.hasOwn(lifecycleTransitions[from], to))
    throw new ApiError(
      409,
      "INVALID_TRANSITION",
      "Lifecycle transition is not permitted",
    );
}

export function parseTransitionBody(body: unknown): TransitionBody {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new ApiError(400, "VALIDATION", "Invalid lifecycle command");
  const fields = Object.keys(body);
  const value = body as Record<string, unknown>;
  if (
    fields.some((field) => field !== "target_state" && field !== "reason") ||
    typeof value.target_state !== "string" ||
    !Object.hasOwn(lifecycleTransitions, value.target_state) ||
    (value.reason !== undefined && typeof value.reason !== "string")
  )
    throw new ApiError(400, "VALIDATION", "Invalid lifecycle command");
  if (
    value.target_state === "CANCELLED" &&
    (typeof value.reason !== "string" || !value.reason.trim())
  )
    throw new ApiError(422, "VALIDATION", "A cancellation reason is required", {
      details: { field: "reason" },
    });
  return {
    target_state: value.target_state as EventState,
    ...(value.reason !== undefined
      ? { reason: (value.reason as string).trim() }
      : {}),
  };
}
