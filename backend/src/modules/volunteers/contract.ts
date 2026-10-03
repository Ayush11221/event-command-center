import { invalid, utc, uuid } from "../events/scoped-cursor.js";
export interface Details {
  title: string;
  instructions: string;
  location: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
}
export function object(
  value: unknown,
  fields: string[],
  required: string[] = [],
) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("body");
  const data = value as Record<string, unknown>;
  for (const key of Object.keys(data)) if (!fields.includes(key)) invalid(key);
  for (const key of required) if (!(key in data)) invalid(key);
  return data;
}
export function text(value: unknown, field: string, max: number) {
  if (typeof value !== "string" || !value.trim() || [...value].length > max)
    invalid(field);
  return value.trim();
}
export function volunteer(value: unknown) {
  if (typeof value !== "string" || !uuid.test(value))
    invalid("assigned_volunteer_id");
  return value.toLowerCase();
}
const fields = ["title", "instructions", "location", "starts_at", "ends_at"];
export function details(value: unknown, create = false): Partial<Details> {
  const data = object(
    value,
    create ? [...fields, "assigned_volunteer_id"] : fields,
    create ? [...fields, "assigned_volunteer_id"] : [],
  );
  if (!Object.keys(data).length) invalid("body");
  const out: Partial<Details> = {};
  if ("title" in data) out.title = text(data.title, "title", 160);
  if ("instructions" in data)
    out.instructions = text(data.instructions, "instructions", 4000);
  if ("location" in data)
    out.location =
      data.location === null ? null : text(data.location, "location", 240);
  if ("starts_at" in data)
    out.startsAt =
      data.starts_at === null ? null : utc(data.starts_at, "starts_at");
  if ("ends_at" in data)
    out.endsAt = data.ends_at === null ? null : utc(data.ends_at, "ends_at");
  return out;
}
export function timeWindow(data: Pick<Details, "startsAt" | "endsAt">) {
  if (data.startsAt && data.endsAt && data.endsAt <= data.startsAt)
    invalid("ends_at");
}
