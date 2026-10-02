import type { Event } from "@prisma/client";
import { ApiError } from "../auth/errors.js";

export const publicEditFields = {
  name: "name",
  description: "description",
  public_location: "publicLocation",
  image_url: "imageUrl",
  category: "category",
  tags: "tags",
} as const;
export const organizerEditFields = {
  ...publicEditFields,
  start_at: "startAt",
  end_at: "endAt",
  time_zone: "timeZone",
  visibility: "visibility",
  registration_capacity: "registrationCapacity",
  registration_opens_at: "registrationOpensAt",
  registration_closes_at: "registrationClosesAt",
  registration_cancellation_cutoff_at: "registrationCancellationCutoffAt",
  registration_manually_closed: "registrationManuallyClosed",
  checkout_enabled: "checkoutEnabled",
} as const;
type EditProperty =
  (typeof organizerEditFields)[keyof typeof organizerEditFields];
export type EventEdit = Partial<Pick<Event, EditProperty>>;

function invalid(field?: string): never {
  throw new ApiError(400, "VALIDATION", "Invalid event configuration", {
    details: field ? { field } : undefined,
  });
}

// Bounds supplement the database's name/location/category column limits.
export const editLimits = {
  name: 200,
  description: 5000,
  public_location: 500,
  image_url: 2048,
  category: 100,
  time_zone: 100,
  tags: 20,
  tag: 100,
} as const;

function text(value: unknown, field: keyof typeof editLimits): string | null {
  if (value === null && field !== "name") return null;
  if (typeof value !== "string") invalid(field);
  const trimmed = value.trim();
  if (!trimmed || [...trimmed].length > editLimits[field]) invalid(field);
  return trimmed;
}

function timestamp(value: unknown, field: string): Date | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    invalid(field);
  const date = new Date(value);
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    Number(value.slice(11, 13)) > 23 ||
    Number(value.slice(14, 16)) > 59 ||
    Number(value.slice(17, 19)) > 59
  )
    invalid(field);
  return date;
}

export function parseEventEdit(body: unknown, owner: boolean): EventEdit {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid();
  const fields = Object.keys(body);
  if (fields.length === 0) invalid();
  const allowlist = owner ? organizerEditFields : publicEditFields;
  if (fields.some((field) => !Object.hasOwn(allowlist, field))) {
    if (!owner) throw new ApiError(403, "FORBIDDEN", "Field not permitted");
    invalid(); // Never reflect unknown keys (which could contain secrets).
  }
  const data: EventEdit = {};
  for (const [field, value] of Object.entries(body)) {
    switch (field) {
      case "name":
        data.name = text(value, "name")!;
        break;
      case "description":
        data.description = text(value, field);
        break;
      case "public_location":
        data.publicLocation = text(value, field);
        break;
      case "category":
        data.category = text(value, field);
        break;
      case "image_url": {
        const image = text(value, field);
        if (image !== null) {
          let url: URL;
          try {
            url = new URL(image);
          } catch {
            invalid(field);
          }
          if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            !url.hostname ||
            url.hostname === "localhost" ||
            url.hostname.endsWith(".localhost")
          )
            invalid(field);
        }
        data.imageUrl = image;
        break;
      }
      case "tags": {
        if (!Array.isArray(value) || value.length > editLimits.tags)
          invalid(field);
        const tags = value.map((tag: unknown) => {
          if (
            typeof tag !== "string" ||
            !tag.trim() ||
            [...tag.trim()].length > editLimits.tag
          )
            invalid(field);
          return tag.trim();
        });
        if (new Set(tags).size !== tags.length) invalid(field);
        data.tags = tags;
        break;
      }
      case "start_at":
        data.startAt = timestamp(value, field);
        break;
      case "end_at":
        data.endAt = timestamp(value, field);
        break;
      case "registration_opens_at":
        data.registrationOpensAt = timestamp(value, field);
        break;
      case "registration_closes_at":
        data.registrationClosesAt = timestamp(value, field);
        break;
      case "registration_cancellation_cutoff_at":
        data.registrationCancellationCutoffAt = timestamp(value, field);
        break;
      case "time_zone": {
        const zone = text(value, field);
        if (zone !== null) {
          if (/^[+-]/.test(zone)) invalid(field);
          try {
            new Intl.DateTimeFormat("en", { timeZone: zone });
          } catch {
            invalid(field);
          }
        }
        data.timeZone = zone;
        break;
      }
      case "visibility":
        if (value !== null && value !== "PUBLIC" && value !== "PRIVATE")
          invalid(field);
        data.visibility = value;
        break;
      case "registration_capacity":
        if (
          value !== null &&
          (typeof value !== "number" ||
            !Number.isInteger(value) ||
            value < 1 ||
            value > 2147483647)
        )
          invalid(field);
        data.registrationCapacity = value;
        break;
      case "registration_manually_closed":
        if (typeof value !== "boolean") invalid(field);
        data.registrationManuallyClosed = value;
        break;
      case "checkout_enabled":
        if (typeof value !== "boolean") invalid(field);
        data.checkoutEnabled = value;
        break;
    }
  }
  return data;
}

export function validateEventEdit(current: Event, edit: EventEdit): void {
  const next = { ...current, ...edit };
  if ((next.startAt === null) !== (next.endAt === null))
    invalid(next.startAt ? "end_at" : "start_at");
  if (next.startAt && next.endAt && next.endAt <= next.startAt)
    invalid("end_at");
  if (
    next.registrationOpensAt &&
    next.registrationClosesAt &&
    next.registrationClosesAt <= next.registrationOpensAt
  )
    invalid("registration_closes_at");
}
