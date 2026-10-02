import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createDatabase } from "../../config/database.js";
import { createLogger } from "../../config/logger.js";
import { OtpService } from "../auth/otp.js";
import { csrfToken, signAccountToken, signGuestProof } from "../auth/tokens.js";
import { normalizeContact } from "../auth/contact.js";
import {
  privateLinkKeys,
  privateLinkVerifier,
  generatePrivateLinkProof,
} from "../events/private-links.js";
import { recoverCredential } from "./credential.js";
import { SignJWT } from "jose";
const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = "http://127.0.0.1:5173";
const config = {
  databaseUrl: databaseUrl ?? "",
  jwtSecret: Buffer.alloc(32, 9),
  contactKey: Buffer.alloc(32, 10),
  otpKey: Buffer.alloc(32, 11),
  cookieSecure: false,
};
describe.skipIf(!databaseUrl)("Slice 4 registration API", () => {
  const db = createDatabase(databaseUrl ?? "");
  let delivered = "";
  const otp = new OtpService(db, config, {
    available: () => true,
    async send(_type, _contact, code) {
      delivered = code;
    },
  });
  const app = createApp(
    { port: 3000, frontendOrigin: origin },
    createLogger(
      new Writable({
        write(_c, _e, done) {
          done();
        },
      }),
    ),
    { db, config, otp, frontendOrigin: origin },
  );
  afterAll(() => db.$disconnect());
  async function actor(organizerCapable = false) {
    const user = await db.user.create({ data: { organizerCapable } });
    await db.verifiedContact.create({
      data: {
        userId: user.id,
        type: "EMAIL",
        lookupHash: randomUUID().replaceAll("-", "").repeat(2),
        encrypted: "fixture",
        verifiedAt: new Date(),
      },
    });
    const session = await db.session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 600000) },
    });
    return {
      id: user.id,
      sessionId: session.id,
      cookie: `eoc_session=${await signAccountToken(user.id, session.id, config.jwtSecret)}`,
      csrf: csrfToken(session.id, config.jwtSecret),
    };
  }
  type Actor = Awaited<ReturnType<typeof actor>>;
  async function event(capacity = 2, overrides: Record<string, unknown> = {}) {
    const owner = await actor(true);
    const row = await db.event.create({
      data: {
        ownerUserId: owner.id,
        name: "Registration event",
        state: "PUBLISHED",
        visibility: "PUBLIC",
        publishedAt: new Date(),
        registrationCapacity: capacity,
        startAt: new Date(Date.now() + 3600000),
        endAt: new Date(Date.now() + 7200000),
        timeZone: "UTC",
        ...overrides,
      },
    });
    return { row, owner };
  }
  function post(
    path: string,
    who: Pick<Actor, "cookie" | "csrf">,
    key: string = randomUUID(),
  ) {
    return request(app)
      .post(`/api/v1${path}`)
      .set("Cookie", who.cookie)
      .set("Origin", origin)
      .set("X-CSRF-Token", who.csrf)
      .set("Idempotency-Key", key)
      .send({});
  }
  function get(path: string, who: Pick<Actor, "cookie">) {
    return request(app).get(`/api/v1${path}`).set("Cookie", who.cookie);
  }
  async function registered() {
    const e = await event(),
      user = await actor(),
      result = await post(`/events/${e.row.id}/registrations`, user);
    expect(result.status).toBe(201);
    return {
      ...e,
      user,
      id: result.body.registration.registration_id as string,
    };
  }
  it("creates account registration and credential atomically, recovers own state and records secret-free audit/replay", async () => {
    const e = await event(),
      user = await actor(),
      key = randomUUID(),
      corr = randomUUID();
    const first = await post(
      `/events/${e.row.id}/registrations`,
      user,
      key,
    ).set("X-Correlation-ID", corr);
    expect(first.status).toBe(201);
    const id = first.body.registration.registration_id;
    expect(first.body.registration.state).toBe("REGISTERED");
    expect(
      (await get(`/events/${e.row.id}/registrations`, user)).body.registration
        .registration_id,
    ).toBe(id);
    const stored = await db.qRCredential.findFirstOrThrow({
      where: { registrationId: id },
    });
    const token = recoverCredential(
      id,
      stored.protectedRepresentation!,
      config.contactKey,
    );
    const qr = await get(`/registrations/${id}/credential`, user);
    expect(qr.status).toBe(200);
    expect(qr.body.qr_svg).toContain("<svg");
    expect(qr.headers["cache-control"]).toContain("no-store");
    const replay = await post(`/events/${e.row.id}/registrations`, user, key);
    expect(replay.body.registration).toEqual(first.body.registration);
    expect(await db.registration.count({ where: { eventId: e.row.id } })).toBe(
      1,
    );
    for (const payload of [
      first.body,
      await db.auditEvent.findMany({ where: { correlationId: corr } }),
      await db.commandReplay.findMany({ where: { actorUserId: user.id } }),
    ])
      expect(JSON.stringify(payload)).not.toContain(token);
    expect(qr.body).not.toHaveProperty("token");
    expect(first.body).not.toHaveProperty("credential");
  });
  it("enforces one active account registration under concurrent different keys", async () => {
    const e = await event(5),
      user = await actor();
    const results = await Promise.all([
      post(`/events/${e.row.id}/registrations`, user),
      post(`/events/${e.row.id}/registrations`, user),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe(
      "DUPLICATE_ACTIVE",
    );
  });
  it("serializes concurrent final-capacity claims", async () => {
    const e = await event(1),
      a = await actor(),
      b = await actor();
    const results = await Promise.all([
      post(`/events/${e.row.id}/registrations`, a),
      post(`/events/${e.row.id}/registrations`, b),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe(
      "CAPACITY_FULL",
    );
    expect(
      await db.registration.count({
        where: { eventId: e.row.id, state: "REGISTERED" },
      }),
    ).toBe(1);
  });
  it("serializes concurrent identical retries into one result", async () => {
    const e = await event(),
      user = await actor(),
      key = randomUUID();
    const results = await Promise.all([
      post(`/events/${e.row.id}/registrations`, user, key),
      post(`/events/${e.row.id}/registrations`, user, key),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0].body.registration).toEqual(results[1].body.registration);
  });
  it.each([
    [
      { registrationOpensAt: new Date(Date.now() + 1800000) },
      "REGISTRATION_NOT_OPEN",
    ],
    [
      { registrationClosesAt: new Date(Date.now() - 1000) },
      "REGISTRATION_CLOSED",
    ],
    [{ registrationManuallyClosed: true }, "REGISTRATION_CLOSED"],
    [{ state: "LIVE" }, "REGISTRATION_CLOSED"],
    [{ state: "COMPLETED" }, "REGISTRATION_CLOSED"],
    [{ state: "CANCELLED" }, "EVENT_CANCELLED"],
  ])("rejects unavailable registration %j", async (overrides, code) => {
    const e = await event(2, overrides),
      user = await actor();
    const result = await post(`/events/${e.row.id}/registrations`, user);
    expect(result.status).toBe(409);
    expect(result.body.code).toBe(code);
    expect(await db.registration.count({ where: { eventId: e.row.id } })).toBe(
      0,
    );
  });
  it("preserves the configuration-only policy shape and public allowlist", async () => {
    const e = await registered();
    const response = await request(app).get(
      `/api/v1/discovery/events/${e.row.id}`,
    );
    expect(response.status).toBe(200);
    expect(Object.keys(response.body.availability).sort()).toEqual([
      "as_of",
      "closes_at",
      "opens_at",
      "policy_status",
      "reasons",
    ]);
    expect(JSON.stringify(response.body)).not.toContain(e.id);
    expect(response.body).not.toHaveProperty("registrations");
  });
  it("cancels, retains history, destroys owner representation, frees capacity and re-registers with a new token", async () => {
    const e = await event(1),
      user = await actor();
    const first = await post(`/events/${e.row.id}/registrations`, user),
      id = first.body.registration.registration_id;
    const old = await db.qRCredential.findFirstOrThrow({
        where: { registrationId: id },
      }),
      token = recoverCredential(
        id,
        old.protectedRepresentation!,
        config.contactKey,
      );
    expect((await post(`/registrations/${id}/cancel`, user)).status).toBe(200);
    const cancelled = await db.registration.findUniqueOrThrow({
      where: { id },
    });
    expect(cancelled.state).toBe("CANCELLED");
    expect(cancelled.cancelledByUserId).toBe(user.id);
    const revoked = await db.qRCredential.findUniqueOrThrow({
      where: { id: old.id },
    });
    expect(revoked.revokedAt).not.toBeNull();
    expect(revoked.protectedRepresentation).toBeNull();
    expect((await get(`/registrations/${id}/credential`, user)).status).toBe(
      410,
    );
    const second = await post(`/events/${e.row.id}/registrations`, user);
    expect(second.status).toBe(201);
    expect(second.body.registration.registration_id).not.toBe(id);
    const current = await db.qRCredential.findFirstOrThrow({
      where: { registrationId: second.body.registration.registration_id },
    });
    expect(
      recoverCredential(
        current.registrationId,
        current.protectedRepresentation!,
        config.contactKey,
      ),
    ).not.toBe(token);
  });
  it("does not revive cancelled credentials on create/cancel replay", async () => {
    const e = await event(),
      user = await actor(),
      createKey = randomUUID(),
      cancelKey = randomUUID();
    const first = await post(
        `/events/${e.row.id}/registrations`,
        user,
        createKey,
      ),
      id = first.body.registration.registration_id;
    await post(`/registrations/${id}/cancel`, user, cancelKey);
    expect(
      (await post(`/events/${e.row.id}/registrations`, user, createKey)).status,
    ).toBe(201);
    expect(
      (await post(`/registrations/${id}/cancel`, user, cancelKey)).body
        .registration.state,
    ).toBe("CANCELLED");
    expect((await get(`/registrations/${id}/credential`, user)).status).toBe(
      410,
    );
  });
  it("enforces participant cutoff and current scoped Organizer/Admin cancellation", async () => {
    const e = await registered(),
      admin = await actor();
    await db.event.update({
      where: { id: e.row.id },
      data: { registrationCancellationCutoffAt: new Date(Date.now() - 1000) },
    });
    expect(
      (await post(`/registrations/${e.id}/cancel`, e.user)).body.code,
    ).toBe("CANCELLATION_CUTOFF_REACHED");
    await db.eventRoleAssignment.create({
      data: {
        eventId: e.row.id,
        userId: admin.id,
        role: "EVENT_ADMIN",
        scopeKey: "EVENT",
        grantedByUserId: e.owner.id,
      },
    });
    expect((await get(`/registrations/${e.id}`, admin)).status).toBe(200);
    expect((await get(`/registrations/${e.id}/credential`, admin)).status).toBe(
      404,
    );
    expect(
      (await get(`/registrations/${e.id}/credential`, e.owner)).status,
    ).toBe(404);
    expect((await post(`/registrations/${e.id}/cancel`, admin)).status).toBe(
      200,
    );
    const another = await registered();
    await db.event.update({
      where: { id: another.row.id },
      data: { registrationCancellationCutoffAt: new Date(Date.now() - 1000) },
    });
    expect(
      (await post(`/registrations/${another.id}/cancel`, another.owner)).status,
    ).toBe(200);
  });
  it("denies everyone cancellation after the first accepted check-in fact without implementing check-in", async () => {
    const e = await registered();
    await db.registration.update({
      where: { id: e.id },
      data: { firstAcceptedCheckInAt: new Date() },
    });
    for (const who of [e.user, e.owner])
      expect((await post(`/registrations/${e.id}/cancel`, who)).body.code).toBe(
        "ALREADY_CHECKED_IN",
      );
    expect(
      (await db.registration.findUniqueOrThrow({ where: { id: e.id } })).state,
    ).toBe("REGISTERED");
  });
  it("denies strangers and Gate/Volunteer roles without leaking registration details", async () => {
    const e = await registered(),
      stranger = await actor();
    for (const role of ["GATE_SECURITY", "VOLUNTEER"] as const) {
      const staff = await actor(),
        gate = await db.gate.create({ data: { eventId: e.row.id } });
      await db.eventRoleAssignment.create({
        data: {
          eventId: e.row.id,
          userId: staff.id,
          role,
          gateId: role === "GATE_SECURITY" ? gate.id : null,
          scopeKey: role === "GATE_SECURITY" ? gate.id : "EVENT",
          grantedByUserId: e.owner.id,
        },
      });
      for (const who of [stranger, staff]) {
        expect((await get(`/registrations/${e.id}`, who)).body.code).toBe(
          "REGISTRATION_NOT_FOUND",
        );
        expect(
          (await get(`/registrations/${e.id}/credential`, who)).status,
        ).toBe(404);
        expect((await post(`/registrations/${e.id}/cancel`, who)).status).toBe(
          404,
        );
      }
    }
  });
  it("rechecks current session and staff authority before replay", async () => {
    const e = await registered(),
      admin = await actor(),
      key = randomUUID();
    const assignment = await db.eventRoleAssignment.create({
      data: {
        eventId: e.row.id,
        userId: admin.id,
        role: "EVENT_ADMIN",
        scopeKey: "EVENT",
        grantedByUserId: e.owner.id,
      },
    });
    expect(
      (await post(`/registrations/${e.id}/cancel`, admin, key)).status,
    ).toBe(200);
    await db.eventRoleAssignment.update({
      where: { id: assignment.id },
      data: { revokedAt: new Date(), revokedByUserId: e.owner.id },
    });
    expect(
      (await post(`/registrations/${e.id}/cancel`, admin, key)).status,
    ).toBe(404);
    await db.session.update({
      where: { id: e.user.sessionId },
      data: { revokedAt: new Date() },
    });
    expect((await get(`/registrations/${e.id}`, e.user)).status).toBe(401);
  });
  it("requires authentication, CSRF, origin, safe command input and verified account contact", async () => {
    const e = await event(),
      user = await actor(),
      path = `/api/v1/events/${e.row.id}/registrations`;
    expect((await request(app).post(path).send({})).status).toBe(401);
    expect(
      (
        await request(app)
          .post(path)
          .set("Cookie", user.cookie)
          .set("Origin", origin)
          .set("Idempotency-Key", randomUUID())
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await post(`/events/${e.row.id}/registrations`, user).set(
          "Origin",
          "https://evil.example",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await post(`/events/${e.row.id}/registrations`, user).send({
          user_id: user.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (await post(`/events/${e.row.id}/registrations`, user, "short")).status,
    ).toBe(400);
    await db.verifiedContact.deleteMany({ where: { userId: user.id } });
    expect((await post(`/events/${e.row.id}/registrations`, user)).status).toBe(
      401,
    );
  });
  it.each(["EMAIL", "PHONE"] as const)(
    "registers and recovers existing OTP guest %s with guest-scoped replay",
    async (type) => {
      const e = await event(),
        contact =
          type === "EMAIL"
            ? `${randomUUID()}@example.com`
            : `+1555${Math.floor(1000000 + Math.random() * 8999999)}`;
      expect(
        (
          await request(app)
            .post("/api/v1/auth/guest/challenge")
            .set("Origin", origin)
            .send({ type, contact })
        ).status,
      ).toBe(202);
      const lookupHash = normalizeContact(
        type,
        contact,
        config.contactKey,
      ).lookupHash;
      for (let attempt = 0; attempt < 50; attempt++) {
        if (
          (
            await db.otpChallenge.findFirst({
              where: { contactLookupHash: lookupHash },
              orderBy: { createdAt: "desc" },
            })
          )?.deliveredAt
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const verified = await request(app)
        .post("/api/v1/auth/guest/verify")
        .set("Origin", origin)
        .send({ type, contact, code: delivered });
      expect(verified.status).toBe(200);
      const cookie = verified.headers["set-cookie"][0].split(";")[0];
      const self = await get("/auth/guest/self", { cookie });
      const guest = { cookie, csrf: self.body.csrf_token },
        key = randomUUID();
      const result = await post(
        `/events/${e.row.id}/registrations`,
        guest,
        key,
      );
      expect(result.status).toBe(201);
      const id = result.body.registration.registration_id;
      expect(
        (await post(`/events/${e.row.id}/registrations`, guest, key)).body
          .registration.registration_id,
      ).toBe(id);
      expect(
        (await post(`/events/${e.row.id}/registrations`, guest)).body.code,
      ).toBe("DUPLICATE_ACTIVE");
      expect((await get(`/registrations/${id}/credential`, guest)).status).toBe(
        200,
      );
      expect((await post(`/registrations/${id}/cancel`, guest)).body.code).toBe(
        "FRESH_GUEST_PROOF_REQUIRED",
      );
      const stored = await db.registration.findUniqueOrThrow({ where: { id } });
      expect(stored.userId).toBeNull();
      expect(stored.guestIdentityId).not.toBeNull();
      expect(
        (
          await db.commandReplay.findFirstOrThrow({
            where: { actorGuestIdentityId: stored.guestIdentityId },
          })
        ).actorUserId,
      ).toBeNull();
      // Advance the consumed challenge's cooldown fixture, then perform another real OTP verification.
      await db.otpChallenge.updateMany({
        where: { contactLookupHash: lookupHash },
        data: { lastSentAt: new Date(Date.now() - 61000) },
      });
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await request(app)
        .post("/api/v1/auth/guest/challenge")
        .set("Origin", origin)
        .send({ type, contact });
      for (let attempt = 0; attempt < 50; attempt++) {
        if (
          (
            await db.otpChallenge.findFirst({
              where: { contactLookupHash: lookupHash },
              orderBy: { createdAt: "desc" },
            })
          )?.deliveredAt
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const renewed = await request(app)
        .post("/api/v1/auth/guest/verify")
        .set("Origin", origin)
        .send({ type, contact, code: delivered });
      expect(renewed.status).toBe(200);
      const freshCookie = renewed.headers["set-cookie"][0].split(";")[0];
      const fresh = {
        cookie: freshCookie,
        csrf: (await get("/auth/guest/self", { cookie: freshCookie })).body
          .csrf_token,
      };
      expect((await post(`/registrations/${id}/cancel`, fresh)).status).toBe(
        200,
      );
      expect(
        (await db.registration.findUniqueOrThrow({ where: { id } }))
          .cancelledActorKind,
      ).toBe("GUEST");
    },
  );
  it("rejects expired, wrong-purpose, event-bound and other-identity guest proofs", async () => {
    const e = await event(),
      hash = normalizeContact(
        "EMAIL",
        `${randomUUID()}@example.com`,
        config.contactKey,
      ).lookupHash;
    for (const [purpose, context] of [
      ["other", null],
      ["guest_ownership", randomUUID()],
    ] as const) {
      const token = await signGuestProof(
          hash,
          purpose,
          context,
          config.jwtSecret,
        ),
        guest = {
          cookie: `eoc_guest_proof=${token}`,
          csrf: csrfToken(token, config.jwtSecret),
        };
      expect(
        (await post(`/events/${e.row.id}/registrations`, guest)).status,
      ).toBe(purpose === "other" ? 401 : 404);
    }
    const token = await signGuestProof(
        hash,
        "guest_ownership",
        null,
        config.jwtSecret,
      ),
      guest = {
        cookie: `eoc_guest_proof=${token}`,
        csrf: csrfToken(token, config.jwtSecret),
      };
    const created = await post(`/events/${e.row.id}/registrations`, guest);
    const other = await signGuestProof(
      "a".repeat(64),
      "guest_ownership",
      null,
      config.jwtSecret,
    );
    expect(
      (
        await get(
          `/registrations/${created.body.registration.registration_id}/credential`,
          { cookie: `eoc_guest_proof=${other}` },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await get(
          `/registrations/${created.body.registration.registration_id}`,
          { cookie: "eoc_guest_proof=invalid" },
        )
      ).status,
    ).toBe(401);
    const expired = await new SignJWT({
      purpose: "guest_ownership",
      context_event_id: null,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(hash)
      .setIssuer("event-command-center")
      .setAudience("event-command-center-guest")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 1000)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
      .sign(config.jwtSecret);
    expect(
      (
        await get(
          `/registrations/${created.body.registration.registration_id}`,
          { cookie: `eoc_guest_proof=${expired}` },
        )
      ).status,
    ).toBe(401);
  });
  it("requires current PRIVATE bearer access for new registrations but ownership independently recovers history", async () => {
    const e = await event(3, { visibility: "PRIVATE" }),
      user = await actor(),
      token = generatePrivateLinkProof(),
      key = privateLinkKeys(config.contactKey).verifier;
    const link = await db.privateAccessLink.create({
      data: {
        eventId: e.row.id,
        verifierHash: privateLinkVerifier(token, key),
      },
    });
    for (const proof of [undefined, "bad", generatePrivateLinkProof()]) {
      const req = post(`/events/${e.row.id}/registrations`, user);
      if (proof) req.set("Authorization", `PrivateLink ${proof}`);
      expect((await req).status).toBe(404);
    }
    const valid = await post(`/events/${e.row.id}/registrations`, user).set(
      "Authorization",
      `PrivateLink ${token}`,
    );
    expect(valid.status).toBe(201);
    await db.privateAccessLink.update({
      where: { id: link.id },
      data: { revokedAt: new Date() },
    });
    expect(
      (await get(`/events/${e.row.id}/registrations`, user)).body.registration
        .registration_id,
    ).toBe(valid.body.registration.registration_id);
    expect(
      (
        await post(`/events/${e.row.id}/registrations`, await actor()).set(
          "Authorization",
          `PrivateLink ${token}`,
        )
      ).status,
    ).toBe(404);
    await db.event.update({
      where: { id: e.row.id },
      data: { state: "CANCELLED" },
    });
    expect(
      (
        await get(
          `/registrations/${valid.body.registration.registration_id}`,
          user,
        )
      ).body.registration.state,
    ).toBe("REGISTERED");
  });
  it("enforces server-side credential expiry and rejects corrupted protected representations", async () => {
    const e = await registered(),
      stored = await db.qRCredential.findFirstOrThrow({
        where: { registrationId: e.id },
      });
    await db.qRCredential.update({
      where: { id: stored.id },
      data: {
        issuedAt: new Date(Date.now() - 20000),
        expiresAt: new Date(Date.now() - 10000),
      },
    });
    expect(
      (await get(`/registrations/${e.id}/credential`, e.user)).body.code,
    ).toBe("CREDENTIAL_EXPIRED");
    await db.qRCredential.update({
      where: { id: stored.id },
      data: { expiresAt: null, protectedRepresentation: Buffer.alloc(35) },
    });
    expect(
      (await get(`/registrations/${e.id}/credential`, e.user)).status,
    ).toBe(503);
  });
  it("fails closed and rolls back registration, credential, cancellation and replay when required audit fails", async () => {
    const e = await event(),
      user = await actor(),
      corr = randomUUID();
    await db.$executeRawUnsafe(
      `CREATE FUNCTION slice4_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."correlationId" = '${corr}' THEN RAISE EXCEPTION 'required audit unavailable'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER slice4_audit_failure BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION slice4_audit_failure()',
    );
    try {
      expect(
        (
          await post(`/events/${e.row.id}/registrations`, user).set(
            "X-Correlation-ID",
            corr,
          )
        ).status,
      ).toBe(503);
      expect(
        await db.registration.count({ where: { eventId: e.row.id } }),
      ).toBe(0);
      expect(
        await db.commandReplay.count({ where: { actorUserId: user.id } }),
      ).toBe(0);
      const ok = await post(`/events/${e.row.id}/registrations`, user),
        id = ok.body.registration.registration_id;
      expect(
        (
          await post(`/registrations/${id}/cancel`, user).set(
            "X-Correlation-ID",
            corr,
          )
        ).status,
      ).toBe(503);
      expect(
        (await db.registration.findUniqueOrThrow({ where: { id } })).state,
      ).toBe("REGISTERED");
      expect(
        (
          await db.qRCredential.findFirstOrThrow({
            where: { registrationId: id },
          })
        ).revokedAt,
      ).toBeNull();
      expect(
        (
          await get(`/registrations/${id}`, await actor()).set(
            "X-Correlation-ID",
            corr,
          )
        ).status,
      ).toBe(503);
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER slice4_audit_failure ON "AuditEvent"',
      );
      await db.$executeRawUnsafe("DROP FUNCTION slice4_audit_failure()");
    }
  });
  it("database constraints independently reject duplicate active credentials and ambiguous registration owners", async () => {
    const e = await registered(),
      stored = await db.qRCredential.findFirstOrThrow({
        where: { registrationId: e.id },
      });
    await expect(
      db.qRCredential.create({
        data: {
          registrationId: e.id,
          verifierHash: "f".repeat(64),
          protectedRepresentation: stored.protectedRepresentation,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.registration.create({ data: { eventId: e.row.id } }),
    ).rejects.toThrow();
    await expect(
      db.registration.create({
        data: { eventId: e.row.id, userId: e.user.id },
      }),
    ).rejects.toThrow();
  });
});
