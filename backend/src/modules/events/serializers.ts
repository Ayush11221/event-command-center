import type { Event, Gate } from "@prisma/client";
import { managementAvailability } from "./availability.js";
import { managementActions } from "./policy.js";
import { managementReadiness } from "./readiness.js";
import { lifecycleActions } from "./lifecycle.js";

export type ManagementListEvent = Pick<
  Event,
  "id" | "name" | "state" | "startAt" | "endAt" | "timeZone"
>;

const timestamp = (value: Date | null) => value?.toISOString() ?? null;

export function managementListItem(
  event: ManagementListEvent,
  relationship: "owned" | "assigned",
) {
  return {
    event_id: event.id,
    name: event.name,
    state: event.state,
    start_at: timestamp(event.startAt),
    end_at: timestamp(event.endAt),
    time_zone: event.timeZone,
    relationship,
  };
}

export function managementDetail(
  event: Event,
  gates: Pick<Gate, "id" | "eventId">[],
  asOf: Date,
  correlationId: string,
  owner: boolean,
) {
  const readiness = managementReadiness(event, gates);
  return {
    event_id: event.id,
    name: event.name,
    description: event.description,
    state: event.state,
    visibility: event.visibility,
    public_location: event.publicLocation,
    image_url: event.imageUrl,
    category: event.category,
    tags: event.tags,
    start_at: timestamp(event.startAt),
    end_at: timestamp(event.endAt),
    time_zone: event.timeZone,
    registration_capacity: event.registrationCapacity,
    registration_opens_at: timestamp(event.registrationOpensAt),
    registration_closes_at: timestamp(event.registrationClosesAt),
    registration_cancellation_cutoff_at: timestamp(
      event.registrationCancellationCutoffAt,
    ),
    registration_manually_closed: event.registrationManuallyClosed,
    checkout_enabled: event.checkoutEnabled,
    gates: gates.map((gate) => ({ gate_id: gate.id, event_id: gate.eventId })),
    readiness,
    availability: managementAvailability(event, asOf),
    permitted_actions: [
      ...new Set([
        ...managementActions(event.state, owner),
        ...(owner
          ? lifecycleActions(event.state).filter((action) =>
              action === "PUBLISH"
                ? readiness.publish_blockers.length === 0
                : action === "LIVE"
                  ? readiness.live_blockers.length === 0
                  : true,
            )
          : []),
      ]),
    ],
    revision: event.revision,
    as_of: asOf.toISOString(),
    correlation_id: correlationId,
  };
}
