import { afterEach, describe, expect, it, vi } from "vitest";
import { registrationRequest, participantSession } from "./registrations";
import { currentActor, currentGuest, ProofError } from "./proof";
vi.mock("./proof", async (original) => ({
  ...(await original<typeof import("./proof")>()),
  currentActor: vi.fn(),
  currentGuest: vi.fn(),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
describe("registration security transport", () => {
  it("keeps PRIVATE proof and CSRF in headers, never URL/body or browser storage", async () => {
    vi.stubEnv("VITE_API_ORIGIN", "http://127.0.0.1:3000");
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ registration: null }),
    });
    vi.stubGlobal("fetch", fetch);
    await registrationRequest(
      "/events/id/registrations",
      new AbortController().signal,
      { csrf: "csrf", key: "key" },
      "private-proof",
    );
    const [url, options] = fetch.mock.calls[0];
    expect(String(url)).not.toContain("proof");
    expect(options.body).toBe("{}");
    expect(options.headers.Authorization).toBe("PrivateLink private-proof");
    expect(options.headers["X-CSRF-Token"]).toBe("csrf");
    expect(options.credentials).toBe("include");
    expect(options.cache).toBe("no-store");
    expect(options.referrerPolicy).toBe("no-referrer");
    expect(localStorage.getItem("private-proof")).toBeNull();
    expect(sessionStorage.getItem("private-proof")).toBeNull();
  });
  it("propagates safe server errors without retaining responses", async () => {
    vi.stubEnv("VITE_API_ORIGIN", "http://localhost:3000");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ code: "REGISTRATION_NOT_FOUND" }),
      }),
    );
    await expect(
      registrationRequest("/registrations/id", new AbortController().signal),
    ).rejects.toMatchObject({ status: 404, code: "REGISTRATION_NOT_FOUND" });
  });
  it("uses account identity first and guest proof only after account 401", async () => {
    vi.mocked(currentActor).mockResolvedValue({
      csrf_token: "account",
    } as Awaited<ReturnType<typeof currentActor>>);
    expect(await participantSession()).toEqual({
      csrf: "account",
      guest: false,
    });
    expect(currentGuest).not.toHaveBeenCalled();
    vi.mocked(currentActor).mockRejectedValueOnce(
      new ProofError("UNAUTHENTICATED", 401),
    );
    vi.mocked(currentGuest).mockResolvedValue({
      status: "verified",
      csrf_token: "guest",
    });
    expect(await participantSession()).toEqual({ csrf: "guest", guest: true });
  });
  it("does not silently switch identities after a dependency failure", async () => {
    vi.mocked(currentActor).mockRejectedValueOnce(
      new ProofError("DEPENDENCY_UNAVAILABLE", 503),
    );
    await expect(participantSession()).rejects.toMatchObject({ status: 503 });
    expect(currentGuest).not.toHaveBeenCalled();
  });
  it.each([
    ["SESSION_EXPIRED", 401],
    ["FORBIDDEN", 403],
  ])("does not fall back to guest for account %s", async (code, status) => {
    vi.mocked(currentActor).mockRejectedValueOnce(new ProofError(code, status));
    await expect(participantSession()).rejects.toMatchObject({ code, status });
    expect(currentGuest).not.toHaveBeenCalled();
  });
});
