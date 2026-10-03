import { afterEach, describe, expect, it, vi } from "vitest";
import { callForecast } from "./client.js";
import { fallback, type ForecastRequest } from "./contract.js";
import type { FoundationConfig } from "../../config/foundation.js";
const request: ForecastRequest = {
  contract_version: 1,
  event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  as_of: "2026-10-01T00:00:00.000Z",
  time_zone: null,
  schedule: { start_at: null, end_at: null },
  occupied: 0,
  capacity: null,
  revision: 0,
  observations: [],
  horizons: [30, 60],
  method: { name: "persistence", version: "1" },
};
const config: FoundationConfig = {
  databaseUrl: "",
  jwtSecret: Buffer.alloc(32, 1),
  contactKey: Buffer.alloc(32, 2),
  otpKey: Buffer.alloc(32, 3),
  cookieSecure: false,
  forecastServiceUrl: "http://127.0.0.1:8000",
  forecastServiceKey: "a".repeat(64),
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Private forecast transport", () => {
  it("does not call an unconfigured service", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await callForecast(
          { ...config, forecastServiceUrl: undefined },
          request,
        )
      ).status,
    ).toBe("MODEL_UNAVAILABLE");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("validates semantic input equality without depending on JSON order", async () => {
    const result = fallback(request, "INSUFFICIENT_DATA");
    result.input = Object.fromEntries(
      Object.entries(result.input).reverse(),
    ) as typeof result.input;
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(result)));
    vi.stubGlobal("fetch", fetch);
    expect(await callForecast(config, request)).toEqual(result);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: { Authorization: "Bearer " + config.forecastServiceKey },
    });
    expect(fetch.mock.calls[0][1].body).not.toContain("contact");
  });
  it.each([400, 401, 500, 503])(
    "does not disclose error bodies (%s)",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(new Response("secret Python trace", { status })),
      );
      const result = await callForecast(config, request);
      expect(result.status).toBe(
        status === 400 ? "INVALID_INPUT" : "MODEL_UNAVAILABLE",
      );
      expect(JSON.stringify(result)).not.toContain("secret");
    },
  );
  it.each(["malformed", "extra", "foreign", "context", "future", "oversize"])(
    "rejects incompatible %s without a previous-run fallback",
    async (kind) => {
      const result = fallback(request, "INSUFFICIENT_DATA");
      if (kind === "extra") Object.assign(result, { token: "secret" });
      if (kind === "foreign") result.event_id = "foreign";
      if (kind === "context") result.input.capacity = 1;
      if (kind === "future")
        result.generated_at = new Date(Date.now() + 100000).toISOString();
      const body =
        kind === "malformed"
          ? "no json"
          : kind === "oversize"
            ? "x".repeat(65537)
            : JSON.stringify(result);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
      expect((await callForecast(config, request)).status).toBe(
        "INVALID_INPUT",
      );
    },
  );
  it.each([false, true])(
    "bounds both headers and streaming body at 2000ms (body=%s)",
    async (body) => {
      vi.useFakeTimers();
      vi.stubGlobal(
        "fetch",
        vi.fn((_url, { signal }: { signal: AbortSignal }) => {
          if (!body)
            return new Promise((_resolve, reject) =>
              signal.addEventListener("abort", () =>
                reject(new Error("secret")),
              ),
            );
          return Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  signal.addEventListener("abort", () =>
                    controller.error(new Error("secret")),
                  );
                },
              }),
            ),
          );
        }),
      );
      const pending = callForecast(config, request);
      await vi.advanceTimersByTimeAsync(1999);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect((await pending).status).toBe("MODEL_UNAVAILABLE");
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
