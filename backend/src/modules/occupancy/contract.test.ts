import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const spec = JSON.parse(
  readFileSync(
    new URL("../../../../docs/api/SLICE_6_OPENAPI.json", import.meta.url),
    "utf8",
  ),
);
describe("Slice 6 additive contract", () => {
  it("implements only the internal read with account authority and no write contract", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths)).toEqual(["/events/{eventId}/operations"]);
    const route = spec.paths["/events/{eventId}/operations"];
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
    expect(
      readFileSync(
        new URL("../../../../docs/api/API_CONTRACT.md", import.meta.url),
        "utf8",
      ),
    ).toContain("GET /api/v1/events/{eventId}/operations");
  });
  it("allows negative remaining and utilization above 100 with a closed aggregate schema", () => {
    const schema = spec.components.schemas.OperationsSnapshot;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(Object.keys(schema.properties));
    expect(schema.properties.remaining.minimum).toBeUndefined();
    expect(schema.properties.utilization_percentage.maximum).toBeUndefined();
    expect(Object.keys(schema.properties)).toEqual([
      "event_id",
      "event_name",
      "event_state",
      "occupied",
      "registered",
      "capacity",
      "remaining",
      "utilization_percentage",
      "attendance_state",
      "last_attendance_at",
      "calculated_at",
      "correlation_id",
    ]);
  });
  it("resolves all local schema references", () => {
    function visit(value: unknown) {
      if (!value || typeof value !== "object") return;
      const object = value as Record<string, unknown>;
      if (typeof object.$ref === "string") {
        expect(object.$ref).toMatch(/^#\/components\//);
        let target: unknown = spec;
        for (const part of object.$ref.slice(2).split("/")) {
          target = (target as Record<string, unknown>)[part];
          expect(target).toBeDefined();
        }
      }
      Object.values(object).forEach(visit);
    }
    visit(spec);
  });
});
