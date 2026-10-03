import { afterEach, describe, expect, it, vi } from "vitest";
import { getOperations } from "./occupancy";
const snapshot = {
  event_id: "event",
  event_name: "Operations event",
  event_state: "LIVE",
  occupied: 2,
  registered: 2,
  capacity: 1,
  remaining: -1,
  utilization_percentage: 200,
  attendance_state: "INSIDE",
  last_attendance_at: "2026-10-03T00:00:00Z",
  calculated_at: "2026-10-03T00:01:00Z",
  correlation_id: "correlation",
  revision: 2,
  as_of: "2026-10-03T00:01:00Z",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
function body(value: unknown, status = 200) {
  vi.stubEnv("VITE_API_ORIGIN", "http://127.0.0.1:3000");
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: status === 200, status, json: async () => value });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
describe("operations transport", () => {
  it("accepts above-capacity values and returns only the operations allowlist", async () => {
    const fetch = body({
      ...snapshot,
      owner_user_id: "secret",
      credential: "secret",
      participants: [],
    });
    expect(await getOperations("event", new AbortController().signal)).toEqual(
      snapshot,
    );
    expect(String(fetch.mock.calls[0][0])).toBe(
      "http://127.0.0.1:3000/api/v1/events/event/operations",
    );
    expect(fetch.mock.calls[0][1]).toMatchObject({
      credentials: "include",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    expect(fetch.mock.calls[0][1].body).toBeUndefined();
  });
  it("preserves unavailable capacity rather than guessing", async () => {
    const value = {
      ...snapshot,
      capacity: null,
      remaining: null,
      utilization_percentage: null,
    };
    body(value);
    expect(await getOperations("event", new AbortController().signal)).toEqual(
      value,
    );
  });
  it.each([
    { revision: undefined },
    { revision: -1 },
    { revision: 1.2 },
    { as_of: "invalid" },
    { event_id: undefined },
    { event_id: "foreign" },
    { occupied: -1 },
    { registered: 1 },
    { remaining: 0 },
    { utilization_percentage: 100 },
    { capacity: 0 },
    { attendance_state: "REGISTERED" },
    { event_state: "UNKNOWN" },
    { calculated_at: 0 },
    { last_attendance_at: "invalid" },
  ])("rejects malformed or inconsistent data %#", async (change) => {
    body({ ...snapshot, ...change });
    await expect(
      getOperations("event", new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it.each([401, 403, 404, 503])(
    "retains safe failure and correlation for %s",
    async (status) => {
      body({ code: "EVENT_NOT_FOUND", correlation_id: "ref" }, status);
      await expect(
        getOperations("event", new AbortController().signal),
      ).rejects.toMatchObject({ status, correlationId: "ref" });
    },
  );
  it("links abort to the request and removes its listener", async () => {
    const fetch = body(snapshot),
      controller = new AbortController();
    controller.abort();
    await getOperations("event", controller.signal);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it("fails safely without a configured origin", async () => {
    vi.stubEnv("VITE_API_ORIGIN", "");
    await expect(
      getOperations("event", new AbortController().signal),
    ).rejects.toMatchObject({ code: "NETWORK" });
  });
});
