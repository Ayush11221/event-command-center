import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createDatabase } from "../../config/database.js";
import { createLogger } from "../../config/logger.js";
import { OtpService } from "./otp.js";
import { encryptContact, normalizeContact } from "./contact.js";
import { csrfToken, signAccountToken, signGuestProof } from "./tokens.js";
const url = process.env.TEST_DATABASE_URL;
const origin = "http://127.0.0.1:5173";
const details = {
  display_name: "Asha Rao",
  phone_number: "+919876543210",
  organization: "Example College",
  affiliation_id: "ST-1",
};
describe.skipIf(!url)("account profile authorization and storage", () => {
  const db = createDatabase(url ?? "");
  const config = {
    databaseUrl: url ?? "",
    jwtSecret: Buffer.alloc(32, 9),
    contactKey: Buffer.alloc(32, 10),
    otpKey: Buffer.alloc(32, 11),
    cookieSecure: false,
  };
  const app = createApp(
    { port: 3000, frontendOrigin: origin },
    createLogger(
      new Writable({
        write(_c, _e, done) {
          done();
        },
      }),
    ),
    {
      db,
      config,
      frontendOrigin: origin,
      otp: new OtpService(db, config, {
        available: () => true,
        async send() {},
      }),
    },
  );
  afterAll(() => db.$disconnect());
  async function fixture() {
    const user = await db.user.create({ data: {} });
    const email = `profile-${randomUUID()}@example.test`;
    const contact = normalizeContact("EMAIL", email, config.contactKey);
    await db.verifiedContact.create({
      data: {
        userId: user.id,
        type: "EMAIL",
        lookupHash: contact.lookupHash,
        encrypted: encryptContact(email, config.contactKey),
        verifiedAt: new Date(),
      },
    });
    const session = await db.session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 600000) },
    });
    return {
      user,
      email,
      session,
      cookie: `eoc_session=${await signAccountToken(user.id, session.id, config.jwtSecret)}`,
      csrf: csrfToken(session.id, config.jwtSecret),
    };
  }
  it("stores a readable name only on the current account and preserves protected email", async () => {
    const f = await fixture(),
      other = await fixture();
    const before = await db.verifiedContact.findFirstOrThrow({
      where: { userId: f.user.id },
    });
    const profile = await request(app)
      .get("/api/v1/auth/account/profile")
      .set("Cookie", f.cookie);
    expect(profile.body).toEqual({
      display_name: null,
      verified_email: f.email,
      phone_number: null,
      organization: null,
      affiliation_id: null,
    });
    expect(profile.headers["cache-control"]).toContain("no-store");
    const saved = await request(app)
      .post("/api/v1/auth/account/profile")
      .set("Cookie", f.cookie)
      .set("Origin", origin)
      .set("X-CSRF-Token", f.csrf)
      .send({ ...details, display_name: "  Asha Rao  " });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual(details);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: f.user.id } }))
        .displayName,
    ).toBe("Asha Rao");
    expect(
      await db.user.findUniqueOrThrow({ where: { id: f.user.id } }),
    ).toMatchObject({
      profilePhone: details.phone_number,
      organization: details.organization,
      affiliationId: details.affiliation_id,
    });
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: other.user.id } }))
        .displayName,
    ).toBeNull();
    expect(
      await db.verifiedContact.findFirstOrThrow({
        where: { userId: f.user.id },
      }),
    ).toEqual(before);
    const audit = await db.auditEvent.findFirstOrThrow({
      where: { actorUserId: f.user.id, action: "ACCOUNT_PROFILE_SAVED" },
    });
    expect(JSON.stringify(audit)).not.toContain("Asha Rao");
    expect(JSON.stringify(audit)).not.toContain(f.email);
    const me = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", f.cookie);
    expect(me.body.display_name).toBe("Asha Rao");
    expect(me.body).not.toHaveProperty("verified_email");
    expect(me.body.organizer_capable).toBe(false);
  });
  it("requires a live account, configured origin and its session CSRF token", async () => {
    const f = await fixture();
    expect(
      (await request(app).get("/api/v1/auth/account/profile")).status,
    ).toBe(401);
    const guest = await signGuestProof(
      "a".repeat(64),
      "guest_ownership",
      null,
      config.jwtSecret,
    );
    expect(
      (
        await request(app)
          .get("/api/v1/auth/account/profile")
          .set("Cookie", `eoc_guest_proof=${guest}`)
      ).status,
    ).toBe(401);
    for (const headers of [
      { Origin: origin },
      { Origin: "https://foreign.example", "X-CSRF-Token": f.csrf },
      { Origin: origin, "X-CSRF-Token": "foreign" },
    ]) {
      expect(
        (
          await request(app)
            .post("/api/v1/auth/account/profile")
            .set("Cookie", f.cookie)
            .set(headers)
            .send({ display_name: "Name" })
        ).status,
      ).toBe(403);
    }
    await db.session.update({
      where: { id: f.session.id },
      data: { revokedAt: new Date() },
    });
    expect(
      (
        await request(app)
          .post("/api/v1/auth/account/profile")
          .set("Cookie", f.cookie)
          .set("Origin", origin)
          .set("X-CSRF-Token", f.csrf)
          .send({ display_name: "Name" })
      ).status,
    ).toBe(401);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: f.user.id } }))
        .displayName,
    ).toBeNull();
  });
  it.each([
    { display_name: "" },
    { display_name: "x".repeat(101) },
    { display_name: "name\nforged" },
    { display_name: "Name", organizer_capable: true },
    { display_name: "Name", user_id: randomUUID() },
    { display_name: "Name", email: "other@example.test" },
  ])("rejects invalid and privileged profile fields %#", async (body) => {
    const f = await fixture();
    expect(
      (
        await request(app)
          .post("/api/v1/auth/account/profile")
          .set("Cookie", f.cookie)
          .set("Origin", origin)
          .set("X-CSRF-Token", f.csrf)
          .send({ ...details, ...body })
      ).status,
    ).toBe(400);
  });
});
