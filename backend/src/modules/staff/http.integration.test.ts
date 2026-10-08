import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createDatabase } from "../../config/database.js";
import { createLogger } from "../../config/logger.js";
import { OtpService } from "../auth/otp.js";
import { provisionAccount } from "../auth/provision.js";
import { csrfToken, signAccountToken, signGuestProof } from "../auth/tokens.js";

const url = process.env.TEST_DATABASE_URL;
const origin = "http://127.0.0.1:5173";
const config = {
  databaseUrl: url ?? "",
  jwtSecret: Buffer.alloc(32, 71),
  contactKey: Buffer.alloc(32, 72),
  otpKey: Buffer.alloc(32, 73),
  cookieSecure: false,
};
describe.skipIf(!url)("P0-C authorized staff identity selection", () => {
  const db = createDatabase(url ?? "");
  const deps = {
    db,
    config,
    frontendOrigin: origin,
    otp: new OtpService(db, config, { available: () => true, async send() {} }),
  };
  const logs: string[] = [];
  const app = createApp(
    { port: 3000, frontendOrigin: origin },
    createLogger(
      new Writable({
        write(chunk, _encoding, done) {
          logs.push(String(chunk));
          done();
        },
      }),
    ),
    deps,
  );
  afterAll(() => db.$disconnect());
  async function account(verified = true) {
    const email = `staff-${randomUUID()}@example.test`;
    const userId = verified
      ? await provisionAccount(db, config, "EMAIL", email, false, randomUUID())
      : (await db.user.create({ data: {} })).id;
    const session = await db.session.create({
      data: { userId, expiresAt: new Date(Date.now() + 600000) },
    });
    return {
      userId,
      email,
      headers: {
        Origin: origin,
        Cookie: `eoc_session=${await signAccountToken(userId, session.id, config.jwtSecret)}`,
        "X-CSRF-Token": csrfToken(session.id, config.jwtSecret),
      },
    };
  }
  async function fixture() {
    const owner = await account(),
      admin = await account(),
      security = await account(),
      volunteer = await account(),
      participant = await account(),
      target = await account();
    const event = await db.event.create({
      data: { ownerUserId: owner.userId, name: "Staff event" },
    });
    const gate = await db.gate.create({ data: { eventId: event.id } });
    for (const [actor, role, gateId] of [
      [admin, "EVENT_ADMIN", null],
      [security, "GATE_SECURITY", gate.id],
      [volunteer, "VOLUNTEER", null],
    ] as const) {
      await db.eventRoleAssignment.create({
        data: {
          eventId: event.id,
          userId: actor.userId,
          role,
          gateId,
          scopeKey: gateId ?? "EVENT",
          grantedByUserId: owner.userId,
        },
      });
    }
    const path = `/api/v1/events/${event.id}/assignments`;
    const lookup = (
      headers: Record<string, string>,
      email = target.email,
      suffix = "",
    ) =>
      request(app)
        .post(path + "/account-lookup" + suffix)
        .set(headers)
        .send({ email });
    return {
      owner,
      admin,
      security,
      volunteer,
      participant,
      target,
      event,
      gate,
      path,
      lookup,
    };
  }
  it("returns one exact normalized verified-email match and minimum identity fields, with private responses and redacted logs/audits", async () => {
    const f = await fixture();
    const response = await f.lookup(
      f.owner.headers,
      ` ${f.target.email.toUpperCase()} `,
    );
    expect(response.status).toBe(200);
    expect(response.body.account).toEqual({
      user_id: f.target.userId,
      email: f.target.email,
    });
    expect(Object.keys(response.body).sort()).toEqual([
      "account",
      "correlation_id",
    ]);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    const audit = await db.auditEvent.findFirst({
      where: { eventId: f.event.id, action: "STAFF_ACCOUNT_LOOKUP" },
    });
    expect(audit?.metadata).toBeNull();
    expect(logs.join("")).not.toContain(f.target.email);
    const list = await request(app).get(f.path).set(f.owner.headers);
    expect(list.status).toBe(200);
    expect(list.body.allowed_roles).toEqual([
      "EVENT_ADMIN",
      "GATE_SECURITY",
      "VOLUNTEER",
    ]);
    expect(Object.keys(list.body.assignments[0]).sort()).toEqual([
      "email",
      "gateId",
      "grantedAt",
      "id",
      "role",
      "userId",
    ]);
    expect(
      list.body.assignments.map((row: { email: string }) => row.email),
    ).toContain(f.security.email);
    expect(JSON.stringify(list.body)).not.toMatch(
      /encrypted|lookupHash|session|otp|credential|csrf/i,
    );
  });
  it("preserves Admin visibility/role authority and denies unrelated staff, participants, anonymous and guest callers", async () => {
    const f = await fixture();
    expect((await f.lookup(f.admin.headers)).status).toBe(200);
    const list = await request(app).get(f.path).set(f.admin.headers);
    expect(list.body.allowed_roles).toEqual(["GATE_SECURITY", "VOLUNTEER"]);
    expect(
      list.body.assignments.some(
        (row: { role: string }) => row.role === "EVENT_ADMIN",
      ),
    ).toBe(false);
    for (const actor of [f.security, f.volunteer, f.participant]) {
      const response = await f.lookup(actor.headers);
      expect(response.status).toBe(403);
      expect(response.body.account).toBeUndefined();
      expect((await request(app).get(f.path).set(actor.headers)).status).toBe(
        403,
      );
    }
    expect((await f.lookup({ Origin: origin })).status).toBe(401);
    const guest = await signGuestProof(
      "a".repeat(64),
      "guest_ownership",
      null,
      config.jwtSecret,
    );
    expect(
      (await f.lookup({ Origin: origin, Cookie: `eoc_guest_proof=${guest}` }))
        .status,
    ).toBe(401);
    const unrelated = await db.event.create({
      data: { ownerUserId: f.participant.userId, name: "Other event" },
    });
    expect(
      (
        await request(app)
          .post(`/api/v1/events/${unrelated.id}/assignments/account-lookup`)
          .set(f.owner.headers)
          .send({ email: f.target.email })
      ).status,
    ).toBe(403);
  });
  it("rejects self-selection, malformed or broad queries, missing CSRF, wrong Origin and unverified/nonexistent accounts", async () => {
    const f = await fixture();
    expect((await f.lookup(f.owner.headers, f.owner.email)).body.code).toBe(
      "SELF_ASSIGNMENT",
    );
    for (const email of ["*", "staff-", "", "a".repeat(321)])
      expect((await f.lookup(f.owner.headers, email)).status).toBe(400);
    expect(
      (
        await request(app)
          .post(f.path + "/account-lookup")
          .set(f.owner.headers)
          .send({ email: f.target.email, limit: 100 })
      ).status,
    ).toBe(400);
    expect(
      (await f.lookup(f.owner.headers, f.target.email, "?limit=100")).status,
    ).toBe(400);
    expect(
      (await f.lookup({ ...f.owner.headers, "X-CSRF-Token": "wrong" })).status,
    ).toBe(403);
    expect(
      (await f.lookup({ ...f.owner.headers, Origin: "https://untrusted.test" }))
        .status,
    ).toBe(403);
    const unverified = await account(false);
    for (const email of [
      unverified.email,
      `missing-${randomUUID()}@example.test`,
    ])
      expect((await f.lookup(f.owner.headers, email)).body.account).toBeNull();
    expect(
      (
        await request(app)
          .post(f.path)
          .set(f.owner.headers)
          .send({ user_id: unverified.userId, role: "VOLUNTEER" })
      ).status,
    ).toBe(404);
  });
  it("grants verified accounts only, preserves exact gate and self/Admin guards, and changes roles through revoke then grant", async () => {
    const f = await fixture();
    const grant = (body: object, headers = f.owner.headers) =>
      request(app).post(f.path).set(headers).send(body);
    expect(
      (await grant({ user_id: randomUUID(), role: "VOLUNTEER" })).status,
    ).toBe(404);
    expect(
      (await grant({ user_id: f.owner.userId, role: "VOLUNTEER" })).status,
    ).toBe(403);
    expect(
      (
        await grant(
          { user_id: f.target.userId, role: "EVENT_ADMIN" },
          f.admin.headers,
        )
      ).status,
    ).toBe(403);
    expect(
      (await grant({ user_id: f.target.userId, role: "GATE_SECURITY" })).status,
    ).toBe(400);
    const otherGate = await db.gate.create({
      data: {
        eventId: (
          await db.event.create({
            data: { ownerUserId: f.owner.userId, name: "Other" },
          })
        ).id,
      },
    });
    expect(
      (
        await grant({
          user_id: f.target.userId,
          role: "GATE_SECURITY",
          gate_id: otherGate.id,
        })
      ).status,
    ).toBe(400);
    const first = await grant(
      { user_id: f.target.userId, role: "GATE_SECURITY", gate_id: f.gate.id },
      f.admin.headers,
    );
    expect(first.status).toBe(201);
    expect(
      (
        await request(app)
          .delete(`${f.path}/${first.body.id}`)
          .set(f.admin.headers)
      ).status,
    ).toBe(200);
    expect(
      (
        await db.eventRoleAssignment.findUnique({
          where: { id: first.body.id },
        })
      )?.revokedAt,
    ).not.toBeNull();
    expect(
      (
        await grant(
          { user_id: f.target.userId, role: "VOLUNTEER" },
          f.admin.headers,
        )
      ).status,
    ).toBe(201);
    const scope = await request(app)
      .get(`/api/v1/events/${f.event.id}/gates/${f.gate.id}/scope`)
      .set(f.security.headers);
    expect(scope.body).toMatchObject({
      authorized: true,
      event_name: "Staff event",
      gate_label: "Gate 1",
    });
  });
  it("fails closed when required lookup audit cannot commit, returning no identity", async () => {
    const f = await fixture();
    await db.$executeRawUnsafe(
      `CREATE FUNCTION p0cd_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."correlationId" = 'p0cd-audit-fail' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END; $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER p0cd_reject_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION p0cd_reject_audit()`,
    );
    try {
      const response = await f.lookup({
        ...f.owner.headers,
        "X-Correlation-Id": "p0cd-audit-fail",
      });
      expect(response.status).toBe(503);
      expect(response.body.account).toBeUndefined();
      const denied = await f.lookup({
        ...f.participant.headers,
        "X-Correlation-Id": "p0cd-audit-fail",
      });
      expect(denied.status).toBe(503);
      expect(denied.body.account).toBeUndefined();
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER p0cd_reject_audit ON "AuditEvent"',
      );
      await db.$executeRawUnsafe("DROP FUNCTION p0cd_reject_audit()");
    }
  });
});
