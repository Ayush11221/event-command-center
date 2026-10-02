import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DiscoveryApiError,
  getPublicCatalog,
  getPublicDetail,
} from "./discovery";

beforeEach(() => vi.stubEnv("VITE_API_ORIGIN", "http://127.0.0.1:3000"));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("V7 anonymous discovery client", () => {
  it("uses only the documented catalog path/cursor without session or role/context claims", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], next_cursor: null }),
    });
    vi.stubGlobal("fetch", fetcher);
    await getPublicCatalog("opaque+/=&cursor");
    const [url, options] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/api/v1/discovery/events");
    expect([...url.searchParams]).toEqual([["cursor", "opaque+/=&cursor"]]);
    expect(options).toMatchObject({
      method: "GET",
      credentials: "omit",
      cache: "no-store",
    });
    expect(options.headers).toBeUndefined();
    expect(options.body).toBeUndefined();
  });
  it("lets the server supply the default page limit", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], next_cursor: null }),
    });
    vi.stubGlobal("fetch", fetcher);
    await getPublicCatalog();
    expect((fetcher.mock.calls[0][0] as URL).search).toBe("");
  });
  it("requests encoded public detail IDs without bearer, CSRF or account credentials", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ event_id: "one" }) });
    vi.stubGlobal("fetch", fetcher);
    await getPublicDetail("guess/invalid");
    const [url, options] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/api/v1/discovery/events/guess%2Finvalid");
    expect(options.credentials).toBe("omit");
    expect(options.headers).toBeUndefined();
  });
  it.each([404, 503])(
    "preserves safe %s errors and correlation without server detail messages",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status,
          json: async () => ({
            code: status === 404 ? "EVENT_NOT_FOUND" : "DEPENDENCY_UNAVAILABLE",
            message: "not used",
            correlation_id: "ref",
          }),
        }),
      );
      await expect(getPublicDetail("one")).rejects.toMatchObject({
        status,
        correlationId: "ref",
      });
    },
  );
  it.each(["network", "json"])(
    "normalizes %s failure into a retryable display error",
    async (mode) => {
      vi.stubGlobal(
        "fetch",
        mode === "network"
          ? vi.fn().mockRejectedValue(new Error("network"))
          : vi.fn().mockResolvedValue({
              ok: true,
              json: async () => {
                throw new Error("invalid json");
              },
            }),
      );
      await expect(getPublicCatalog()).rejects.toMatchObject({
        code: "NETWORK",
        status: 0,
      });
    },
  );
  it("bounds requests to 15 seconds and aborts the fetch", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: URL, options: RequestInit) =>
          new Promise((_resolve, reject) =>
            options.signal!.addEventListener("abort", () =>
              reject(new Error("aborted")),
            ),
          ),
      ),
    );
    const outcome =
      expect(getPublicCatalog()).rejects.toBeInstanceOf(DiscoveryApiError);
    await vi.advanceTimersByTimeAsync(15_000);
    await outcome;
  });
  it("propagates screen cancellation to the request", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    await getPublicCatalog(undefined, controller.signal);
    // Aborted screens cancel while a request is in flight, not after completion.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: URL, options: RequestInit) =>
          new Promise((_resolve, reject) =>
            options.signal!.addEventListener("abort", () =>
              reject(new Error("aborted")),
            ),
          ),
      ),
    );
    const outcome = expect(
      getPublicDetail("one", controller.signal),
    ).rejects.toMatchObject({ code: "NETWORK" });
    controller.abort();
    await outcome;
  });
});
