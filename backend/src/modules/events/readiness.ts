import type { Event, Gate } from "@prisma/client";

export function managementReadiness(
  event: Pick<
    Event,
    | "id"
    | "visibility"
    | "startAt"
    | "endAt"
    | "timeZone"
    | "registrationCapacity"
  >,
  gates: Pick<Gate, "id" | "eventId">[],
) {
  const configuredGatePresent = gates.some((gate) => gate.eventId === event.id);
  return {
    configured_gate_present: configuredGatePresent,
    publish_blockers: [
      ...(event.visibility ? [] : ["VISIBILITY_REQUIRED"]),
      ...(event.startAt && event.endAt ? [] : ["SCHEDULE_REQUIRED"]),
      ...(event.timeZone ? [] : ["TIME_ZONE_REQUIRED"]),
      ...(event.registrationCapacity ? [] : ["REGISTRATION_CAPACITY_REQUIRED"]),
      ...(configuredGatePresent ? [] : ["CONFIGURED_GATE_REQUIRED"]),
    ],
    live_blockers: configuredGatePresent ? [] : ["CONFIGURED_GATE_REQUIRED"],
  };
}
