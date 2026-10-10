import { afterEach, describe, expect, it, vi } from "vitest";
import { accountProfile, saveAccountProfile } from "./profile";
const profile = {
  display_name: "Name",
  verified_email: "person@example.test",
  phone_number: "9876543210",
  organization: "College",
  affiliation_id: null,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function fetchBody(body: unknown) {
  vi.stubEnv("VITE_API_ORIGIN", "http://127.0.0.1:3000");
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
describe("account profile transport", () => {
  it("allowlists the current account profile and sends only editable details with CSRF", async () => {
    const fetch = fetchBody({
      ...profile,
      organizer_capable: true,
      verifierHash: "secret",
    });
    expect(await accountProfile(new AbortController().signal)).toEqual(profile);
    const details = {
      display_name: profile.display_name,
      phone_number: profile.phone_number,
      organization: profile.organization,
      affiliation_id: profile.affiliation_id,
    };
    await saveAccountProfile(details, "csrf", new AbortController().signal);
    const [url, options] = fetch.mock.calls[1];
    expect(String(url)).toBe(
      "http://127.0.0.1:3000/api/v1/auth/account/profile",
    );
    expect(JSON.parse(options.body)).toEqual(details);
    expect(options.headers["X-CSRF-Token"]).toBe("csrf");
    expect(options.cache).toBe("no-store");
  });
  it("rejects malformed profile values", async () => {
    fetchBody({ ...profile, phone_number: 123 });
    await expect(
      accountProfile(new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
