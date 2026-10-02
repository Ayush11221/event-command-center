import { describe, expect, it } from "vitest";
import { managementReadiness } from "./readiness.js";
import { parseGateBody } from "./gates.js";

const event = {
  id: "event",
  visibility: "PUBLIC" as const,
  startAt: new Date("2030-01-01T10:00:00Z"),
  endAt: new Date("2030-01-01T12:00:00Z"),
  timeZone: "UTC",
  registrationCapacity: 100,
};
describe("shared configured-gate readiness", () => {
  it("independently blocks Publish and Live when the association is absent", () => {
    expect(managementReadiness(event, [])).toEqual({
      configured_gate_present: false,
      publish_blockers: ["CONFIGURED_GATE_REQUIRED"],
      live_blockers: ["CONFIGURED_GATE_REQUIRED"],
    });
  });
  it("association alone satisfies the gate guard, while other Publish blockers remain", () => {
    expect(
      managementReadiness({ ...event, visibility: null }, [
        { id: "gate", eventId: event.id },
      ]),
    ).toEqual({
      configured_gate_present: true,
      publish_blockers: ["VISIBILITY_REQUIRED"],
      live_blockers: [],
    });
    expect(
      managementReadiness(event, [{ id: "gate", eventId: event.id }])
        .publish_blockers,
    ).toEqual([]);
  });
  it("does not use another event's Gate as readiness evidence", () => {
    expect(
      managementReadiness(event, [{ id: "gate", eventId: "other" }])
        .configured_gate_present,
    ).toBe(false);
  });
  it.each([
    null,
    [],
    "",
    { name: "Gate" },
    { event_id: "other" },
    { staff_ready: true },
  ])("rejects undocumented Gate payload %#", (body) => {
    expect(() => parseGateBody(body)).toThrow(
      expect.objectContaining({ status: 400, code: "VALIDATION" }),
    );
  });
});
