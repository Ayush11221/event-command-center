import { describe, expect, it } from "vitest";
import { managementAvailability } from "./availability.js";
import { managementActions } from "./policy.js";

const now = new Date("2026-10-02T12:00:00Z");
const base = {
  registrationOpensAt: null,
  registrationClosesAt: null,
  startAt: null,
  registrationManuallyClosed: false,
};

describe("management availability contract", () => {
  it("keeps partial Draft policy open without inventing dates or capacity facts", () => {
    expect(managementAvailability(base, now)).toEqual({
      policy_status: "OPEN",
      reasons: [],
      opens_at: null,
      closes_at: null,
      as_of: now.toISOString(),
    });
  });
  it("opens exactly at the configured opening", () => {
    const event = { ...base, registrationOpensAt: now };
    expect(
      managementAvailability(event, new Date(now.getTime() - 1)).reasons,
    ).toEqual(["NOT_OPEN_YET"]);
    expect(managementAvailability(event, now).policy_status).toBe("OPEN");
  });
  it("closes exactly at configured close, overriding the default event start", () => {
    const event = {
      ...base,
      startAt: new Date(now.getTime() - 1000),
      registrationClosesAt: new Date(now.getTime() + 1000),
    };
    expect(managementAvailability(event, now).policy_status).toBe("OPEN");
    expect(
      managementAvailability(event, event.registrationClosesAt).reasons,
    ).toEqual(["SCHEDULED_CLOSE_REACHED"]);
    expect(
      managementAvailability({ ...event, registrationClosesAt: null }, now)
        .reasons,
    ).toEqual(["SCHEDULED_CLOSE_REACHED"]);
  });
  it("retains every applicable approved reason, independently of lifecycle and capacity", () => {
    expect(
      managementAvailability(
        {
          ...base,
          registrationOpensAt: new Date(now.getTime() + 1000),
          startAt: now,
          registrationManuallyClosed: true,
        },
        now,
      ),
    ).toEqual({
      policy_status: "CLOSED",
      reasons: ["NOT_OPEN_YET", "SCHEDULED_CLOSE_REACHED", "MANUALLY_CLOSED"],
      opens_at: new Date(now.getTime() + 1000).toISOString(),
      closes_at: now.toISOString(),
      as_of: now.toISOString(),
    });
  });
  it("never gives Admin lifecycle authority and suppresses terminal editing", () => {
    expect(managementActions("DRAFT", false)).toEqual([
      "EDIT_EVENT",
      "CREATE_GATE",
    ]);
    expect(managementActions("PUBLISHED", false)).toEqual([
      "EDIT_EVENT",
      "CREATE_GATE",
    ]);
    expect(managementActions("LIVE", false)).toEqual([]);
    expect(managementActions("LIVE", true)).toEqual(["CANCEL"]);
    for (const state of ["COMPLETED", "CANCELLED"] as const) {
      expect(managementActions(state, true)).toEqual([]);
      expect(managementActions(state, false)).toEqual([]);
    }
  });
});
