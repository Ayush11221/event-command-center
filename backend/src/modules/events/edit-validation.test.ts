import { describe, expect, it } from "vitest";
import { editLimits, parseEventEdit } from "./edit-validation.js";

describe("event edit validation", () => {
  it.each([
    null,
    [],
    {},
    { name: "" },
    { name: "x".repeat(editLimits.name + 1) },
    { description: "x".repeat(editLimits.description + 1) },
    { public_location: "x".repeat(editLimits.public_location + 1) },
    { category: "x".repeat(editLimits.category + 1) },
    { image_url: "https://example.org/" + "x".repeat(editLimits.image_url) },
    { image_url: "http://example.org/image.png" },
    { image_url: "file:///secret" },
    { image_url: "data:image/png,x" },
    { image_url: "https://user:secret@example.org/image.png" },
    { tags: [""] },
    { tags: ["x", " x "] },
    { tags: Array.from({ length: editLimits.tags + 1 }, (_, i) => String(i)) },
    { tags: ["x".repeat(editLimits.tag + 1)] },
    { start_at: "2030-02-30T10:00:00Z" },
    { start_at: "2030-01-01" },
    { end_at: "2030-01-01T24:00:00Z" },
    { time_zone: "UTC+5" },
    { time_zone: "+05:30" },
    { registration_capacity: 1.5 },
    { registration_capacity: 0 },
    { registration_capacity: 2147483648 },
    { registration_manually_closed: "true" },
    { checkout_enabled: null },
    { visibility: "UNLISTED" },
    { state: "LIVE" },
  ])("rejects invalid field input %#", (body) => {
    expect(() => parseEventEdit(body, true)).toThrow(
      expect.objectContaining({ status: 400, code: "VALIDATION" }),
    );
  });
  it("supports documented nullable configuration and empty tags without clearing booleans", () => {
    expect(
      parseEventEdit(
        {
          description: null,
          public_location: null,
          image_url: null,
          category: null,
          tags: [],
          start_at: null,
          end_at: null,
          time_zone: null,
          visibility: null,
          registration_capacity: null,
          registration_opens_at: null,
          registration_closes_at: null,
          registration_cancellation_cutoff_at: null,
          registration_manually_closed: false,
          checkout_enabled: false,
        },
        true,
      ),
    ).toMatchObject({
      description: null,
      tags: [],
      startAt: null,
      endAt: null,
      registrationCapacity: null,
      registrationManuallyClosed: false,
      checkoutEnabled: false,
    });
  });
  it("accepts DST-offset instants and IANA zones without reinterpreting local time", () => {
    expect(
      parseEventEdit(
        {
          start_at: "2030-03-10T01:30:00-05:00",
          time_zone: "America/New_York",
        },
        true,
      ),
    ).toMatchObject({
      startAt: new Date("2030-03-10T06:30:00Z"),
      timeZone: "America/New_York",
    });
  });
});
