import type { Event, Gate } from "@prisma/client";

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

export function managementDraftDetail(
  event: Event,
  gates: Pick<Gate, "id" | "eventId">[],
  asOf: Date,
  correlationId: string,
) {
  const configuredGatePresent = gates.length > 0;
  const publishBlockers = [
    ...(event.visibility ? [] : ["VISIBILITY_REQUIRED"]),
    ...(event.startAt && event.endAt ? [] : ["SCHEDULE_REQUIRED"]),
    ...(event.timeZone ? [] : ["TIME_ZONE_REQUIRED"]),
    ...(event.registrationCapacity ? [] : ["REGISTRATION_CAPACITY_REQUIRED"]),
    ...(configuredGatePresent ? [] : ["CONFIGURED_GATE_REQUIRED"]),
  ];
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
    readiness: {
      configured_gate_present: configuredGatePresent,
      publish_blockers: publishBlockers,
      live_blockers: configuredGatePresent ? [] : ["CONFIGURED_GATE_REQUIRED"],
    },
    availability: {
      policy_status: "OPEN",
      reasons: [],
      opens_at: timestamp(event.registrationOpensAt),
      closes_at: timestamp(event.registrationClosesAt ?? event.startAt),
      as_of: asOf.toISOString(),
    },
    permitted_actions: ["EDIT_EVENT", "CREATE_GATE", "CANCEL"],
    revision: event.revision,
    as_of: asOf.toISOString(),
    correlation_id: correlationId,
  };
}
