import { describe, expect, it } from "vitest";
import { decodeEventCursor, encodeEventCursor } from "./cursor.js";
import { parseCreateDraftBody, parseEventListQuery } from "./validation.js";

const key = new Uint8Array(32).fill(8);
const actor = "65b30ddc-a507-4db8-b8e3-20224ed4070f";
const eventId = "e6065cde-a9ed-40cf-9724-fbdb07174fa9";

describe("Slice 3 V2 transport validation", () => {
  it("accepts only the approved list query and limit range", () => {
    expect(parseEventListQuery({ view: "owned" })).toEqual({
      view: "owned",
      limit: 20,
    });
    expect(parseEventListQuery({ view: "assigned", limit: "100" })).toEqual({
      view: "assigned",
      limit: 100,
    });
    for (const query of [
      {},
      { view: "other" },
      { view: "owned", limit: "0" },
      { view: "owned", limit: "101" },
      { view: "owned", limit: "1.5" },
      { view: "owned", cursor: "" },
      { view: "owned", owner_id: actor },
    ])
      expect(() => parseEventListQuery(query)).toThrow();
  });

  it("requires exactly one nonblank bounded Draft name", () => {
    expect(parseCreateDraftBody({ name: "  Opening night  " })).toEqual({
      name: "  Opening night  ",
    });
    expect(parseCreateDraftBody({ name: "🎟".repeat(200) })).toEqual({
      name: "🎟".repeat(200),
    });
    for (const value of [
      null,
      [],
      {},
      { name: "   " },
      { name: 42 },
      { name: "x".repeat(201) },
      { name: "🎟".repeat(201) },
      { name: "Valid", state: "PUBLISHED" },
    ])
      expect(() => parseCreateDraftBody(value)).toThrow();
  });

  it("binds signed list cursors to actor, view and ordered tuple", () => {
    const cursor = encodeEventCursor(
      {
        v: 1,
        actor,
        view: "owned",
        created_at: "2030-01-02T03:04:05.000Z",
        event_id: eventId,
      },
      key,
    );
    expect(decodeEventCursor(cursor, actor, "owned", key).event_id).toBe(
      eventId,
    );
    expect(() => decodeEventCursor(cursor, actor, "assigned", key)).toThrow();
    expect(() => decodeEventCursor(cursor, eventId, "owned", key)).toThrow();
    expect(() =>
      decodeEventCursor(`${cursor}x`, actor, "owned", key),
    ).toThrow();
  });
});
