import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "../auth/errors.js";
import { requestFingerprint } from "./command-safety.js";

export const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function invalid(field: string): never {
  throw new ApiError(400, "VALIDATION", "Invalid request", {
    details: { field },
  });
}
export function utc(value: unknown, field: string): Date {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  )
    invalid(field);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value)
    invalid(field);
  return date;
}
export function queryFields(query: Record<string, unknown>, allowed: string[]) {
  for (const [k, v] of Object.entries(query))
    if (!allowed.includes(k) || typeof v !== "string") invalid(k);
}
export function page(query: Record<string, unknown>) {
  const raw = query.limit;
  if (
    raw !== undefined &&
    (typeof raw !== "string" ||
      !/^[1-9]\d{0,2}$/.test(raw) ||
      Number(raw) > 100)
  )
    invalid("limit");
  if (
    query.cursor !== undefined &&
    (typeof query.cursor !== "string" ||
      !query.cursor.length ||
      query.cursor.length > 2048)
  )
    invalid("cursor");
  return {
    limit: raw === undefined ? 25 : Number(raw),
    cursor: query.cursor as string | undefined,
  };
}
interface Boundary {
  last_at: string;
  last_id: string;
}
export class ScopedCursor {
  readonly filterHash: string;
  constructor(
    readonly resource: "TASKS" | "AUDIT",
    readonly actor: string,
    readonly eventId: string,
    filters: object,
    readonly key: Uint8Array,
  ) {
    this.filterHash = requestFingerprint(filters);
  }
  private sign(payload: string) {
    return createHmac("sha256", this.key)
      .update(`slice11:${this.resource.toLowerCase()}:v1:${payload}`)
      .digest();
  }
  encode(boundary: Boundary) {
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        resource: this.resource,
        actor_id: this.actor,
        event_id: this.eventId,
        filter_hash: this.filterHash,
        ...boundary,
      }),
    ).toString("base64url");
    return `${payload}.${this.sign(payload).toString("base64url")}`;
  }
  decode(raw?: string): Boundary | null {
    if (!raw) return null;
    if (raw.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw))
      invalid("cursor");
    const [payload, signature] = raw.split(".");
    const actual = Buffer.from(signature!, "base64url"),
      expected = this.sign(payload!);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      invalid("cursor");
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(
        Buffer.from(payload!, "base64url").toString("utf8"),
      ) as Record<string, unknown>;
    } catch {
      return invalid("cursor");
    }
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !==
        "actor_id,event_id,filter_hash,last_at,last_id,resource,v" ||
      value.v !== 1 ||
      value.resource !== this.resource ||
      value.actor_id !== this.actor ||
      value.event_id !== this.eventId ||
      value.filter_hash !== this.filterHash ||
      typeof value.last_id !== "string" ||
      !uuid.test(value.last_id)
    )
      invalid("cursor");
    utc(value.last_at, "cursor");
    return { last_at: value.last_at as string, last_id: value.last_id };
  }
}
