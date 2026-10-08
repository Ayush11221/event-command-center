import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let session: typeof import("./account-session");
const origin = "https://api.example.test";
const denied = () =>
  Response.json({ code: "UNAUTHENTICATED" }, { status: 401 });
const success = () => Response.json({ status: "authenticated" });

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("VITE_API_ORIGIN", origin);
  vi.stubGlobal("BroadcastChannel", undefined);
  session = await import("./account-session");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function transport() {
  let active = false;
  const fetcher = vi.fn(async (url: URL, options?: RequestInit) => {
    void options;
    if (url.pathname === "/api/v1/auth/account/session")
      return Response.json({ csrf_token: "csrf" });
    if (url.pathname === "/api/v1/auth/account/refresh") {
      active = true;
      return success();
    }
    return active ? success() : denied();
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

describe("coordinated account renewal transport", () => {
  it("deduplicates simultaneous expiry and retries reads after one rotation", async () => {
    const fetcher = transport();
    const replies = await Promise.all(
      Array.from({ length: 8 }, () =>
        session.accountFetch(new URL("/api/v1/auth/me", origin)),
      ),
    );
    expect(replies.every((response) => response.ok)).toBe(true);
    expect(
      fetcher.mock.calls.filter(([url]) => url.pathname.endsWith("/refresh")),
    ).toHaveLength(1);
    expect(
      fetcher.mock.calls.filter(([url]) =>
        url.pathname.endsWith("/account/session"),
      ),
    ).toHaveLength(1);
  });

  it("uses a cross-tab lock and rechecks cookies after waiting for another tab", async () => {
    const locks = {
      request: vi.fn(
        async (
          _name: string,
          _options: object,
          callback: () => Promise<Response>,
        ) => callback(),
      ),
    };
    vi.stubGlobal("navigator", { locks });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(denied())
      .mockResolvedValue(success());
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await session.accountFetch(new URL("/api/v1/events", origin))).ok,
    ).toBe(true);
    expect(locks.request).toHaveBeenCalledWith(
      "eoc.account-renewal.v1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
      expect.any(Function),
    );
    expect(fetcher.mock.calls).toHaveLength(3);
    expect(
      fetcher.mock.calls.some(([url]) => url.pathname.endsWith("/refresh")),
    ).toBe(false);
  });

  it("replays a definitively auth-rejected command with its original body, CSRF, revision and idempotency key", async () => {
    const fetcher = transport();
    const options = {
      method: "POST",
      credentials: "include" as const,
      headers: {
        "Idempotency-Key": "same-command",
        "X-CSRF-Token": "csrf",
        "If-Match": '"4"',
      },
      body: '{"name":"Unsaved"}',
    };
    const result = await session.accountFetch(
      new URL("/api/v1/events", origin),
      options,
    );
    expect(result.ok).toBe(true);
    const commands = fetcher.mock.calls.filter(
      ([url]) => url.pathname === "/api/v1/events",
    );
    expect(commands).toHaveLength(2);
    expect(commands[0][1]).toBe(options);
    expect(commands[1][1]).toBe(options);
  });

  it("does not automatically replay a mutation without known replay semantics", async () => {
    const fetcher = transport();
    const result = await session.accountFetch(
      new URL("/api/v1/events/preview", origin),
      { method: "POST", body: "{}" },
    );
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({
      code: "AUTH_RENEWED_RETRY_REQUIRED",
    });
    expect(
      fetcher.mock.calls.filter(([url]) => url.pathname.endsWith("/preview")),
    ).toHaveLength(1);
  });

  it.each([403, 503])("does not renew or replay on %s", async (status) => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ code: "FORBIDDEN" }, { status }));
    vi.stubGlobal("fetch", fetcher);
    expect(
      (
        await session.accountFetch(new URL("/api/v1/events", origin), {
          method: "POST",
        })
      ).status,
    ).toBe(status);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("never retries a network failure or unknown mutation outcome", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      session.accountFetch(new URL("/api/v1/events", origin), {
        method: "POST",
        headers: { "Idempotency-Key": "stable" },
      }),
    ).rejects.toThrow("network");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("distinguishes anonymous, expired and unavailable without clearing an account on store failure", async () => {
    const events: string[] = [];
    const stop = session.subscribeAccountSession((event) => events.push(event));
    const fetcher = vi.fn().mockResolvedValue(denied());
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await session.accountFetch(new URL("/api/v1/auth/me", origin))).status,
    ).toBe(401);
    expect(events).toEqual([]);
    session.accountAuthenticated();
    fetcher
      .mockReset()
      .mockResolvedValueOnce(denied())
      .mockResolvedValue(
        Response.json({ code: "DEPENDENCY_UNAVAILABLE" }, { status: 503 }),
      );
    expect(
      (await session.accountFetch(new URL("/api/v1/auth/me", origin))).status,
    ).toBe(503);
    expect(events).toEqual(["unavailable"]);
    fetcher.mockReset().mockResolvedValue(denied());
    expect(
      (await session.accountFetch(new URL("/api/v1/auth/me", origin))).status,
    ).toBe(401);
    expect(events).toEqual(["unavailable", "expired"]);
    stop();
  });

  it("retries a bounded concurrent-cookie race and returns unavailable after the bound", async () => {
    const fetcher = vi.fn(async (url: URL) =>
      url.pathname.endsWith("/account/session")
        ? Response.json({ code: "RENEWAL_CONFLICT" }, { status: 409 })
        : denied(),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await session.accountFetch(new URL("/api/v1/auth/me", origin))).status,
    ).toBe(503);
    expect(
      fetcher.mock.calls.filter(([url]) =>
        url.pathname.endsWith("/account/session"),
      ),
    ).toHaveLength(3);
  });

  it("shares state notifications across tabs without credentials or contact details", async () => {
    const bus: {
      onmessage?: (event: { data: unknown }) => void;
      postMessage: ReturnType<typeof vi.fn>;
    } = { postMessage: vi.fn() };
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          return bus;
        }
      },
    );
    const events: string[] = [];
    session.subscribeAccountSession((event) => events.push(event));
    bus!.onmessage!({ data: "signed-out" });
    expect(events).toEqual(["signed-out"]);
    session.accountSignedOut();
    expect(bus!.postMessage).toHaveBeenCalledWith("signed-out");
    expect(localStorage.getItem("eoc_renewal")).toBeNull();
    expect(sessionStorage.getItem("eoc_session")).toBeNull();
  });
});
