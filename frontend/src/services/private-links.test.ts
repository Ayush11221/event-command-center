import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrivateDetail } from "./discovery";
import { issuePrivateLink } from "./events";
beforeEach(() => vi.stubEnv("VITE_API_ORIGIN", "http://127.0.0.1:3000"));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("V8 private API transport", () => {
  it("issues only the documented empty command with current session, CSRF, revision and idempotency", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ link_state: "ACTIVE" }),
    });
    vi.stubGlobal("fetch", fetcher);
    await issuePrivateLink("event/one", 4, "csrf", "same-key");
    const [url, options] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/api/v1/events/event%2Fone/private-link");
    expect(url.search).toBe("");
    expect(options).toMatchObject({
      method: "POST",
      credentials: "include",
      cache: "no-store",
      body: "{}",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": "csrf",
        "If-Match": '"4"',
        "Idempotency-Key": "same-key",
      },
    });
  });
  it("sends proof only as the approved bearer header without cookies, query, referrer or OTP", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ event_id: "one" }) });
    vi.stubGlobal("fetch", fetcher);
    await getPrivateDetail("a".repeat(43));
    const [url, options] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/api/v1/discovery/private");
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
    expect(options).toMatchObject({
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { Authorization: `PrivateLink ${"a".repeat(43)}` },
    });
    expect(options.body).toBeUndefined();
  });
  it("lets missing proof receive the same backend unavailable response without an account fallback", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ code: "PRIVATE_UNAVAILABLE" }),
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(getPrivateDetail(null)).rejects.toMatchObject({
      status: 404,
      code: "PRIVATE_UNAVAILABLE",
    });
    expect(fetcher.mock.calls[0][1].headers).toBeUndefined();
  });
  it.each([403, 409, 422, 503])(
    "preserves issuance failure %s without server secret message",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status,
          json: async () => ({
            code: "SAFE",
            message: "secret",
            correlation_id: "ref",
          }),
        }),
      );
      await expect(
        issuePrivateLink("one", 1, "csrf", "key"),
      ).rejects.toMatchObject({
        status,
        message: "SAFE",
        correlationId: "ref",
      });
    },
  );
  it("times out issuance without converting unknown outcome into a new command", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal!.addEventListener("abort", () =>
              reject(new Error("abort")),
            );
          }),
      ),
    );
    const pending = issuePrivateLink("one", 1, "csrf", "key"),
      assertion = expect(pending).rejects.toMatchObject({
        code: "NETWORK",
        status: 0,
      });
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });
});
