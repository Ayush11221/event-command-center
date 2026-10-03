import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewRequest, outcomeUnknown, tasksPath } from "./event-review";
import { ProofError } from "./proof";
beforeEach(() => vi.stubEnv("VITE_API_ORIGIN", "http://127.0.0.1:3000"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("Slice 11 public API client", () => {
  it("uses Node boundary, current credentials and exact mutation preconditions", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ task: { id: "task" } }), {
        headers: { ETag: '"2"' },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const command = {
      method: "PATCH" as const,
      body: { status: "COMPLETED" },
      csrf: "csrf",
      key: "stable-command",
      etag: '"1"',
    };
    const result = await reviewRequest(
      tasksPath("event") + "/task/status",
      new AbortController().signal,
      command,
    );
    expect(String(fetcher.mock.calls[0]![0])).toBe(
      "http://127.0.0.1:3000/api/v1/events/event/volunteer-tasks/task/status",
    );
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      credentials: "include",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      method: "PATCH",
      headers: {
        "X-CSRF-Token": "csrf",
        "Idempotency-Key": "stable-command",
        "If-Match": '"1"',
      },
      body: JSON.stringify(command.body),
    });
    expect(result.etag).toBe('"2"');
  });
  it("reads without mutation headers and retains stable errors", async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "RESULTS_NOT_COMPLETED" }), {
        status: 409,
      }),
    );
    vi.stubGlobal("fetch", f);
    await expect(
      reviewRequest("/events/e/results", new AbortController().signal),
    ).rejects.toMatchObject({ code: "RESULTS_NOT_COMPLETED", status: 409 });
    expect(f.mock.calls[0]![1].headers).toEqual({});
  });
  it("bounds stalled requests and marks their outcome unknown", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, { signal }) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            ),
          ),
      ),
    );
    const result = reviewRequest(
      "/events/e/results",
      new AbortController().signal,
    ).catch((e) => e);
    await vi.advanceTimersByTimeAsync(15000);
    expect(outcomeUnknown(await result)).toBe(true);
  });
  it("propagates caller cancellation and rejects missing origin", async () => {
    const c = new AbortController();
    c.abort();
    const f = vi.fn((_url, { signal }) =>
      signal.aborted
        ? Promise.reject(new Error("aborted"))
        : Promise.resolve(new Response("{}")),
    );
    vi.stubGlobal("fetch", f);
    await expect(
      reviewRequest("/events/e/results", c.signal),
    ).rejects.toMatchObject({ status: 0 });
    vi.stubEnv("VITE_API_ORIGIN", "");
    await expect(
      reviewRequest("/events/e/results", new AbortController().signal),
    ).rejects.toMatchObject({ status: 0 });
  });
  it("distinguishes definitive command rejection from unknown transport/server failures", () => {
    expect(outcomeUnknown(new ProofError("VERSION_CONFLICT", 409))).toBe(false);
    expect(outcomeUnknown(new ProofError("DEPENDENCY_UNAVAILABLE", 503))).toBe(
      true,
    );
  });
});
