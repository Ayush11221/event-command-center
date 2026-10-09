import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callForecast } from "./client.js";
import { fallback, type ForecastRequest } from "./contract.js";
import type { FoundationConfig } from "../../config/foundation.js";
import { parseFoundationConfig } from "../../config/foundation.js";
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
const privateConfig = parseFoundationConfig({
  DATABASE_URL: "postgresql://localhost/test",
  JWT_SECRET: "b".repeat(64),
  CONTACT_KEY: "c".repeat(64),
  OTP_KEY: "d".repeat(64),
  FORECAST_SERVICE_KEY: config.forecastServiceKey,
  FORECAST_SERVICE_URL: "http://forecast.railway.internal:8000",
  FORECAST_SERVICE_TRANSPORT: "railway_private_http",
  RAILWAY_PROJECT_ID: "synthetic-project",
  RAILWAY_ENVIRONMENT_ID: "synthetic-environment",
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe.each([
  { ...config, forecastServiceUrl: "https://forecast.railway.internal:8000" },
  config,
  privateConfig,
])("Private forecast transport $forecastServiceUrl", (config) => {
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
    expect(String(fetch.mock.calls[0][0])).toBe(
      new URL("/internal/v1/forecasts", config.forecastServiceUrl).href,
    );
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
  it("redacts network and TLS failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("secret TLS/key diagnostic")),
    );
    const result = await callForecast(config, request);
    expect(result.status).toBe("MODEL_UNAVAILABLE");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it.each([65536, 65537])(
    "bounds a chunked response at exactly 65,536 bytes (%s)",
    async (size) => {
      const expected = fallback(request, "INSUFFICIENT_DATA");
      const payload = Buffer.from(JSON.stringify(expected).padEnd(size, " "));
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            new ReadableStream({
              start(controller) {
                for (let i = 0; i < payload.length; i += 16384)
                  controller.enqueue(payload.subarray(i, i + 16384));
                controller.close();
              },
            }),
          ),
        ),
      );
      const result = await callForecast(config, request);
      expect(result.status).toBe(
        size === 65536 ? "INSUFFICIENT_DATA" : "INVALID_INPUT",
      );
      if (size === 65536) expect(result).toEqual(expected);
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

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test listener");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
it.each([301, 302, 303, 307, 308])(
  "rejects a real HTTP %s redirect before any request reaches its destination",
  async (status) => {
    let destinationRequests = 0,
      sourceRequests = 0;
    let authorization: string | undefined;
    const destination = createServer((_req, res) => {
      destinationRequests++;
      res.end(JSON.stringify(fallback(request, "INSUFFICIENT_DATA")));
    });
    const destinationUrl = await listen(destination);
    const source = createServer((req, res) => {
      sourceRequests++;
      authorization = req.headers.authorization;
      req.resume();
      res.writeHead(status, {
        Location: destinationUrl + "/secret-destination",
      });
      res.end();
    });
    try {
      const sourceUrl = await listen(source);
      const result = await callForecast(
        { ...config, forecastServiceUrl: sourceUrl },
        request,
      );
      expect(sourceRequests).toBe(1);
      expect(authorization).toBe("Bearer " + config.forecastServiceKey);
      expect(result.status).toBe("MODEL_UNAVAILABLE");
      expect(destinationRequests).toBe(0);
      expect(JSON.stringify(result)).not.toContain("secret-destination");
      expect(JSON.stringify(result)).not.toContain(config.forecastServiceKey);
    } finally {
      await close(source);
      await close(destination);
    }
  },
);
