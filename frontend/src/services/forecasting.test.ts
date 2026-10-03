import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCurrentForecast,
  validCurrent,
  type ForecastCurrent,
} from "./forecasting";
const fixture: ForecastCurrent = JSON.parse(
  readFileSync("../tests/fixtures/slice8-forecast.json", "utf8"),
);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("Forecast public transport", () => {
  it("only calls Express with the session and private read settings", async () => {
    vi.stubEnv("VITE_API_ORIGIN", "http://127.0.0.1:3000");
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => fixture });
    vi.stubGlobal("fetch", fetch);
    expect(
      await getCurrentForecast(fixture.event_id, new AbortController().signal),
    ).toEqual(fixture);
    expect(String(fetch.mock.calls[0][0])).toBe(
      `http://127.0.0.1:3000/api/v1/events/${fixture.event_id}/forecasts/current`,
    );
    expect(fetch.mock.calls[0][1]).toMatchObject({
      credentials: "include",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    expect(fetch.mock.calls[0][1].headers).toBeUndefined();
    expect(fetch.mock.calls[0][1].body).toBeUndefined();
  });
  it.each([
    "identity",
    "extra",
    "horizons",
    "timestamp",
    "freshness",
    "unavailable",
    "metrics",
    "nan",
  ])("rejects unsafe/incompatible %s", (kind) => {
    const value = structuredClone(fixture);
    if (kind === "identity") value.event_id = "foreign";
    if (kind === "extra") Object.assign(value, { contact: "secret" });
    if (kind === "horizons") value.forecast.points.reverse();
    if (kind === "timestamp")
      value.forecast.persisted_at = "2026-10-04T00:00:00.000Z";
    if (kind === "freshness") value.forecast.freshness.reason = "AGE_EXCEEDED";
    if (kind === "unavailable") value.forecast.status = "MODEL_UNAVAILABLE";
    if (kind === "metrics")
      value.forecast.evaluation!.horizons[0].interval_coverage = 2;
    if (kind === "nan") value.forecast.points[0].predicted_occupancy = NaN;
    expect(validCurrent(value, fixture.event_id)).toBe(false);
  });
  it("preserves safe dependency failure correlation", async () => {
    vi.stubEnv("VITE_API_ORIGIN", "http://127.0.0.1:3000");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({
          code: "DEPENDENCY_UNAVAILABLE",
          correlation_id: "ref",
        }),
      }),
    );
    await expect(
      getCurrentForecast(fixture.event_id, new AbortController().signal),
    ).rejects.toMatchObject({ status: 503, correlationId: "ref" });
  });
  it("aborts a stuck body as well as fetch", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_API_ORIGIN", "http://127.0.0.1:3000");
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, { signal }: { signal: AbortSignal }) =>
        Promise.resolve({
          ok: true,
          json: () =>
            new Promise((_done, reject) =>
              signal.addEventListener("abort", () =>
                reject(new Error("timeout")),
              ),
            ),
        }),
      ),
    );
    const read = getCurrentForecast(
      fixture.event_id,
      new AbortController().signal,
    );
    const assertion = expect(read).rejects.toMatchObject({ code: "NETWORK" });
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
  });
});
