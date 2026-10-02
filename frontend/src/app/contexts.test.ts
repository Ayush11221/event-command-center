import { afterEach, describe, expect, it } from "vitest";
import type { ManagementEvent } from "../services/events";
import {
  contextsFromLists,
  rememberContext,
  rememberedContext,
  selectAuthorizedContext,
} from "./contexts";

const owned: ManagementEvent = {
  event_id: "event-one",
  name: "One",
  state: "DRAFT",
  start_at: null,
  end_at: null,
  time_zone: null,
  relationship: "owned",
};
const assigned: ManagementEvent = { ...owned, relationship: "assigned" };

afterEach(() => localStorage.clear());

describe("authorized Event and Role context", () => {
  it("automatically selects exactly one context", () => {
    const contexts = contextsFromLists([owned], []);
    expect(selectAuthorizedContext(contexts, null)).toEqual(contexts[0]);
  });

  it("keeps Organizer and Event Admin contexts distinct on the same event", () => {
    const contexts = contextsFromLists([owned], [assigned]);
    expect(contexts).toHaveLength(2);
    expect(
      selectAuthorizedContext(contexts, {
        eventId: "event-one",
        relationship: "assigned",
      }),
    ).toEqual(contexts[1]);
  });

  it("restores only a currently authorized remembered context and falls back after revocation", () => {
    const contexts = contextsFromLists([owned], [assigned]);
    rememberContext(contexts[1]);
    expect(rememberedContext()).toEqual({
      eventId: "event-one",
      relationship: "assigned",
    });
    expect(
      selectAuthorizedContext(
        contextsFromLists([owned], []),
        rememberedContext(),
      ),
    ).toEqual(contexts[0]);
    expect(selectAuthorizedContext([], rememberedContext())).toBeNull();
    rememberContext(null);
    expect(rememberedContext()).toBeNull();
  });
});
