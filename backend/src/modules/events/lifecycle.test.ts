import { describe, expect, it } from "vitest";
import {
  lifecycleActions,
  parseTransitionBody,
  requireLifecycleEdge,
} from "./lifecycle.js";
import { managementAvailability } from "./availability.js";

const states = [
  "DRAFT",
  "PUBLISHED",
  "LIVE",
  "COMPLETED",
  "CANCELLED",
] as const;
const edges = [
  "DRAFT:PUBLISHED",
  "PUBLISHED:LIVE",
  "LIVE:COMPLETED",
  "DRAFT:CANCELLED",
  "PUBLISHED:CANCELLED",
  "LIVE:CANCELLED",
];
describe("V6 lifecycle and policy separation", () => {
  it.each(states.flatMap((from) => states.map((to) => [from, to] as const)))(
    "checks the %s → %s edge",
    (from, to) => {
      if (edges.includes(`${from}:${to}`))
        expect(() => requireLifecycleEdge(from, to)).not.toThrow();
      else
        expect(() => requireLifecycleEdge(from, to)).toThrow(
          expect.objectContaining({ status: 409, code: "INVALID_TRANSITION" }),
        );
    },
  );
  it("derives every lifecycle action from the same table", () => {
    expect(states.map(lifecycleActions)).toEqual([
      ["PUBLISH", "CANCEL"],
      ["LIVE", "CANCEL"],
      ["COMPLETE", "CANCEL"],
      [],
      [],
    ]);
  });
  it.each([
    {},
    [],
    null,
    { target_state: "PAUSED" },
    { target_state: "LIVE", confirmed: true },
    { target_state: "CANCELLED", reason: 1 },
  ])("rejects malformed or extended commands: %j", (body) => {
    expect(() => parseTransitionBody(body)).toThrow(
      expect.objectContaining({ status: 400, code: "VALIDATION" }),
    );
  });
  it.each([undefined, "", " \n\t "])(
    "requires a nonblank cancellation reason: %j",
    (reason) => {
      expect(() =>
        parseTransitionBody({ target_state: "CANCELLED", reason }),
      ).toThrow(expect.objectContaining({ status: 422, code: "VALIDATION" }));
    },
  );
  it("accepts full commands without a client authority flag", () => {
    expect(
      parseTransitionBody({
        target_state: "CANCELLED",
        reason: "  Venue unavailable  ",
      }),
    ).toEqual({ target_state: "CANCELLED", reason: "Venue unavailable" });
    for (const target_state of ["PUBLISHED", "LIVE", "COMPLETED"])
      expect(parseTransitionBody({ target_state })).toEqual({ target_state });
  });
  it.each(states)(
    "retains configuration-only OPEN policy in %s with a future configured close",
    (state) => {
      const now = new Date("2030-01-01T10:00:00Z");
      const event = {
        state,
        startAt: now,
        registrationOpensAt: null,
        registrationClosesAt: new Date("2030-01-01T12:00:00Z"),
        registrationManuallyClosed: false,
      };
      expect(managementAvailability(event, now)).toEqual({
        policy_status: "OPEN",
        reasons: [],
        opens_at: null,
        closes_at: "2030-01-01T12:00:00.000Z",
        as_of: now.toISOString(),
      });
    },
  );
  it("compares absolute instants across a DST boundary", () => {
    const configuration = {
      startAt: new Date("2030-11-03T03:00:00-05:00"),
      registrationOpensAt: new Date("2030-11-03T01:30:00-04:00"),
      registrationClosesAt: new Date("2030-11-03T01:30:00-05:00"),
      registrationManuallyClosed: false,
    };
    expect(
      managementAvailability(
        configuration,
        new Date("2030-11-03T05:29:59.999Z"),
      ).reasons,
    ).toEqual(["NOT_OPEN_YET"]);
    expect(
      managementAvailability(configuration, new Date("2030-11-03T05:30:00Z"))
        .policy_status,
    ).toBe("OPEN");
    expect(
      managementAvailability(configuration, new Date("2030-11-03T06:30:00Z"))
        .reasons,
    ).toEqual(["SCHEDULED_CLOSE_REACHED"]);
  });
});
