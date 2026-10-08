import { describe, expect, it } from "vitest";
import {
  eventTimeInput,
  formatEventTime,
  serializeEventTime,
  timeZoneLabel,
  timeZoneOptions,
} from "./event-time";
import { eventFormPatch, eventFormValues } from "./event-form";
import { eventDetailFixture } from "../test/event-fixture";

describe("event time model boundary", () => {
  it.each([
    ["Asia/Kolkata", "2026-10-20T10:00", "2026-10-20T04:30:00.000Z"],
    ["America/New_York", "2026-07-20T10:00", "2026-07-20T14:00:00.000Z"],
    ["America/New_York", "2026-01-20T10:00", "2026-01-20T15:00:00.000Z"],
    ["Australia/Lord_Howe", "2026-07-20T10:00", "2026-07-19T23:30:00.000Z"],
    ["UTC", "2026-10-20T10:00:12.125", "2026-10-20T10:00:12.125Z"],
  ])("round trips event-local clock time in %s", (zone, local, instant) => {
    expect(serializeEventTime(local, zone)).toBe(instant);
    expect(eventTimeInput(instant, zone)).toBe(local);
  });
  it.each(["2026-03-08T02:30", "2026-11-01T01:30"])(
    "rejects a missing or ambiguous clock time: %s",
    (value) => {
      expect(() => serializeEventTime(value, "America/New_York")).toThrow(
        /clocks change/,
      );
    },
  );
  it.each(["2026-02-30T10:00", "2026-10-20T", "T10:00", "2026-10-20T25:00"])(
    "rejects invalid/incomplete input: %s",
    (value) => {
      expect(() => serializeEventTime(value, "Asia/Kolkata")).toThrow();
    },
  );
  it("requires an explicit zone and never falls back to browser-local time", () => {
    expect(() => serializeEventTime("2026-10-20T10:00", "")).toThrow(
      /Choose a time zone/,
    );
    expect(() => serializeEventTime("2026-10-20T10:00", "Not/AZone")).toThrow(
      /valid time zone/,
    );
    expect(formatEventTime("2026-10-20T04:30:00Z", null)).toMatch(
      /Set the event time zone/,
    );
    expect(eventTimeInput("2026-10-20T04:30:00Z", null)).toBe("");
  });
  it("formats consistently for schedule, date and time purposes", () => {
    const instant = "2026-10-20T04:30:00Z";
    expect(formatEventTime(instant, "Asia/Kolkata", "time")).toBe(
      new Intl.DateTimeFormat(undefined, {
        timeZone: "Asia/Kolkata",
        timeStyle: "short",
      }).format(new Date(instant)),
    );
    expect(formatEventTime(instant, "UTC", "time")).not.toBe(
      formatEventTime(instant, "Asia/Kolkata", "time"),
    );
    expect(formatEventTime(instant, "Asia/Kolkata", "date")).toMatch(/20/);
    expect(formatEventTime("bad", "Asia/Kolkata")).toBe("Time unavailable");
  });
  it("offers recognizable locations and preserves valid existing aliases", () => {
    expect(timeZoneLabel("Asia/Kolkata")).toBe("Mumbai / India (Asia/Kolkata)");
    expect(timeZoneOptions("Asia/Calcutta")).toEqual(
      expect.arrayContaining([
        "Asia/Kolkata",
        "Asia/Calcutta",
        "UTC",
        "America/New_York",
      ]),
    );
  });
  it("preserves exact unchanged instants and serializes only changed fields", () => {
    const detail = eventDetailFixture({
      time_zone: "Asia/Kolkata",
      start_at: "2026-10-20T10:00:12.125+05:30",
    });
    const values = eventFormValues(detail);
    expect(eventFormPatch(values, detail, true)).toEqual({});
    expect(
      eventFormPatch({ ...values, name: "New name" }, detail, true),
    ).toEqual({ name: "New name" });
    expect(
      eventFormPatch({ ...values, start_at: "2026-10-20T11:00" }, detail, true),
    ).toEqual({ start_at: "2026-10-20T05:30:00.000Z" });
  });
  it("changes the zone with the visible clock times and excludes organizer fields for Event Admin", () => {
    const detail = eventDetailFixture({
      time_zone: "Asia/Kolkata",
      start_at: "2026-10-20T04:30:00Z",
    });
    const values = {
      ...eventFormValues(detail),
      time_zone: "UTC",
      registration_capacity: "999",
    };
    expect(eventFormPatch(values, detail, true)).toEqual({
      time_zone: "UTC",
      start_at: "2026-10-20T10:00:00.000Z",
      registration_capacity: 999,
    });
    expect(eventFormPatch(values, detail, false)).toEqual({});
  });
  it("clears optional dates without changing unrelated fields", () => {
    const detail = eventDetailFixture({
      time_zone: "Asia/Kolkata",
      registration_opens_at: "2026-10-20T04:30:00Z",
    });
    expect(
      eventFormPatch(
        { ...eventFormValues(detail), registration_opens_at: "" },
        detail,
        true,
      ),
    ).toEqual({ registration_opens_at: null });
    expect(serializeEventTime("", "")).toBeNull();
  });
});
