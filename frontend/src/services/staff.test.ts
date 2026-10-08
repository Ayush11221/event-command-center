import { afterEach, describe, expect, it, vi } from "vitest";
import {
  grantStaff,
  listStaff,
  lookupStaffAccount,
  revokeStaff,
} from "./staff";
const signal = () => new AbortController().signal;
const row = {
  id: "assignment",
  userId: "user",
  email: "verified@example.test",
  role: "VOLUNTEER",
  gateId: null,
  grantedAt: new Date().toISOString(),
};
function transport(body: unknown, status = 200) {
  vi.stubEnv("VITE_API_ORIGIN", "http://127.0.0.1:3000");
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: status < 300, status, json: async () => body });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("staff API transport", () => {
  it("looks up exact email only in the body with authenticated CSRF/no-store/no-referrer", async () => {
    const fetch = transport({
      account: {
        user_id: "user",
        email: row.email,
        session_id: "private",
        encrypted: "private",
      },
    });
    expect(
      await lookupStaffAccount("event", row.email, "csrf", signal()),
    ).toEqual({ user_id: "user", email: row.email });
    const [url, options] = fetch.mock.calls[0];
    expect(String(url)).toBe(
      "http://127.0.0.1:3000/api/v1/events/event/assignments/account-lookup",
    );
    expect(String(url)).not.toContain(row.email);
    expect(options).toMatchObject({
      method: "POST",
      credentials: "include",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      body: JSON.stringify({ email: row.email }),
      headers: { "X-CSRF-Token": "csrf" },
    });
  });
  it("allowlists assignment fields and uses server-derived roles", async () => {
    transport({
      assignments: [{ ...row, renewal: "private" }],
      allowed_roles: ["GATE_SECURITY", "VOLUNTEER"],
      session: "private",
    });
    expect(await listStaff("event", signal())).toEqual({
      assignments: [row],
      allowed_roles: ["GATE_SECURITY", "VOLUNTEER"],
    });
  });
  it.each([
    { allowed_roles: ["OWNER"] },
    { assignments: [{ ...row, role: "SUPER_ADMIN" }] },
    { assignments: [{ ...row, role: "GATE_SECURITY" }] },
    { assignments: [{ ...row, grantedAt: "invalid" }] },
  ])("rejects malformed staff response %#", async (change) => {
    transport({ assignments: [row], allowed_roles: ["VOLUNTEER"], ...change });
    await expect(listStaff("event", signal())).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      status: 0,
    });
  });
  it("uses the established grant and revoke routes without introducing PATCH/replay semantics", async () => {
    const fetch = transport({ id: "assignment" }, 201);
    await grantStaff(
      "event",
      { user_id: "user", role: "VOLUNTEER" },
      "csrf",
      signal(),
    );
    expect(fetch.mock.calls[0][1].method).toBe("POST");
    const remove = transport({ status: "revoked" });
    await revokeStaff("event", "assignment", "csrf", signal());
    expect(remove.mock.calls[0][1].method).toBe("DELETE");
    expect(String(remove.mock.calls[0][0])).toContain(
      "/assignments/assignment",
    );
  });
  it("propagates human-readable error categories without server details", async () => {
    transport({ code: "FORBIDDEN", stack: "private" }, 403);
    await expect(
      lookupStaffAccount("event", row.email, "csrf", signal()),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });
  it("treats unreadable mutation success as unknown", async () => {
    transport({ secret: "private" });
    await expect(
      grantStaff(
        "event",
        { user_id: "user", role: "VOLUNTEER" },
        "csrf",
        signal(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 0 });
  });
});
