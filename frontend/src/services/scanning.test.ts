import { afterEach, describe, expect, it, vi } from "vitest";
import { scannerScope, submitScan, type ScanCommand } from "./scanning";
const command: ScanCommand = {
  scan_id: "scan",
  event_id: "event",
  gate_id: "gate",
  credential: "opaque-secret",
};
const response = {
  scan_id: "scan",
  event_id: "event",
  gate_id: "gate",
  decision: "ACCEPTED",
  reason: "ACCEPTED",
  registration_status: "REGISTERED",
  attendance_status: "INSIDE",
  decided_at: new Date().toISOString(),
  replayed: false,
  correlation_id: "correlation",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function fetchBody(body: unknown, status = 200) {
  vi.stubEnv("VITE_API_ORIGIN", "http://127.0.0.1:3000");
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: status === 200, status, json: async () => body });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
describe("scanner transport boundary", () => {
  it("sends opaque proof only in the mutation body with account/CSRF/scan replay headers", async () => {
    const fetch = fetchBody({
      ...response,
      contact: "private-contact",
      verifierHash: "secret-hash",
    });
    expect(
      await submitScan(command, "csrf", new AbortController().signal),
    ).toEqual(response);
    const [url, options] = fetch.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:3000/api/v1/scan-decisions");
    expect(options.body).toBe(JSON.stringify(command));
    expect(options.headers).toMatchObject({
      "Idempotency-Key": "scan",
      "X-CSRF-Token": "csrf",
    });
    expect(options).toMatchObject({
      credentials: "include",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    expect(
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ).not.toContain("opaque-secret");
  });
  it.each([
    { decision: "TECHNICAL_FAILURE" },
    { event_id: "foreign" },
    { gate_id: "foreign" },
    { scan_id: "other" },
    { reason: "EXPIRED_CREDENTIAL" },
    { registration_status: null },
    { attendance_status: "NOT_ARRIVED" },
    { decided_at: "bad" },
    { replayed: "yes" },
  ])("holds entry for malformed or mismatched response %#", async (change) => {
    fetchBody({ ...response, ...change });
    await expect(
      submitScan(command, "csrf", new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 0 });
  });
  it("propagates safe error categories", async () => {
    fetchBody({ code: "UNAUTHORIZED_GATE" }, 403);
    await expect(
      submitScan(command, "csrf", new AbortController().signal),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED_GATE", status: 403 });
  });
  it("treats network failure as unknown, never policy rejection", async () => {
    fetchBody(response);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("private transport details")),
    );
    await expect(
      submitScan(command, "csrf", new AbortController().signal),
    ).rejects.toMatchObject({ code: "NETWORK", status: 0 });
  });
  it("propagates abort and times out a stalled request", async () => {
    vi.useFakeTimers();
    try {
      fetchBody(response);
      const fetch = vi.fn(
        (_url, options: RequestInit) =>
          new Promise((_done, reject) =>
            options.signal!.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            ),
          ),
      );
      vi.stubGlobal("fetch", fetch);
      const pending = submitScan(command, "csrf", new AbortController().signal);
      const assertion = expect(pending).rejects.toMatchObject({
        code: "NETWORK",
      });
      await vi.advanceTimersByTimeAsync(15000);
      await assertion;
      expect(fetch.mock.calls[0][1].signal!.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("checks exact event/gate scope using the established route", async () => {
    const fetch = fetchBody({
      event_id: "event",
      gate_id: "gate",
      authorized: true,
      event_name: "Community event",
      gate_label: "Gate 1",
    });
    await scannerScope("event", "gate", new AbortController().signal);
    expect(String(fetch.mock.calls[0][0])).toContain(
      "/events/event/gates/gate/scope",
    );
    fetchBody({ event_id: "foreign", gate_id: "gate", authorized: true });
    await expect(
      scannerScope("event", "gate", new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
