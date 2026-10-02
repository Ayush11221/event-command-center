import { describe, expect, it } from "vitest";
import {
  decodeEventCursor,
  decodePublicCursor,
  encodeEventCursor,
  encodePublicCursor,
} from "../events/cursor.js";
import { parsePublicCatalogQuery } from "./service.js";
import { publicCatalogItem, publicEventDetail } from "./serializers.js";

const key = new Uint8Array(32).fill(9),
  eventId = "e6065cde-a9ed-40cf-9724-fbdb07174fa9";
const now = new Date("2030-01-01T10:00:00Z");
const event = {
  id: eventId,
  name: "Public event",
  description: "Public description",
  startAt: now,
  endAt: new Date("2030-01-01T12:00:00Z"),
  timeZone: "Asia/Kolkata",
  publicLocation: "City hall",
  imageUrl: "https://example.org/banner.png",
  category: "Conference",
  tags: ["Research"],
  registrationOpensAt: null,
  registrationClosesAt: new Date("2030-01-01T14:00:00Z"),
  registrationManuallyClosed: false,
  ownerUserId: "secret-owner",
  revision: 42,
  registrationCapacity: 999,
  state: "PUBLISHED",
  gates: [{ secret: true }],
  privateAccessLinks: ["secret-proof"],
};
const listFields = [
  "event_id",
  "name",
  "start_at",
  "end_at",
  "time_zone",
  "public_location",
  "image_url",
  "category",
  "tags",
  "availability",
];
describe("V7 public serialization and pagination", () => {
  it("uses exact public list and detail allowlists even with protected fields present", () => {
    const item = publicCatalogItem(event, now),
      detail = publicEventDetail(event, now, "ref");
    expect(Object.keys(item).sort()).toEqual(listFields.sort());
    expect(Object.keys(detail).sort()).toEqual(
      [...listFields, "description", "as_of", "correlation_id"].sort(),
    );
    expect(Object.keys(item.availability).sort()).toEqual(
      ["policy_status", "reasons", "opens_at", "closes_at", "as_of"].sort(),
    );
    expect(JSON.stringify(detail)).not.toMatch(
      /secret|revision|capacity|gate|owner|state/,
    );
    expect(detail.availability).toMatchObject({
      policy_status: "OPEN",
      reasons: [],
      closes_at: "2030-01-01T14:00:00.000Z",
    });
  });
  it.each([
    ["NOT_OPEN_YET", { registrationOpensAt: new Date(now.getTime() + 1) }],
    ["SCHEDULED_CLOSE_REACHED", { registrationClosesAt: now }],
    ["MANUALLY_CLOSED", { registrationManuallyClosed: true }],
  ] as const)(
    "preserves the %s policy reason without lifecycle/capacity facts",
    (reason, configuration) => {
      expect(
        publicCatalogItem({ ...event, ...configuration }, now).availability,
      ).toMatchObject({ policy_status: "CLOSED", reasons: [reason] });
    },
  );
  it("shares configured/default close and multiple-reason semantics with V6", () => {
    expect(
      publicCatalogItem({ ...event, registrationClosesAt: null }, now)
        .availability.reasons,
    ).toEqual(["SCHEDULED_CLOSE_REACHED"]);
    expect(
      publicCatalogItem(
        {
          ...event,
          registrationOpensAt: new Date(now.getTime() + 1),
          registrationClosesAt: now,
          registrationManuallyClosed: true,
        },
        now,
      ).availability.reasons,
    ).toEqual(["NOT_OPEN_YET", "SCHEDULED_CLOSE_REACHED", "MANUALLY_CLOSED"]);
  });
  it("defaults to 20 and accepts the documented maximum of 100", () => {
    expect(parsePublicCatalogQuery({})).toEqual({ limit: 20 });
    expect(parsePublicCatalogQuery({ limit: "100", cursor: "opaque" })).toEqual(
      { limit: 100, cursor: "opaque" },
    );
  });
  it.each([
    { limit: "0" },
    { limit: "101" },
    { limit: "1.5" },
    { limit: ["1", "2"] },
    { cursor: "" },
    { cursor: [] },
    { cursor: "x".repeat(2049) },
    { visibility: "PRIVATE" },
    { state: "DRAFT" },
    { view: "owned" },
    { event_id: eventId },
  ])("rejects undocumented or malformed query %j", (query) => {
    expect(() => parsePublicCatalogQuery(query)).toThrow(
      expect.objectContaining({ status: 400, code: "VALIDATION" }),
    );
  });
  it("binds PUBLIC cursors to publication ordering and rejects management cursor reuse in both directions", () => {
    const value = {
      v: 1,
      view: "PUBLIC",
      published_at: now.toISOString(),
      event_id: eventId,
    } as const;
    const cursor = encodePublicCursor(value, key);
    expect(decodePublicCursor(cursor, key)).toEqual(value);
    expect(() => decodePublicCursor(cursor + "x", key)).toThrow();
    expect(() => decodePublicCursor(cursor, new Uint8Array(32))).toThrow();
    expect(() => decodeEventCursor(cursor, "actor", "owned", key)).toThrow();
    const management = encodeEventCursor(
      {
        v: 1,
        actor: "actor",
        view: "owned",
        created_at: now.toISOString(),
        event_id: eventId,
      },
      key,
    );
    expect(() => decodePublicCursor(management, key)).toThrow();
  });
  it.each(["2030-02-30T10:00:00.000Z", "invalid", undefined])(
    "rejects a signed invalid publication boundary %j",
    (published_at) => {
      const cursor = encodePublicCursor(
        { v: 1, view: "PUBLIC", published_at, event_id: eventId } as Parameters<
          typeof encodePublicCursor
        >[0],
        key,
      );
      expect(() => decodePublicCursor(cursor, key)).toThrow();
    },
  );
});
