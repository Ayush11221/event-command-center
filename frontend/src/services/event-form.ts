import type { EventEdit, ManagementDetail } from "./events";
import {
  DEFAULT_EVENT_TIME_ZONE,
  eventTimeInput,
  serializeEventTime,
} from "./event-time";

export const publicEventFields = [
  "name",
  "description",
  "public_location",
  "image_url",
  "category",
  "tags",
] as const;
export const eventTimeFields = [
  "start_at",
  "end_at",
  "registration_opens_at",
  "registration_closes_at",
  "registration_cancellation_cutoff_at",
] as const;
const ownerFields = [
  ...eventTimeFields,
  "time_zone",
  "visibility",
  "registration_capacity",
  "registration_manually_closed",
  "checkout_enabled",
] as const;
export type EventField = keyof EventEdit;
export type EventFormValues = Record<EventField, string | boolean>;

export function eventFormValues(detail: ManagementDetail): EventFormValues {
  // Only an unscheduled Draft receives a default. Never reinterpret stored dates.
  const zone =
    detail.time_zone ??
    (detail.state === "DRAFT" &&
    eventTimeFields.every((field) => !detail[field])
      ? DEFAULT_EVENT_TIME_ZONE
      : "");
  return Object.fromEntries(
    [...publicEventFields, ...ownerFields].map((field) => [
      field,
      (eventTimeFields as readonly string[]).includes(field)
        ? eventTimeInput(detail[field] as string | null, zone)
        : field === "tags"
          ? detail.tags.join("\n")
          : field === "time_zone"
            ? zone
            : (detail[field] ?? ""),
    ]),
  ) as EventFormValues;
}

export function changedEventFields(
  values: EventFormValues,
  baseline: ManagementDetail,
  owner: boolean,
): EventField[] {
  const initial = eventFormValues(baseline);
  return [...publicEventFields, ...(owner ? ownerFields : [])].filter(
    (field) => values[field] !== initial[field],
  );
}

export function sameEventValue(
  field: string,
  left: unknown,
  right: unknown,
): boolean {
  if (
    field.endsWith("_at") &&
    typeof left === "string" &&
    typeof right === "string"
  )
    return (
      Number.isFinite(Date.parse(left)) &&
      Date.parse(left) === Date.parse(right)
    );
  return JSON.stringify(left) === JSON.stringify(right);
}

export class EventFormError extends Error {
  constructor(
    public readonly field: EventField,
    message: string,
  ) {
    super(message);
  }
}

export function eventFormPatch(
  values: EventFormValues,
  baseline: ManagementDetail,
  owner: boolean,
): EventEdit {
  const changed = new Set(changedEventFields(values, baseline, owner));
  // Persist the default together with the first entered schedule/policy times.
  if (
    owner &&
    !baseline.time_zone &&
    eventTimeFields.some((field) => changed.has(field) && values[field])
  )
    changed.add("time_zone");
  // Changing the zone keeps the visible wall times and explicitly reinterprets
  // them in the chosen zone, as the form's help text explains.
  if (changed.has("time_zone"))
    for (const field of eventTimeFields) if (values[field]) changed.add(field);
  const result: EventEdit = {};
  for (const field of changed) {
    const raw = values[field];
    let value: unknown;
    if ((eventTimeFields as readonly string[]).includes(field)) {
      try {
        value = serializeEventTime(String(raw), String(values.time_zone));
      } catch (error) {
        throw new EventFormError(field, (error as Error).message);
      }
    } else if (field === "tags")
      value = String(raw)
        .split("\n")
        .map((tag) => tag.trim())
        .filter(Boolean);
    else if (field === "registration_capacity")
      value = raw === "" ? null : Number(raw);
    else if (typeof raw === "boolean") value = raw;
    else value = raw.trim() || null;
    if (!sameEventValue(field, value, baseline[field]))
      Object.assign(result, { [field]: value });
  }
  return result;
}
