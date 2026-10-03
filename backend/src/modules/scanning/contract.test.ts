import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const spec = JSON.parse(
  readFileSync(
    new URL("../../../../docs/api/SLICE_5_OPENAPI.json", import.meta.url),
    "utf8",
  ),
);
describe("Slice 5 additive contract", () => {
  it("adds exactly the implemented scanner operation and leaves frozen artifacts intact", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths)).toEqual(["/scan-decisions"]);
    expect(Object.keys(spec.paths["/scan-decisions"])).toEqual(["post"]);
    const markdown = readFileSync(
      new URL("../../../../docs/api/API_CONTRACT.md", import.meta.url),
      "utf8",
    ).split("## Slice 5 implemented")[1];
    expect(markdown).toContain("POST /api/v1/scan-decisions");
    for (const [filename, count] of [
      ["SLICE_3_OPENAPI.json", 12],
      ["SLICE_4_OPENAPI.json", 5],
    ] as const) {
      const previous = JSON.parse(
        readFileSync(
          new URL("../../../../docs/api/" + filename, import.meta.url),
          "utf8",
        ),
      );
      expect(
        Object.values(previous.paths).flatMap((value) =>
          Object.keys(value as object),
        ),
      ).toHaveLength(count);
    }
  });
  it("resolves local references and declares all required schema fields", () => {
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
    for (const schema of Object.values(spec.components.schemas) as {
      required: string[];
      properties: Record<string, unknown>;
    }[])
      for (const key of schema.required)
        expect(schema.properties).toHaveProperty(key);
  });
  it("requires account/CSRF/Origin/idempotency and excludes unimplemented direction/client authority", () => {
    const operation = spec.paths["/scan-decisions"].post;
    expect(operation.security).toEqual([{ AccountSession: [] }]);
    expect(
      operation.parameters.map((p: { name: string; required: boolean }) => [
        p.name,
        p.required,
      ]),
    ).toEqual([
      ["Idempotency-Key", true],
      ["X-CSRF-Token", true],
      ["Origin", true],
    ]);
    const schema = spec.components.schemas.ScanRequest;
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties)).toEqual([
      "scan_id",
      "event_id",
      "gate_id",
      "credential",
    ]);
    expect(schema.properties.credential.maxLength).toBe(128);
    expect(Object.keys(operation.responses)).toEqual([
      "200",
      "400",
      "401",
      "403",
      "409",
      "410",
      "503",
    ]);
  });
  it("closes the result allowlist and masks foreign credentials without leaking participant data", () => {
    const schema = spec.components.schemas.ScanResult;
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties)).toEqual([
      "scan_id",
      "event_id",
      "gate_id",
      "decision",
      "reason",
      "registration_status",
      "attendance_status",
      "decided_at",
      "replayed",
      "correlation_id",
    ]);
    expect(schema.properties.reason.enum).toEqual([
      "ACCEPTED",
      "INVALID_CREDENTIAL",
      "EXPIRED_CREDENTIAL",
      "CANCELLED_CREDENTIAL",
      "ALREADY_CHECKED_IN",
      "REGISTRATION_UNAVAILABLE",
    ]);
    expect(spec.paths["/scan-decisions"].post.description).toContain(
      "Wrong-event is privacy-masked",
    );
    expect(schema.allOf[0].then.properties.attendance_status.const).toBe(
      "INSIDE",
    );
  });
});
