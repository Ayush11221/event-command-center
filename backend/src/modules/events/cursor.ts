import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "../auth/errors.js";
import type { EventListView } from "./validation.js";

interface CursorValue {
  v: 1;
  actor: string;
  view: EventListView;
  created_at: string;
  event_id: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signature(payload: string, key: Uint8Array): Buffer {
  return createHmac("sha256", key).update(payload).digest();
}

function invalidCursor(): ApiError {
  return new ApiError(400, "VALIDATION", "Invalid event list cursor", {
    details: { field: "cursor" },
  });
}

export function encodeEventCursor(value: CursorValue, key: Uint8Array): string {
  return encodeCursor(value, key);
}

function encodeCursor(value: object, key: Uint8Array): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${signature(payload, key).toString("base64url")}`;
}

export function decodeEventCursor(
  raw: string,
  actor: string,
  view: EventListView,
  key: Uint8Array,
): CursorValue {
  const value = decodeCursor(raw, key) as Partial<CursorValue>;
  if (
    value.v !== 1 ||
    value.actor !== actor ||
    value.view !== view ||
    typeof value.event_id !== "string" ||
    !uuid.test(value.event_id) ||
    typeof value.created_at !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.created_at) ||
    Number.isNaN(Date.parse(value.created_at))
  )
    throw invalidCursor();
  return value as CursorValue;
}

function decodeCursor(raw: string, key: Uint8Array): object {
  const parts = raw.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw invalidCursor();
  const expected = signature(parts[0], key);
  const actual = Buffer.from(parts[1], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw invalidCursor();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  if (!parsed || typeof parsed !== "object") throw invalidCursor();
  return parsed;
}

interface PublicCursorValue {
  v: 1;
  view: "PUBLIC";
  published_at: string | null;
  event_id: string;
}

export function encodePublicCursor(
  value: PublicCursorValue,
  key: Uint8Array,
): string {
  return encodeCursor(value, key);
}

export function decodePublicCursor(
  raw: string,
  key: Uint8Array,
): PublicCursorValue {
  const value = decodeCursor(raw, key) as Partial<PublicCursorValue>;
  if (
    value.v !== 1 ||
    value.view !== "PUBLIC" ||
    typeof value.event_id !== "string" ||
    !uuid.test(value.event_id) ||
    (value.published_at !== null &&
      (typeof value.published_at !== "string" ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.published_at) ||
        !Number.isFinite(Date.parse(value.published_at)) ||
        new Date(value.published_at).toISOString() !== value.published_at))
  )
    throw invalidCursor();
  return value as PublicCursorValue;
}
