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
  const validSchedule =
    !!event.startAt &&
    !!event.endAt &&
    Number.isFinite(event.startAt.getTime()) &&
    Number.isFinite(event.endAt.getTime()) &&
    event.endAt > event.startAt;
  let validTimeZone = false;
  if (event.timeZone && !/^[+-]/.test(event.timeZone)) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: event.timeZone });
      validTimeZone = true;
    } catch {
      /* Invalid stored configuration remains a publication blocker. */
    }
  }
  const validCapacity =
    event.registrationCapacity !== null &&
    Number.isInteger(event.registrationCapacity) &&
    event.registrationCapacity > 0;
  return {
    configured_gate_present: configuredGatePresent,
    publish_blockers: [
      ...(event.visibility ? [] : ["VISIBILITY_REQUIRED"]),
      ...(validSchedule ? [] : ["SCHEDULE_REQUIRED"]),
      ...(validTimeZone ? [] : ["TIME_ZONE_REQUIRED"]),
      ...(validCapacity ? [] : ["REGISTRATION_CAPACITY_REQUIRED"]),
      ...(configuredGatePresent ? [] : ["CONFIGURED_GATE_REQUIRED"]),
    ],
    live_blockers: configuredGatePresent ? [] : ["CONFIGURED_GATE_REQUIRED"],
  };
}
