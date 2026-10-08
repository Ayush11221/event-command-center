import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { challenge, verify, currentGuest, logout, ProofError } from "./proof";

beforeEach(() => vi.stubEnv("VITE_API_ORIGIN", "https://api.example.test"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it.each(["account", "guest"] as const)(
  "routes only %s challenges to the same origin with unchanged input",
  async (mode) => {
    const fetcher = vi.fn(async () =>
      Response.json({ status: "pending" }, { status: 202 }),
    );
    vi.stubGlobal("fetch", fetcher);
    await challenge(mode, "EMAIL", "synthetic@example.test");
    expect(fetcher).toHaveBeenCalledWith(
      new URL(`/api/v1/auth/${mode}/challenge`, window.location.origin),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        cache: "no-store",
        body: '{"type":"EMAIL","contact":"synthetic@example.test"}',
        headers: { "Content-Type": "application/json" },
      }),
    );
  },
);
it("leaves verification, guest status and logout on the configured API", async () => {
  const fetcher = vi.fn(async () => Response.json({ status: "authenticated" }));
  vi.stubGlobal("fetch", fetcher);
  await verify("guest", "EMAIL", "synthetic@example.test", "012345");
  await currentGuest();
  await logout("csrf");
  expect(
    fetcher.mock.calls.map((call) => String((call as unknown[])[0])),
  ).toEqual([
    "https://api.example.test/api/v1/auth/guest/verify",
    "https://api.example.test/api/v1/auth/guest/self",
    "https://api.example.test/api/v1/auth/logout",
  ]);
});
it("preserves challenge error codes and network errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ code: "RATE_LIMITED" }, { status: 429 }),
      )
      .mockRejectedValueOnce(new Error("offline")),
  );
  await expect(
    challenge("account", "EMAIL", "synthetic@example.test"),
  ).rejects.toEqual(new ProofError("RATE_LIMITED", 429));
  await expect(
    challenge("guest", "EMAIL", "synthetic@example.test"),
  ).rejects.toEqual(new ProofError("NETWORK", 0));
});
