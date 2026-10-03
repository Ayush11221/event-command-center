import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  matchesSchema,
  openapi,
} from "../../../../tests/contract/slice11-schema.mjs";
import { details, text } from "./contract.js";
describe("Slice 11 finalized OpenAPI", () => {
  it("resolves every reference and describes exactly nine authenticated operations", () => {
    function walk(value: unknown) {
      if (!value || typeof value !== "object") return;
      for (const [key, item] of Object.entries(value)) {
        if (key === "$ref") {
          let target: unknown = openapi;
          for (const part of String(item).slice(2).split("/"))
            target = (target as Record<string, unknown>)[part];
          expect(target, String(item)).toBeDefined();
        } else walk(item);
      }
    }
    walk(openapi);
    const operations = Object.values(
      openapi.paths as Record<string, Record<string, unknown>>,
    ).flatMap((path) => Object.values(path));
    expect(operations).toHaveLength(9);
    for (const op of operations)
      expect(op).toHaveProperty("security", [{ AccountSession: [] }]);
  });
  it("keeps cancellation evidence conditional and DTOs closed", () => {
    const id = randomUUID(),
      at = "2026-10-03T10:00:00.000Z",
      task = {
        id,
        event_id: id,
        assigned_volunteer_id: id,
        title: "Task",
        instructions: "Help",
        location: null,
        starts_at: null,
        ends_at: null,
        status: "ASSIGNED",
        created_at: at,
        updated_at: at,
        cancelled_at: null,
        cancelled_by_user_id: null,
        cancellation_reason: null,
      };
    expect(matchesSchema(openapi.components.schemas.Task, task)).toBe(true);
    expect(
      matchesSchema(openapi.components.schemas.Task, { ...task, revision: 1 }),
    ).toBe(false);
    expect(
      matchesSchema(openapi.components.schemas.Task, {
        ...task,
        status: "CANCELLED",
      }),
    ).toBe(false);
    expect(
      matchesSchema(openapi.components.schemas.Task, {
        ...task,
        status: "CANCELLED",
        cancelled_at: at,
        cancelled_by_user_id: id,
        cancellation_reason: "Shift ended",
      }),
    ).toBe(true);
    expect(
      matchesSchema(openapi.components.schemas.Task, {
        ...task,
        cancellation_reason: "Hidden evidence",
      }),
    ).toBe(false);
  });
  it("validates Unicode code points, nullable times, plain text and nonblank edits", () => {
    expect(text("😀".repeat(500), "reason", 500)).toHaveLength(1000);
    expect(() => text("😀".repeat(501), "reason", 500)).toThrow();
    expect(() => details({})).toThrow();
    expect(() => details({ title: "\t\n" })).toThrow();
    expect(details({ instructions: " <b>plain text</b> " })).toEqual({
      instructions: "<b>plain text</b>",
    });
    expect(() => details({ starts_at: "2026-10-03T10:00:00Z" })).toThrow();
  });
});
