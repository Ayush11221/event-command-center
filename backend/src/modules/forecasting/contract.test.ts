import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  fallback,
  inputFor,
  LIMITATIONS,
  METHOD,
  validResult,
  type ForecastRequest,
  type ForecastResult,
} from "./contract.js";
import { freshness, historyParameters } from "./service.js";

const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const start = Date.parse("2026-10-01T00:00:00.000Z"),
  end = start + 269 * 60000;
const request: ForecastRequest = {
  contract_version: 1,
  event_id: eventId,
  as_of: new Date(end).toISOString(),
  time_zone: null,
  schedule: { start_at: null, end_at: null },
  occupied: 270,
  capacity: 1,
  revision: 270,
  horizons: [30, 60],
  method: { name: "persistence", version: "1" },
  observations: Array.from({ length: 270 }, (_, i) => ({
    at: new Date(start + i * 60000).toISOString(),
    value: i + 1,
    quality: "COMMITTED" as const,
  })),
};
function result(): ForecastResult {
  return {
    contract_version: 1,
    event_id: eventId,
    generated_at: request.as_of,
    status: "AVAILABLE",
    input: inputFor(request),
    method: METHOD,
    limitations: [...LIMITATIONS],
    points: [30, 60].map((h) => ({
      horizon_minutes: h as 30 | 60,
      target_at: new Date(end + h * 60000).toISOString(),
      predicted_occupancy: 270,
      uncertainty: {
        method: "validation_residual_quantile",
        nominal_coverage: 0.9,
        lower: 270 - h,
        upper: 270 + h,
      },
    })),
    evaluation: {
      kind: "BASELINE_ONLY",
      split: {
        training: {
          start_at: new Date(start).toISOString(),
          end_at: new Date(start + 89 * 60000).toISOString(),
        },
        validation: {
          start_at: new Date(start + 90 * 60000).toISOString(),
          end_at: new Date(start + 179 * 60000).toISOString(),
        },
        test: {
          start_at: new Date(start + 180 * 60000).toISOString(),
          end_at: request.as_of,
        },
      },
      horizons: [30, 60].map((h) => ({
        horizon_minutes: h as 30 | 60,
        samples: 90 - h,
        mae: h,
        rmse: h,
        baseline_mae: h,
        baseline_rmse: h,
        interval_coverage: 1,
        availability_coverage: 1,
      })),
    },
  };
}
describe("Slice 8 result, freshness and cursor contract", () => {
  it("accepts baseline output above registration capacity", () =>
    expect(validResult(result(), eventId)).toBe(true));
  it.each([
    "event",
    "version",
    "extra",
    "horizon",
    "target",
    "negative",
    "infinite",
    "interval",
    "split",
    "samples",
    "baseline",
    "coverage",
    "privacy",
    "timestamp",
    "stale",
  ])("rejects unsafe/incompatible %s", (kind) => {
    const value = result();
    if (kind === "event") value.event_id = "foreign";
    if (kind === "version") Object.assign(value, { contract_version: 2 });
    if (kind === "extra") Object.assign(value, { contact: "secret" });
    if (kind === "horizon") value.points.reverse();
    if (kind === "target") value.points[0].target_at = value.generated_at;
    if (kind === "negative") value.points[0].predicted_occupancy = -1;
    if (kind === "infinite") value.points[0].uncertainty.upper = Infinity;
    if (kind === "interval") value.points[0].uncertainty.lower = 300;
    if (kind === "split")
      value.evaluation!.split.test.start_at =
        value.evaluation!.split.validation.start_at;
    if (kind === "samples") value.evaluation!.horizons[0].samples = 1;
    if (kind === "baseline") value.evaluation!.horizons[0].baseline_mae = 0;
    if (kind === "coverage")
      value.evaluation!.horizons[0].interval_coverage = 2;
    if (kind === "privacy")
      value.limitations[0] = "internal Python exception secret";
    if (kind === "timestamp") value.generated_at = "2026-10-01T00:00:00Z";
    if (kind === "stale")
      value.generated_at = new Date(end + 60001).toISOString();
    expect(validResult(value, eventId)).toBe(false);
  });
  it.each([
    "INSUFFICIENT_DATA",
    "STALE_INPUT",
    "MODEL_UNAVAILABLE",
    "INVALID_INPUT",
  ] as const)("persists typed %s without synthetic points", (status) => {
    const value = fallback(request, status);
    expect(validResult(value, eventId)).toBe(true);
    expect(value.points).toEqual([]);
    expect(value.evaluation).toBeNull();
    const snapshot = {
      occupied: 300,
      capacity: 2,
      attendance_state: "INSIDE" as const,
      revision: 300,
      as_of: new Date(end + 120000).toISOString(),
    };
    expect(freshness(value, snapshot)).toMatchObject({
      state: "UNAVAILABLE",
      reason: status,
    });
  });
  it("gives changed observations precedence over expiry, including capacity", () => {
    const value = result(),
      snapshot = {
        occupied: 270,
        capacity: 1,
        attendance_state: "INSIDE" as const,
        revision: 270,
        as_of: new Date(end + 59999).toISOString(),
      };
    expect(freshness(value, snapshot).state).toBe("CURRENT");
    expect(
      freshness(value, {
        ...snapshot,
        as_of: new Date(end + 60000).toISOString(),
      }).reason,
    ).toBe("AGE_EXCEEDED");
    expect(
      freshness(value, {
        ...snapshot,
        revision: 271,
        as_of: new Date(end + 120000).toISOString(),
      }).reason,
    ).toBe("OBSERVATIONS_CHANGED");
    expect(freshness(value, { ...snapshot, capacity: 2 }).reason).toBe(
      "OBSERVATIONS_CHANGED",
    );
  });
  it("accepts only bounded event-bound versioned keysets", () => {
    const cursor = Buffer.from(
      JSON.stringify({
        version: 1,
        event_id: eventId,
        persisted_at: request.as_of,
        run_id: eventId,
      }),
    ).toString("base64url");
    expect(historyParameters({}, eventId)).toEqual({
      limit: 20,
      cursor: undefined,
    });
    expect(
      historyParameters({ limit: "100", cursor }, eventId).cursor?.run_id,
    ).toBe(eventId);
    for (const query of [
      { limit: "0" },
      { limit: "101" },
      { limit: "1.0" },
      { limit: ["1", "2"] },
      { cursor: [cursor, cursor] },
      { cursor: "bad" },
      { cursor: "x".repeat(513) },
      { horizon: "30" },
    ])
      expect(() => historyParameters(query, eventId)).toThrowError(
        expect.objectContaining({ code: "VALIDATION" }),
      );
    expect(() =>
      historyParameters({ cursor }, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    ).toThrow();
  });
  it("has only finalized public read paths, closed schemas and resolved references", () => {
    const spec = JSON.parse(
      readFileSync(
        new URL("../../../../docs/api/SLICE_8_OPENAPI.json", import.meta.url),
        "utf8",
      ),
    );
    expect(Object.keys(spec.paths)).toEqual([
      "/events/{eventId}/forecasts/current",
      "/events/{eventId}/forecasts",
    ]);
    for (const route of Object.values(spec.paths) as {
      get: { security: unknown; requestBody?: unknown; responses: object };
    }[]) {
      expect(Object.keys(route)).toEqual(["get"]);
      expect(route.get.security).toEqual([{ AccountSession: [] }]);
      expect(route.get.requestBody).toBeUndefined();
      expect(Object.keys(route.get.responses)).toEqual([
        "200",
        "400",
        "401",
        "404",
        "503",
      ]);
    }
    function visit(value: unknown) {
      if (!value || typeof value !== "object") return;
      const obj = value as Record<string, unknown>;
      if (typeof obj.$ref === "string") {
        let target: unknown = spec;
        for (const part of obj.$ref.slice(2).split("/")) {
          target = (target as Record<string, unknown>)[part];
          expect(target).toBeDefined();
        }
      }
      if (obj.type === "object") {
        expect(obj.additionalProperties).toBe(false);
        expect(obj.required).toEqual(Object.keys(obj.properties as object));
      }
      Object.values(obj).forEach(visit);
    }
    visit(spec);
  });
});

describe("forecast history compatibility", () => {
  it("reads retained entry-only runs without accepting them from the updated service", () => {
    const result = fallback(request, "MODEL_UNAVAILABLE");
    result.limitations = result.limitations.map((v) =>
      v === "ACCEPTED_ATTENDANCE_HISTORY" ? "CHECK_IN_ONLY" : v,
    );
    expect(validResult(result, eventId)).toBe(false);
    expect(validResult(result, eventId, true)).toBe(true);
    result.limitations[0] = "ACCEPTED_ATTENDANCE_HISTORY";
    expect(validResult(result, eventId, true)).toBe(false);
  });
});
