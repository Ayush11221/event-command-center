import { ApiError } from "../auth/errors.js";
import { parseIdempotencyKey } from "./command-safety.js";

export type EventListView = "owned" | "assigned";

export interface EventListQuery {
  view: EventListView;
  cursor?: string;
  limit: number;
}

export function parseEventListQuery(
  query: Record<string, unknown>,
): EventListQuery {
  if (
    Object.keys(query).some((key) => !["view", "cursor", "limit"].includes(key))
  ) {
    throw new ApiError(400, "VALIDATION", "Invalid event list query");
  }
  if (query.view !== "owned" && query.view !== "assigned") {
    throw new ApiError(400, "VALIDATION", "Invalid event list view", {
      details: { field: "view" },
    });
  }
  if (
    query.cursor !== undefined &&
    (typeof query.cursor !== "string" ||
      query.cursor.length === 0 ||
      query.cursor.length > 2048)
  ) {
    throw new ApiError(400, "VALIDATION", "Invalid event list cursor", {
      details: { field: "cursor" },
    });
  }
  const limit =
    query.limit === undefined
      ? 20
      : typeof query.limit === "string" && /^[1-9]\d*$/.test(query.limit)
        ? Number(query.limit)
        : Number.NaN;
  if (!Number.isSafeInteger(limit) || limit > 100) {
    throw new ApiError(400, "VALIDATION", "Invalid event list limit", {
      details: { field: "limit" },
    });
  }
  return {
    view: query.view,
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    limit,
  };
}

export function parseCreateDraftBody(value: unknown): { name: string } {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !Object.hasOwn(value, "name")
  ) {
    throw new ApiError(400, "VALIDATION", "Only an event name is accepted", {
      details: { field: "name" },
    });
  }
  const name = (value as Record<string, unknown>).name;
  if (typeof name !== "string" || !name.trim() || [...name].length > 200) {
    throw new ApiError(
      400,
      "VALIDATION",
      "Enter an event name of at most 200 characters",
      {
        details: { field: "name" },
      },
    );
  }
  return { name };
}

export function parseCreateDraftKey(value: string | undefined): string {
  return parseIdempotencyKey(value);
}
