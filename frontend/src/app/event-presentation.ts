import type { ManagementDetail } from "../services/events";
import { formatEventTime } from "../services/event-time";

export function humanLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export const readinessLabels: Record<string, string> = {
  VISIBILITY_REQUIRED: "Choose Public or Invitation access in Setup.",
  SCHEDULE_REQUIRED: "Set when the event starts and ends in Setup.",
  TIME_ZONE_REQUIRED: "Choose the event time zone in Setup.",
  REGISTRATION_CAPACITY_REQUIRED: "Set a registration limit in Setup.",
  CONFIGURED_GATE_REQUIRED:
    "Your event needs at least one configured gate before it can be published or started.",
};

export function registrationStatus(
  detail: ManagementDetail,
  registered?: number | null,
): string {
  if (detail.state === "DRAFT")
    return "Registration opens after the event is published";
  if (detail.state === "LIVE")
    return "Registration is closed because the event is live";
  if (detail.state === "COMPLETED")
    return "Registration is closed because the event has completed";
  if (detail.state === "CANCELLED")
    return "Registration is closed because the event was cancelled";
  if (detail.availability.policy_status === "CLOSED") {
    if (detail.availability.reasons.includes("MANUALLY_CLOSED"))
      return "Registration is closed by the organizer";
    if (detail.availability.reasons.includes("SCHEDULED_CLOSE_REACHED"))
      return "Registration is closed";
    if (detail.availability.reasons.includes("NOT_OPEN_YET"))
      return `Registration opens on ${formatEventTime(detail.availability.opens_at, detail.time_zone)}`;
    return "Registration is closed";
  }
  if (
    registered != null &&
    detail.registration_capacity != null &&
    registered >= detail.registration_capacity
  )
    return "Registration is full";
  return registered == null
    ? "The registration window is open; available places have not been confirmed"
    : "Registration is open";
}
