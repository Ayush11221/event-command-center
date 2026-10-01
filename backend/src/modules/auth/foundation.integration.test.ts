import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { ContactType, StaffRole } from "@prisma/client";
import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { createDatabase } from "../../config/database.js";
import { createLogger } from "../../config/logger.js";
import type { FoundationConfig } from "../../config/foundation.js";
import { provisionAccount, setOrganizerCapability } from "./provision.js";
import { OtpService } from "./otp.js";
import { normalizeContact } from "./contact.js";
import { createOtpSender, type OtpSender } from "./sender.js";
import { signAccountToken, verifyAccountToken } from "./tokens.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = "http://127.0.0.1:5173";
const config: FoundationConfig = {
  databaseUrl: databaseUrl ?? "",
  jwtSecret: new Uint8Array(Buffer.alloc(32, 1)),
  contactKey: Buffer.alloc(32, 2),
  otpKey: Buffer.alloc(32, 3),
  cookieSecure: false,
};

describe.skipIf(!databaseUrl)("Slice 2 PostgreSQL/API foundation", () => {
  const db = createDatabase(databaseUrl ?? "");
  const sent = new Map<string, string>();
  const sender: OtpSender = {
    available: () => true,
    async send(_type, destination, code) {
      sent.set(destination, code);
    },
  };
  const otp = new OtpService(db, config, sender);
  const logger = createLogger(
    new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
  );
  const app = createApp({ port: 3000, frontendOrigin: origin }, logger, {
    db,
    config,
    otp,
    frontendOrigin: origin,
  });
  const email = (name: string) => `${name}-${randomUUID()}@example.test`;

  async function waitForDelivery(type: ContactType, contact: string) {
    const lookupHash = normalizeContact(
      type,
      contact,
      config.contactKey,
    ).lookupHash;
    await vi.waitFor(
      async () => {
        expect(sent.get(contact)).toMatch(/^\d{6}$/);
        const row = await db.otpChallenge.findFirst({
          where: { contactType: type, contactLookupHash: lookupHash },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        expect(row?.deliveredAt).not.toBeNull();
      },
      { timeout: 5_000, interval: 20 },
    );
  }

  async function account(name: string, organizerCapable = false) {
    const contact = email(name);
    const userId = await provisionAccount(
      db,
      config,
      ContactType.EMAIL,
      contact,
      organizerCapable,
      randomUUID(),
    );
    return { userId, contact };
  }

  async function signIn(contact: string) {
    const challenged = await request(app)
      .post("/api/v1/auth/account/challenge")
      .set("Origin", origin)
      .send({ type: "EMAIL", contact });
    expect(challenged.status).toBe(202);
    await waitForDelivery(ContactType.EMAIL, contact);
    const verified = await request(app)
      .post("/api/v1/auth/account/verify")
      .set("Origin", origin)
      .send({ type: "EMAIL", contact, code: sent.get(contact) });
    expect(verified.status).toBe(200);
    const cookie = String(verified.headers["set-cookie"]?.[0]).split(";")[0];
    expect(cookie).toContain("eoc_session=");
    expect(String(verified.headers["set-cookie"]?.[0])).toContain("HttpOnly");
    expect(String(verified.headers["set-cookie"]?.[0])).toContain(
      "SameSite=Lax",
    );
    const me = await request(app).get("/api/v1/auth/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    return { cookie, csrf: me.body.csrf_token as string };
  }

  afterAll(async () => {
    await db.$disconnect();
  });

  it("enforces OTP cooldown, hash-only storage, attempts, replay and independent sessions", async () => {
    const user = await account("otp");
    const first = await request(app)
      .post("/api/v1/auth/account/challenge")
      .set("Origin", origin)
      .send({ type: "EMAIL", contact: user.contact });
    expect(first.status).toBe(202);
    await waitForDelivery(ContactType.EMAIL, user.contact);
    const code = sent.get(user.contact);
    expect(code).toMatch(/^\d{6}$/);
    const stored = await db.otpChallenge.findFirst({
      orderBy: { createdAt: "desc" },
    });
    expect(stored?.codeHash).not.toBe(code);
    const cooldown = await request(app)
      .post("/api/v1/auth/account/challenge")
      .set("Origin", origin)
      .send({ type: "EMAIL", contact: user.contact });
    expect(cooldown.status).toBe(202);
    for (let index = 0; index < 4; index++) {
      const wrong = await request(app)
        .post("/api/v1/auth/account/verify")
        .set("Origin", origin)
        .send({
          type: "EMAIL",
          contact: user.contact,
          code: code === "000000" ? "111111" : "000000",
        });
      expect(wrong.status).toBe(401);
    }
    const locked = await request(app)
      .post("/api/v1/auth/account/verify")
      .set("Origin", origin)
      .send({ type: "EMAIL", contact: user.contact, code: "999999" });
    expect(locked.status).toBe(429);
    const replay = await request(app)
      .post("/api/v1/auth/account/verify")
      .set("Origin", origin)
      .send({ type: "EMAIL", contact: user.contact, code });
    expect(replay.status).toBe(429);
    expect(await db.session.count({ where: { userId: user.userId } })).toBe(0);
  });

  it("accepts only the latest unexpired OTP and preserves unknown-account privacy", async () => {
    const unknown = email("unknown");
    expect(
      (
        await request(app)
          .post("/api/v1/auth/account/challenge")
          .set("Origin", origin)
          .send({ type: "EMAIL", contact: unknown })
      ).status,
    ).toBe(202);
    expect(sent.has(unknown)).toBe(false);
    const user = await account("latest");
    await request(app)
      .post("/api/v1/auth/account/challenge")
      .set("Origin", origin)
      .send({ type: "EMAIL", contact: user.contact });
    await waitForDelivery(ContactType.EMAIL, user.contact);
    const oldCode = sent.get(user.contact)!;
    const old = await db.otpChallenge.findFirst({
      orderBy: { createdAt: "desc" },
    });
    await db.otpChallenge.update({
      where: { id: old!.id },
      data: { lastSentAt: new Date(Date.now() - 61_000) },
    });
    expect(
      (
        await request(app)
          .post("/api/v1/auth/account/challenge")
          .set("Origin", origin)
          .send({ type: "EMAIL", contact: user.contact })
      ).status,
    ).toBe(202);
    await waitForDelivery(ContactType.EMAIL, user.contact);
    const latest = await db.otpChallenge.findFirst({
      orderBy: { createdAt: "desc" },
    });
    expect(latest!.id).not.toBe(old!.id);
    expect(
      (await db.otpChallenge.findUnique({ where: { id: old!.id } }))
        ?.consumedAt,
    ).not.toBeNull();
    const oldProof = await request(app)
      .post("/api/v1/auth/account/verify")
      .set("Origin", origin)
      .send({ type: "EMAIL", contact: user.contact, code: oldCode });
    expect(oldProof.status).toBe(401);
    await db.otpChallenge.update({
      where: { id: latest!.id },
      data: {
        createdAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const expired = await request(app)
      .post("/api/v1/auth/account/verify")
      .set("Origin", origin)
      .send({
        type: "EMAIL",
        contact: user.contact,
        code: sent.get(user.contact),
      });
    expect(expired.status).toBe(401);
    expect(await db.session.count({ where: { userId: user.userId } })).toBe(0);
  });

  it("does not disclose account existence across repeated challenge requests", async () => {
    const known = await account("privacy-known");
    const unknown = email("privacy-unknown");
    const challenge = (contact: string) =>
      request(app)
        .post("/api/v1/auth/account/challenge")
        .set("Origin", origin)
        .send({ type: "EMAIL", contact });
    const firstKnown = await challenge(known.contact);
    const firstUnknown = await challenge(unknown);
    await waitForDelivery(ContactType.EMAIL, known.contact);
    const code = sent.get(known.contact);
    const secondKnown = await challenge(known.contact);
    const secondUnknown = await challenge(unknown);
    for (const response of [
      firstKnown,
      firstUnknown,
      secondKnown,
      secondUnknown,
    ]) {
      expect(response.status).toBe(202);
      expect(response.body.status).toBe("pending");
      expect(Object.keys(response.body).sort()).toEqual([
        "correlation_id",
        "status",
      ]);
    }
    expect(sent.has(unknown)).toBe(false);
    expect(sent.get(known.contact)).toBe(code);
    for (const contact of [known.contact, unknown]) {
      const lookupHash = normalizeContact(
        ContactType.EMAIL,
        contact,
        config.contactKey,
      ).lookupHash;
      expect(
        await db.otpChallenge.count({
          where: { contactLookupHash: lookupHash },
        }),
      ).toBe(1);
    }
    const wrongCode = code === "000000" ? "111111" : "000000";
    for (let attempt = 1; attempt <= 5; attempt++) {
      const verify = (contact: string) =>
        request(app)
          .post("/api/v1/auth/account/verify")
          .set("Origin", origin)
          .send({ type: "EMAIL", contact, code: wrongCode });
      const knownResult = await verify(known.contact);
      const unknownResult = await verify(unknown);
      expect(knownResult.status).toBe(attempt === 5 ? 429 : 401);
      expect(unknownResult.status).toBe(knownResult.status);
      expect(unknownResult.body.code).toBe(knownResult.body.code);
    }
  });

  it("bounds verification attempts even without a prior challenge", async () => {
    const known = await account("no-challenge-known");
    const unknown = email("no-challenge-unknown");
    for (let attempt = 1; attempt <= 5; attempt++) {
      for (const contact of [known.contact, unknown]) {
        const response = await request(app)
          .post("/api/v1/auth/account/verify")
          .set("Origin", origin)
          .send({ type: "EMAIL", contact, code: "000000" });
        expect(response.status).toBe(attempt === 5 ? 429 : 401);
      }
    }
    // A rejected verification must not impose the resend cooldown on a real request.
    expect(
      (
        await request(app)
          .post("/api/v1/auth/account/challenge")
          .set("Origin", origin)
          .send({ type: "EMAIL", contact: known.contact })
      ).status,
    ).toBe(202);
    await waitForDelivery(ContactType.EMAIL, known.contact);
  });

  it("does not wait for known-account delivery before returning the generic challenge response", async () => {
    const known = await account("slow-delivery-known");
    const unknown = email("slow-delivery-unknown");
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowSender: OtpSender = {
      available: () => true,
      async send(_type, destination, code) {
        await held;
        sent.set(destination, code);
      },
    };
    const slowApp = createApp({ port: 3000, frontendOrigin: origin }, logger, {
      db,
      config,
      otp: new OtpService(db, config, slowSender),
      frontendOrigin: origin,
    });
    try {
      const challenge = (contact: string) =>
        request(slowApp)
          .post("/api/v1/auth/account/challenge")
          .set("Origin", origin)
          .send({ type: "EMAIL", contact });
      const knownResponse = await challenge(known.contact);
      const unknownResponse = await challenge(unknown);
      expect(knownResponse.status).toBe(202);
      expect(unknownResponse.status).toBe(202);
      expect(knownResponse.body.status).toBe(unknownResponse.body.status);
      expect(sent.has(known.contact)).toBe(false);
      expect(sent.has(unknown)).toBe(false);
    } finally {
      release();
    }
    await waitForDelivery(ContactType.EMAIL, known.contact);
  });

  it("uses an injected phone sender and fails safely without phone configuration", async () => {
    const phone = `+1555${Math.floor(10_000_000 + Math.random() * 90_000_000)}`;
    const userId = await provisionAccount(
      db,
      config,
      ContactType.PHONE,
      phone,
      false,
      randomUUID(),
    );
    const phoneSender = createOtpSender(config, {
      async sendSms(destination, message) {
        const code = message.match(/\b\d{6}\b/)?.[0];
        if (!code) throw new Error("Missing code");
        sent.set(destination, code);
      },
    });
    const phoneApp = createApp({ port: 3000, frontendOrigin: origin }, logger, {
      db,
      config,
      otp: new OtpService(db, config, phoneSender),
      frontendOrigin: origin,
    });
    const accepted = await request(phoneApp)
      .post("/api/v1/auth/account/challenge")
      .set("Origin", origin)
      .send({ type: "PHONE", contact: phone });
    expect(accepted.status).toBe(202);
    await waitForDelivery(ContactType.PHONE, phone);
    const verified = await request(phoneApp)
      .post("/api/v1/auth/account/verify")
      .set("Origin", origin)
      .send({ type: "PHONE", contact: phone, code: sent.get(phone) });
    expect(verified.status).toBe(200);
    expect(await db.session.count({ where: { userId } })).toBe(1);
    const unavailableApp = createApp(
      { port: 3000, frontendOrigin: origin },
      logger,
      {
        db,
        config,
        otp: new OtpService(db, config, createOtpSender(config)),
        frontendOrigin: origin,
      },
    );
    const missingKnown = await request(unavailableApp)
      .post("/api/v1/auth/account/challenge")
      .set("Origin", origin)
      .send({ type: "PHONE", contact: phone });
    const missingUnknown = await request(unavailableApp)
      .post("/api/v1/auth/account/challenge")
      .set("Origin", origin)
      .send({ type: "PHONE", contact: "+15559999999" });
    expect(missingKnown.status).toBe(503);
    expect(missingUnknown.status).toBe(503);
    expect(missingKnown.body.code).toBe(missingUnknown.body.code);
    expect(
      (
        await request(unavailableApp)
          .post("/api/v1/auth/guest/challenge")
          .set("Origin", origin)
          .send({ type: "PHONE", contact: phone })
      ).status,
    ).toBe(503);
  });

  it("revokes only the current session and rejects its copied cookie on the next request", async () => {
    const user = await account("session");
    const first = await signIn(user.contact);
    const challenge = await db.otpChallenge.findFirst({
      where: { contactLookupHash: { not: "" } },
      orderBy: { createdAt: "desc" },
    });
    await db.otpChallenge.update({
      where: { id: challenge!.id },
      data: { lastSentAt: new Date(Date.now() - 61_000) },
    });
    const second = await signIn(user.contact);
    const noCsrf = await request(app)
      .post("/api/v1/auth/logout")
      .set("Origin", origin)
      .set("Cookie", first.cookie);
    expect(noCsrf.status).toBe(403);
    const wrongOrigin = await request(app)
      .post("/api/v1/auth/logout")
      .set("Origin", "http://127.0.0.1:5999")
      .set("Cookie", first.cookie)
      .set("X-CSRF-Token", first.csrf);
    expect(wrongOrigin.status).toBe(403);
    const logout = await request(app)
      .post("/api/v1/auth/logout")
      .set("Origin", origin)
      .set("Cookie", first.cookie)
      .set("X-CSRF-Token", first.csrf);
    expect(logout.status).toBe(200);
    expect(String(logout.headers["set-cookie"]?.[0])).toContain("eoc_session=");
    expect(
      (await request(app).get("/api/v1/auth/me").set("Cookie", first.cookie))
        .status,
    ).toBe(401);
    expect(
      (await request(app).get("/api/v1/auth/me").set("Cookie", second.cookie))
        .status,
    ).toBe(200);
  });

  it("requires valid JWT and matching persisted non-expired Session on every request", async () => {
    const user = await account("session-guards");
    const auth = await signIn(user.contact);
    const token = auth.cookie.split("=")[1];
    const claims = await verifyAccountToken(token, config.jwtSecret);
    expect(claims.userId).toBe(user.userId);
    expect(claims.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      (
        await request(app)
          .get("/api/v1/auth/me")
          .set("Cookie", `${auth.cookie}x`)
      ).status,
    ).toBe(401);
    const mismatch = await signAccountToken(
      randomUUID(),
      claims.sessionId,
      config.jwtSecret,
    );
    expect(
      (
        await request(app)
          .get("/api/v1/auth/me")
          .set("Cookie", `eoc_session=${mismatch}`)
      ).status,
    ).toBe(401);
    const nonexistent = await signAccountToken(
      user.userId,
      randomUUID(),
      config.jwtSecret,
    );
    expect(
      (
        await request(app)
          .get("/api/v1/auth/me")
          .set("Cookie", `eoc_session=${nonexistent}`)
      ).status,
    ).toBe(401);
    await db.session.update({
      where: { id: claims.sessionId },
      data: {
        createdAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    expect(
      (await request(app).get("/api/v1/auth/me").set("Cookie", auth.cookie))
        .status,
    ).toBe(401);
  });

  it("sets Secure on production session cookies and rejects malformed API JSON", async () => {
    const user = await account("secure-cookie");
    const secureConfig = { ...config, cookieSecure: true };
    const secureApp = createApp(
      { port: 3000, frontendOrigin: origin },
      logger,
      {
        db,
        config: secureConfig,
        otp: new OtpService(db, secureConfig, sender),
        frontendOrigin: origin,
      },
    );
    expect(
      (
        await request(secureApp)
          .post("/api/v1/auth/account/challenge")
          .set("Origin", origin)
          .send({ type: "EMAIL", contact: user.contact })
      ).status,
    ).toBe(202);
    await waitForDelivery(ContactType.EMAIL, user.contact);
    const proof = await request(secureApp)
      .post("/api/v1/auth/account/verify")
      .set("Origin", origin)
      .send({
        type: "EMAIL",
        contact: user.contact,
        code: sent.get(user.contact),
      });
    expect(proof.status).toBe(200);
    expect(String(proof.headers["set-cookie"]?.[0])).toContain("Secure");
    const malformed = await request(app)
      .post("/api/v1/auth/account/challenge")
      .set("Origin", origin)
      .set("Content-Type", "application/json")
      .send("{invalid");
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe("VALIDATION");
  });

  it("enforces contact uniqueness and same-event gate scope in PostgreSQL", async () => {
    const user = await account("unique-contact");
    await expect(
      provisionAccount(
        db,
        config,
        ContactType.EMAIL,
        `  ${user.contact.toUpperCase()}  `,
        false,
        randomUUID(),
      ),
    ).rejects.toThrow();
    const owner = await account("fk-owner", true);
    const target = await account("fk-target");
    const event = await db.event.create({
      data: { ownerUserId: owner.userId },
    });
    const other = await db.event.create({
      data: { ownerUserId: owner.userId },
    });
    const gate = await db.gate.create({ data: { eventId: other.id } });
    await expect(
      db.eventRoleAssignment.create({
        data: {
          eventId: event.id,
          userId: target.userId,
          role: StaffRole.GATE_SECURITY,
          gateId: gate.id,
          scopeKey: gate.id,
          grantedByUserId: owner.userId,
        },
      }),
    ).rejects.toThrow();
    const audit = await db.auditEvent.create({
      data: {
        actorKind: "SYSTEM",
        action: "TEST_IMMUTABLE",
        outcome: "ACCEPTED",
        correlationId: randomUUID(),
      },
    });
    await expect(
      db.auditEvent.update({
        where: { id: audit.id },
        data: { outcome: "CHANGED" },
      }),
    ).rejects.toThrow();
  });

  it("keeps event ownership immutable in PostgreSQL and preserves owner authorization", async () => {
    const owner = await account("immutable-owner", true);
    const other = await account("immutable-other", true);
    const event = await db.event.create({
      data: { ownerUserId: owner.userId },
    });
    expect(event.ownerUserId).toBe(owner.userId);
    await expect(
      db.event.update({
        where: { id: event.id },
        data: { ownerUserId: other.userId },
      }),
    ).rejects.toThrow();
    expect(
      (await db.event.findUnique({ where: { id: event.id } }))?.ownerUserId,
    ).toBe(owner.userId);
    const ownerAuth = await signIn(owner.contact);
    const otherAuth = await signIn(other.contact);
    expect(
      (
        await request(app)
          .get(`/api/v1/events/${event.id}/assignments`)
          .set("Cookie", ownerAuth.cookie)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(`/api/v1/events/${event.id}/assignments`)
          .set("Cookie", otherAuth.cookie)
      ).status,
    ).toBe(403);
  });

  it("requires a verified account target and audits rejected staff grants", async () => {
    const owner = await account("verified-grant-owner", true);
    const verified = await account("verified-grant-target");
    const unverified = await db.user.create({ data: {} });
    const missingId = randomUUID();
    const event = await db.event.create({
      data: { ownerUserId: owner.userId },
    });
    const auth = await signIn(owner.contact);
    const grant = (userId: string) =>
      request(app)
        .post(`/api/v1/events/${event.id}/assignments`)
        .set({ Origin: origin, Cookie: auth.cookie, "X-CSRF-Token": auth.csrf })
        .send({ role: StaffRole.VOLUNTEER, user_id: userId });
    expect((await grant(verified.userId)).status).toBe(201);
    expect((await grant(unverified.id)).status).toBe(404);
    expect((await grant(missingId)).status).toBe(404);
    expect(
      await db.eventRoleAssignment.count({ where: { eventId: event.id } }),
    ).toBe(1);
    expect(
      await db.auditEvent.count({
        where: { eventId: event.id, action: "STAFF_GRANTED" },
      }),
    ).toBe(1);
    expect(
      await db.auditEvent.count({
        where: { eventId: event.id, action: "STAFF_ACTION_DENIED" },
      }),
    ).toBe(2);
  });

  it("allows only the assigned gate and denies other gate or event scope", async () => {
    const owner = await account("gate-scope-owner", true);
    const admin = await account("gate-scope-admin");
    const operator = await account("gate-scope-operator");
    const unassigned = await account("gate-scope-unassigned");
    const event = await db.event.create({
      data: { ownerUserId: owner.userId },
    });
    const otherEvent = await db.event.create({
      data: { ownerUserId: owner.userId },
    });
    const gate = await db.gate.create({ data: { eventId: event.id } });
    const otherGate = await db.gate.create({ data: { eventId: event.id } });
    const crossEventGate = await db.gate.create({
      data: { eventId: otherEvent.id },
    });
    const ownerAuth = await signIn(owner.contact);
    const adminAuth = await signIn(admin.contact);
    const operatorAuth = await signIn(operator.contact);
    const unassignedAuth = await signIn(unassigned.contact);
    const granted = await request(app)
      .post(`/api/v1/events/${event.id}/assignments`)
      .set({
        Origin: origin,
        Cookie: ownerAuth.cookie,
        "X-CSRF-Token": ownerAuth.csrf,
      })
      .send({
        role: StaffRole.GATE_SECURITY,
        user_id: operator.userId,
        gate_id: gate.id,
      });
    expect(granted.status).toBe(201);
    expect(
      (
        await request(app)
          .post(`/api/v1/events/${event.id}/assignments`)
          .set({
            Origin: origin,
            Cookie: ownerAuth.cookie,
            "X-CSRF-Token": ownerAuth.csrf,
          })
          .send({ role: StaffRole.EVENT_ADMIN, user_id: admin.userId })
      ).status,
    ).toBe(201);
    const scope = (cookie: string, eventId: string, gateId: string) =>
      request(app)
        .get(`/api/v1/events/${eventId}/gates/${gateId}/scope`)
        .set("Cookie", cookie);
    const allowed = await scope(operatorAuth.cookie, event.id, gate.id);
    expect(allowed.status).toBe(200);
    expect(Object.keys(allowed.body).sort()).toEqual([
      "authorized",
      "correlation_id",
      "event_id",
      "gate_id",
    ]);
    expect(
      (await scope(operatorAuth.cookie, event.id, otherGate.id)).status,
    ).toBe(403);
    expect(
      (await scope(operatorAuth.cookie, event.id, crossEventGate.id)).status,
    ).toBe(404);
    expect(
      (await scope(operatorAuth.cookie, otherEvent.id, crossEventGate.id))
        .status,
    ).toBe(403);
    expect((await scope(unassignedAuth.cookie, event.id, gate.id)).status).toBe(
      403,
    );
    expect((await scope(ownerAuth.cookie, event.id, gate.id)).status).toBe(200);
    expect((await scope(adminAuth.cookie, event.id, gate.id)).status).toBe(200);
    expect(
      (await scope(adminAuth.cookie, otherEvent.id, crossEventGate.id)).status,
    ).toBe(403);
    expect(
      await db.auditEvent.count({
        where: { eventId: event.id, action: "STAFF_ACTION_DENIED" },
      }),
    ).toBeGreaterThanOrEqual(3);
    expect(
      (
        await request(app)
          .delete(`/api/v1/events/${event.id}/assignments/${granted.body.id}`)
          .set({
            Origin: origin,
            Cookie: ownerAuth.cookie,
            "X-CSRF-Token": ownerAuth.csrf,
          })
      ).status,
    ).toBe(200);
    expect((await scope(operatorAuth.cookie, event.id, gate.id)).status).toBe(
      403,
    );
  });

  it("records controlled Organizer capability grant and removal with the state change", async () => {
    const user = await account("capability");
    await setOrganizerCapability(db, user.userId, true, randomUUID());
    expect(
      (await db.user.findUnique({ where: { id: user.userId } }))
        ?.organizerCapable,
    ).toBe(true);
    await setOrganizerCapability(db, user.userId, false, randomUUID());
    expect(
      (await db.user.findUnique({ where: { id: user.userId } }))
        ?.organizerCapable,
    ).toBe(false);
    expect(
      await db.auditEvent.count({
        where: {
          targetUserId: user.userId,
          action: {
            in: [
              "ORGANIZER_CAPABILITY_GRANTED",
              "ORGANIZER_CAPABILITY_REMOVED",
            ],
          },
        },
      }),
    ).toBe(2);
  });

  it("keeps liveness true but rejects readiness and protected work when Session store is unavailable", async () => {
    const user = await account("outage");
    const auth = await signIn(user.contact);
    const dead = createDatabase(
      "postgresql://missing:missing@127.0.0.1:1/missing?connect_timeout=1",
    );
    const deadApp = createApp({ port: 3000, frontendOrigin: origin }, logger, {
      db: dead,
      config,
      otp: new OtpService(dead, config, sender),
      frontendOrigin: origin,
    });
    try {
      expect((await request(deadApp).get("/health/live")).status).toBe(200);
      expect((await request(deadApp).get("/health/ready")).status).toBe(503);
      expect(
        (
          await request(deadApp)
            .get("/api/v1/auth/me")
            .set("Cookie", auth.cookie)
        ).status,
      ).toBe(503);
    } finally {
      await dead.$disconnect();
    }
  });

  it("keeps guest proof separate and authorizes scoped grants with audit", async () => {
    const owner = await account("owner", true);
    const admin = await account("admin");
    const gateUser = await account("gate");
    const volunteer = await account("volunteer");
    const outsider = await account("outsider");
    const event = await db.event.create({
      data: { ownerUserId: owner.userId },
    });
    const other = await db.event.create({
      data: { ownerUserId: outsider.userId },
    });
    const gate = await db.gate.create({ data: { eventId: event.id } });
    const otherGate = await db.gate.create({ data: { eventId: other.id } });
    const ownerAuth = await signIn(owner.contact);
    const adminAuth = await signIn(admin.contact);
    const gateAuth = await signIn(gateUser.contact);
    const volunteerAuth = await signIn(volunteer.contact);
    const headers = (auth: typeof ownerAuth) => ({
      Origin: origin,
      Cookie: auth.cookie,
      "X-CSRF-Token": auth.csrf,
    });
    const grant = (
      auth: typeof ownerAuth,
      role: StaffRole,
      user_id: string,
      gate_id?: string,
    ) =>
      request(app)
        .post(`/api/v1/events/${event.id}/assignments`)
        .set(headers(auth))
        .send({ role, user_id, gate_id });
    expect(
      (await grant(adminAuth, StaffRole.EVENT_ADMIN, outsider.userId)).status,
    ).toBe(403);
    expect(
      (await grant(ownerAuth, StaffRole.VOLUNTEER, owner.userId)).status,
    ).toBe(403);
    expect(
      (await grant(ownerAuth, StaffRole.VOLUNTEER, owner.userId.toUpperCase()))
        .status,
    ).toBe(403);
    expect(
      (await grant(adminAuth, StaffRole.VOLUNTEER, admin.userId)).status,
    ).toBe(403);
    const adminGrant = await grant(
      ownerAuth,
      StaffRole.EVENT_ADMIN,
      admin.userId,
    );
    expect(adminGrant.status).toBe(201);
    expect(
      (await grant(adminAuth, StaffRole.EVENT_ADMIN, outsider.userId)).status,
    ).toBe(403);
    expect(
      (
        await grant(
          adminAuth,
          StaffRole.GATE_SECURITY,
          gateUser.userId,
          otherGate.id,
        )
      ).status,
    ).toBe(400);
    const gateGrant = await grant(
      adminAuth,
      StaffRole.GATE_SECURITY,
      gateUser.userId,
      gate.id.toUpperCase(),
    );
    expect(gateGrant.status).toBe(201);
    expect(
      (
        await grant(
          adminAuth,
          StaffRole.GATE_SECURITY,
          gateUser.userId,
          gate.id,
        )
      ).status,
    ).toBe(409);
    const volunteerGrant = await grant(
      adminAuth,
      StaffRole.VOLUNTEER,
      volunteer.userId,
    );
    expect(volunteerGrant.status).toBe(201);
    const denied = await request(app)
      .get(`/api/v1/events/${event.id}/assignments`)
      .set("Cookie", gateAuth.cookie);
    expect(denied.status).toBe(403);
    expect(
      (
        await request(app)
          .get(`/api/v1/events/${event.id}/assignments`)
          .set("Cookie", volunteerAuth.cookie)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .get(`/api/v1/events/${other.id}/assignments`)
          .set("Cookie", adminAuth.cookie)
      ).status,
    ).toBe(403);
    const adminRead = await request(app)
      .get(`/api/v1/events/${event.id}/assignments`)
      .set("Cookie", adminAuth.cookie);
    expect(adminRead.status).toBe(200);
    expect(
      adminRead.body.assignments.every(
        (row: { role: StaffRole }) => row.role !== StaffRole.EVENT_ADMIN,
      ),
    ).toBe(true);
    const auditCount = await db.auditEvent.count({
      where: { eventId: event.id, action: "STAFF_GRANTED" },
    });
    expect(auditCount).toBe(3);
    const revoke = await request(app)
      .delete(
        `/api/v1/events/${event.id.toUpperCase()}/assignments/${gateGrant.body.id}`,
      )
      .set(headers(adminAuth));
    expect(revoke.status).toBe(200);
    const gateMe = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", gateAuth.cookie);
    expect(
      gateMe.body.assignments.some(
        (row: { id: string }) => row.id === gateGrant.body.id,
      ),
    ).toBe(false);
    expect(
      (
        await db.eventRoleAssignment.findUnique({
          where: { id: volunteerGrant.body.id },
        })
      )?.revokedAt,
    ).toBeNull();
    expect(
      (
        await request(app)
          .delete(
            `/api/v1/events/${event.id}/assignments/${adminGrant.body.id}`,
          )
          .set(headers(ownerAuth))
      ).status,
    ).toBe(200);
    expect(
      (await grant(adminAuth, StaffRole.VOLUNTEER, outsider.userId)).status,
    ).toBe(403);
    const guest = email("guest");
    expect(
      (
        await request(app)
          .post("/api/v1/auth/guest/challenge")
          .set("Origin", origin)
          .send({ type: "EMAIL", contact: guest })
      ).status,
    ).toBe(202);
    await waitForDelivery(ContactType.EMAIL, guest);
    const guestProof = await request(app)
      .post("/api/v1/auth/guest/verify")
      .set("Origin", origin)
      .send({ type: "EMAIL", contact: guest, code: sent.get(guest) });
    expect(guestProof.status).toBe(200);
    const guestCookie = String(guestProof.headers["set-cookie"]?.[0]).split(
      ";",
    )[0];
    expect(
      (await request(app).get("/api/v1/auth/me").set("Cookie", guestCookie))
        .status,
    ).toBe(401);
  });

  it("uses the database unique constraint to settle concurrent identical grants", async () => {
    const owner = await account("race-owner", true);
    const target = await account("race-target");
    const event = await db.event.create({
      data: { ownerUserId: owner.userId },
    });
    const auth = await signIn(owner.contact);
    const send = () =>
      request(app)
        .post(`/api/v1/events/${event.id}/assignments`)
        .set({ Origin: origin, Cookie: auth.cookie, "X-CSRF-Token": auth.csrf })
        .send({ role: StaffRole.VOLUNTEER, user_id: target.userId });
    const outcomes = await Promise.all([send(), send()]);
    expect(outcomes.map((item) => item.status).sort()).toEqual([201, 409]);
    expect(
      await db.eventRoleAssignment.count({
        where: { eventId: event.id, userId: target.userId, revokedAt: null },
      }),
    ).toBe(1);
    expect(
      await db.auditEvent.count({
        where: { eventId: event.id, action: "STAFF_GRANTED" },
      }),
    ).toBe(1);
  });

  it("keeps concurrent revoke and re-grant unique with matching audit", async () => {
    const owner = await account("regrant-owner", true);
    const target = await account("regrant-target");
    const event = await db.event.create({
      data: { ownerUserId: owner.userId },
    });
    const auth = await signIn(owner.contact);
    const headers = {
      Origin: origin,
      Cookie: auth.cookie,
      "X-CSRF-Token": auth.csrf,
    };
    const grant = () =>
      request(app)
        .post(`/api/v1/events/${event.id}/assignments`)
        .set(headers)
        .send({ role: StaffRole.VOLUNTEER, user_id: target.userId });
    const first = await grant();
    expect(first.status).toBe(201);
    const [revoke, regrant] = await Promise.all([
      request(app)
        .delete(`/api/v1/events/${event.id}/assignments/${first.body.id}`)
        .set(headers),
      grant(),
    ]);
    expect(revoke.status).toBe(200);
    expect([201, 409]).toContain(regrant.status);
    expect(
      await db.eventRoleAssignment.count({
        where: { eventId: event.id, userId: target.userId, revokedAt: null },
      }),
    ).toBe(regrant.status === 201 ? 1 : 0);
    expect(
      await db.auditEvent.count({
        where: { eventId: event.id, action: "STAFF_GRANTED" },
      }),
    ).toBe(regrant.status === 201 ? 2 : 1);
    expect(
      await db.auditEvent.count({
        where: { eventId: event.id, action: "STAFF_REVOKED" },
      }),
    ).toBe(1);
  });

  it("denies an Admin grant when concurrent revocation commits before authority is read", async () => {
    const owner = await account("stale-owner", true);
    const admin = await account("stale-admin");
    const target = await account("stale-target");
    const event = await db.event.create({
      data: { ownerUserId: owner.userId },
    });
    const ownerAuth = await signIn(owner.contact);
    const adminAuth = await signIn(admin.contact);
    const adminGrant = await request(app)
      .post(`/api/v1/events/${event.id}/assignments`)
      .set({
        Origin: origin,
        Cookie: ownerAuth.cookie,
        "X-CSRF-Token": ownerAuth.csrf,
      })
      .send({ role: StaffRole.EVENT_ADMIN, user_id: admin.userId });
    expect(adminGrant.status).toBe(201);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let updated!: () => void;
    const locked = new Promise<void>((resolve) => {
      updated = resolve;
    });
    const revocation = db.$transaction(async (tx) => {
      await tx.eventRoleAssignment.update({
        where: { id: adminGrant.body.id },
        data: { revokedAt: new Date(), revokedByUserId: owner.userId },
      });
      updated();
      await held;
      await tx.auditEvent.create({
        data: {
          actorKind: "ACCOUNT",
          actorUserId: owner.userId,
          eventId: event.id,
          targetUserId: admin.userId,
          action: "STAFF_REVOKED",
          outcome: "ACCEPTED",
          correlationId: randomUUID(),
        },
      });
    });
    await locked;
    const pendingGrant = Promise.resolve(
      request(app)
        .post(`/api/v1/events/${event.id}/assignments`)
        .set({
          Origin: origin,
          Cookie: adminAuth.cookie,
          "X-CSRF-Token": adminAuth.csrf,
        })
        .send({ role: StaffRole.VOLUNTEER, user_id: target.userId }),
    );
    let completedBeforeCommit = false;
    void pendingGrant.then(() => {
      completedBeforeCommit = true;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(completedBeforeCommit).toBe(false);
    } finally {
      release();
    }
    await revocation;
    expect((await pendingGrant).status).toBe(403);
    expect(
      await db.eventRoleAssignment.count({
        where: { eventId: event.id, userId: target.userId },
      }),
    ).toBe(0);
    expect(
      await db.auditEvent.count({
        where: {
          eventId: event.id,
          targetUserId: target.userId,
          action: "STAFF_GRANTED",
        },
      }),
    ).toBe(0);
  });

  it("rolls back grants and OTP attempt state when required audit cannot write", async () => {
    const owner = await account("audit-owner", true);
    const target = await account("audit-target");
    const member = await account("audit-member");
    const outsider = await account("audit-outsider");
    const event = await db.event.create({
      data: { ownerUserId: owner.userId },
    });
    const auth = await signIn(owner.contact);
    const outsiderAuth = await signIn(outsider.contact);
    const existing = await request(app)
      .post(`/api/v1/events/${event.id}/assignments`)
      .set({ Origin: origin, Cookie: auth.cookie, "X-CSRF-Token": auth.csrf })
      .send({ role: StaffRole.EVENT_ADMIN, user_id: member.userId });
    expect(existing.status).toBe(201);
    await db.$executeRawUnsafe(`CREATE FUNCTION "slice2_test_reject_audit"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."correlationId" = 'force-audit-failure' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END; $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "slice2_test_audit_failure" BEFORE INSERT ON "AuditEvent"
      FOR EACH ROW EXECUTE FUNCTION "slice2_test_reject_audit"()`);
    try {
      const failedGrant = await request(app)
        .post(`/api/v1/events/${event.id}/assignments`)
        .set({
          Origin: origin,
          Cookie: auth.cookie,
          "X-CSRF-Token": auth.csrf,
          "X-Correlation-Id": "force-audit-failure",
        })
        .send({ role: StaffRole.VOLUNTEER, user_id: target.userId });
      expect(failedGrant.status).toBe(503);
      expect(
        await db.eventRoleAssignment.count({
          where: { eventId: event.id, userId: target.userId },
        }),
      ).toBe(0);
      const failedRevoke = await request(app)
        .delete(`/api/v1/events/${event.id}/assignments/${existing.body.id}`)
        .set({
          Origin: origin,
          Cookie: auth.cookie,
          "X-CSRF-Token": auth.csrf,
          "X-Correlation-Id": "force-audit-failure",
        });
      expect(failedRevoke.status).toBe(503);
      expect(
        (
          await db.eventRoleAssignment.findUnique({
            where: { id: existing.body.id },
          })
        )?.revokedAt,
      ).toBeNull();
      await expect(
        setOrganizerCapability(db, target.userId, true, "force-audit-failure"),
      ).rejects.toThrow();
      expect(
        (await db.user.findUnique({ where: { id: target.userId } }))
          ?.organizerCapable,
      ).toBe(false);
      const challenge = await request(app)
        .post("/api/v1/auth/account/challenge")
        .set("Origin", origin)
        .send({ type: "EMAIL", contact: target.contact });
      expect(challenge.status).toBe(202);
      await waitForDelivery(ContactType.EMAIL, target.contact);
      const row = await db.otpChallenge.findFirst({
        orderBy: { createdAt: "desc" },
      });
      const failedAttempt = await request(app)
        .post("/api/v1/auth/account/verify")
        .set({ Origin: origin, "X-Correlation-Id": "force-audit-failure" })
        .send({ type: "EMAIL", contact: target.contact, code: "not-6-digits" });
      expect(failedAttempt.status).toBe(400);
      const validShapeWrong = await request(app)
        .post("/api/v1/auth/account/verify")
        .set({ Origin: origin, "X-Correlation-Id": "force-audit-failure" })
        .send({
          type: "EMAIL",
          contact: target.contact,
          code: sent.get(target.contact) === "000000" ? "111111" : "000000",
        });
      expect(validShapeWrong.status).toBe(503);
      expect(
        (await db.otpChallenge.findUnique({ where: { id: row!.id } }))
          ?.attempts,
      ).toBe(0);
      const failedDenial = await request(app)
        .get(`/api/v1/events/${event.id}/assignments`)
        .set({
          Cookie: outsiderAuth.cookie,
          "X-Correlation-Id": "force-audit-failure",
        });
      expect(failedDenial.status).toBe(503);
      const sessionsBefore = await db.session.count({
        where: { userId: target.userId },
      });
      const failedSession = await request(app)
        .post("/api/v1/auth/account/verify")
        .set({ Origin: origin, "X-Correlation-Id": "force-audit-failure" })
        .send({
          type: "EMAIL",
          contact: target.contact,
          code: sent.get(target.contact),
        });
      expect(failedSession.status).toBe(503);
      expect(failedSession.headers["set-cookie"]).toBeUndefined();
      expect(await db.session.count({ where: { userId: target.userId } })).toBe(
        sessionsBefore,
      );
      expect(
        (await db.otpChallenge.findUnique({ where: { id: row!.id } }))
          ?.consumedAt,
      ).toBeNull();
      const ownerClaims = await verifyAccountToken(
        auth.cookie.split("=")[1],
        config.jwtSecret,
      );
      const failedLogout = await request(app).post("/api/v1/auth/logout").set({
        Origin: origin,
        Cookie: auth.cookie,
        "X-CSRF-Token": auth.csrf,
        "X-Correlation-Id": "force-audit-failure",
      });
      expect(failedLogout.status).toBe(503);
      expect(
        (await db.session.findUnique({ where: { id: ownerClaims.sessionId } }))
          ?.revokedAt,
      ).toBeNull();
      expect(
        (await request(app).get("/api/v1/auth/me").set("Cookie", auth.cookie))
          .status,
      ).toBe(200);
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER "slice2_test_audit_failure" ON "AuditEvent"`,
      );
      await db.$executeRawUnsafe(`DROP FUNCTION "slice2_test_reject_audit"()`);
    }
  });
});
