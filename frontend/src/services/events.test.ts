import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDraft,
  EventApiError,
  getEventDetail,
  listAllEvents,
} from "./events";

beforeEach(() => vi.stubEnv("VITE_API_ORIGIN", "http://127.0.0.1:3000"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("scoped Event API client", () => {
  it("reads management detail with cookies and no client role or revision claim", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ event_id: "one", revision: 3 }),
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await getEventDetail("one")).toMatchObject({
      event_id: "one",
      revision: 3,
    });
    const [url, options] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/api/v1/events/one");
    expect(url.search).toBe("");
    expect(options).toMatchObject({
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: {},
    });
  });
  it("follows cursor pages and sends account cookies without a client role claim", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ event_id: "one", relationship: "owned" }],
          next_cursor: "next",
          as_of: "now",
          correlation_id: "a",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ event_id: "two", relationship: "owned" }],
          next_cursor: null,
          as_of: "now",
          correlation_id: "b",
        }),
      });
    vi.stubGlobal("fetch", fetcher);
    const items = await listAllEvents("owned");
    expect(items.map((item) => item.event_id)).toEqual(["one", "two"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, options] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get("view")).toBe("owned");
    expect(options.credentials).toBe("include");
    expect(options.headers).not.toHaveProperty("X-Role");
  });

  it("sends the Draft name, CSRF token and durable retry key", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ event_id: "new", revision: 1 }),
    });
    vi.stubGlobal("fetch", fetcher);
    await createDraft("Opening night", "csrf", "stable-key");
    const options = (fetcher.mock.calls[0] as [URL, RequestInit])[1];
    expect(options.method).toBe("POST");
    expect(options.headers).toMatchObject({
      "X-CSRF-Token": "csrf",
      "Idempotency-Key": "stable-key",
    });
    expect(JSON.parse(options.body as string)).toEqual({
      name: "Opening night",
    });
  });

  it("preserves safe typed validation details and correlation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          code: "VALIDATION",
          correlation_id: "ref",
          details: { field: "name" },
        }),
      }),
    );
    await expect(createDraft("", "csrf", "stable-key")).rejects.toMatchObject({
      code: "VALIDATION",
      status: 400,
      correlationId: "ref",
      details: { field: "name" },
    } satisfies Partial<EventApiError>);
  });
});
