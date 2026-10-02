import type { Event } from "@prisma/client";

type AvailabilityConfiguration = Pick<
  Event,
  | "registrationOpensAt"
  | "registrationClosesAt"
  | "startAt"
  | "registrationManuallyClosed"
>;

export function managementAvailability(
  event: AvailabilityConfiguration,
  asOf: Date,
) {
  const closesAt = event.registrationClosesAt ?? event.startAt;
  const reasons: (
    "NOT_OPEN_YET" | "SCHEDULED_CLOSE_REACHED" | "MANUALLY_CLOSED"
  )[] = [];
  if (event.registrationOpensAt && asOf < event.registrationOpensAt)
    reasons.push("NOT_OPEN_YET");
  if (closesAt && asOf >= closesAt) reasons.push("SCHEDULED_CLOSE_REACHED");
  if (event.registrationManuallyClosed) reasons.push("MANUALLY_CLOSED");
  return {
    policy_status: reasons.length ? "CLOSED" : "OPEN",
    reasons,
    opens_at: event.registrationOpensAt?.toISOString() ?? null,
    closes_at: closesAt?.toISOString() ?? null,
    as_of: asOf.toISOString(),
  };
}
