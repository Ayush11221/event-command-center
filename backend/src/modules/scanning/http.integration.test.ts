import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createDatabase } from "../../config/database.js";
import { createLogger } from "../../config/logger.js";
import { OtpService } from "../auth/otp.js";
import { csrfToken, signAccountToken, signGuestProof } from "../auth/tokens.js";
import {
  issueCredential,
  recoverCredential,
} from "../registrations/credential.js";
import { checkIn } from "./service.js";
const url = process.env.TEST_DATABASE_URL;
const origin = "http://127.0.0.1:5173";
const config = {
  databaseUrl: url ?? "",
  jwtSecret: Buffer.alloc(32, 9),
  contactKey: Buffer.alloc(32, 10),
  otpKey: Buffer.alloc(32, 11),
  cookieSecure: false,
};
describe.skipIf(!url)("Slice 5 scanner API and persistence", () => {
  const db = createDatabase(url ?? "");
  const deps = {
    db,
    config,
    frontendOrigin: origin,
    otp: new OtpService(db, config, { available: () => true, async send() {} }),
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
    deps,
  );
  afterAll(() => db.$disconnect());
  async function actor(organizerCapable = false) {
    const user = await db.user.create({ data: { organizerCapable } });
    await db.verifiedContact.create({
      data: {
        userId: user.id,
        type: "EMAIL",
        lookupHash: randomUUID().replaceAll("-", "").repeat(2),
        encrypted: "private-contact",
        verifiedAt: new Date(),
      },
    });
    const session = await db.session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 600000) },
    });
    return {
      userId: user.id,
      sessionId: session.id,
      cookie:
        "eoc_session=" +
        (await signAccountToken(user.id, session.id, config.jwtSecret)),
      csrf: csrfToken(session.id, config.jwtSecret),
    };
  }
  async function fixture(guest = false) {
    const owner = await actor(true),
      operator = await actor(),
      participant = await actor();
    const event = await db.event.create({
      data: {
        ownerUserId: owner.userId,
        name: "Scanner event",
        state: "LIVE",
        visibility: "PRIVATE",
        publishedAt: new Date(),
        registrationCapacity: 2,
        startAt: new Date(Date.now() + 3600000),
        endAt: new Date(Date.now() + 7200000),
        timeZone: "UTC",
      },
    });
    const gate = await db.gate.create({ data: { eventId: event.id } });
    const assignment = await db.eventRoleAssignment.create({
      data: {
        eventId: event.id,
        userId: operator.userId,
        role: "GATE_SECURITY",
        gateId: gate.id,
        scopeKey: gate.id,
        grantedByUserId: owner.userId,
      },
    });
    const identity = guest
      ? await db.guestIdentity.create({
          data: { lookupHash: randomUUID().replaceAll("-", "").repeat(2) },
        })
      : null;
    const registration = await db.registration.create({
      data: {
        eventId: event.id,
        ...(identity
          ? { guestIdentityId: identity.id }
          : { userId: participant.userId }),
      },
    });
    const credential = await db.qRCredential.create({
      data: {
        registrationId: registration.id,
        ...issueCredential(registration.id, config.contactKey),
      },
    });
    const token = recoverCredential(
      registration.id,
      credential.protectedRepresentation!,
      config.contactKey,
    );
    const body = {
      scan_id: randomUUID(),
      event_id: event.id,
      gate_id: gate.id,
      credential: token,
    };
    return {
      owner,
      operator,
      participant,
      event,
      gate,
      assignment,
      registration,
      credential,
      token,
      body,
    };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function scan(f: Fixture, body = f.body, who = f.operator) {
    return request(app)
      .post("/api/v1/scan-decisions")
      .set("Cookie", who.cookie)
      .set("Origin", origin)
      .set("X-CSRF-Token", who.csrf)
      .set("Idempotency-Key", body.scan_id)
      .send(body);
  }
  async function noAttendance(f: Fixture) {
    expect(
      await db.attendanceTransition.count({ where: { eventId: f.event.id } }),
    ).toBe(0);
    expect(
      (
        await db.registration.findUniqueOrThrow({
          where: { id: f.registration.id },
        })
      ).firstAcceptedCheckInAt,
    ).toBeNull();
  }
  it.each([false, true])(
    "checks in a valid opaque %s guest registration atomically",
    async (guest) => {
      const f = await fixture(guest),
        corr = randomUUID();
      const result = await scan(f).set("X-Correlation-Id", corr);
      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        scan_id: f.body.scan_id,
        event_id: f.event.id,
        gate_id: f.gate.id,
        decision: "ACCEPTED",
        reason: "ACCEPTED",
        registration_status: "REGISTERED",
        attendance_status: "INSIDE",
        decided_at: expect.any(String),
        replayed: false,
        correlation_id: corr,
      });
      const transition = await db.attendanceTransition.findUniqueOrThrow({
        where: { registrationId: f.registration.id },
      });
      expect(transition).toMatchObject({
        eventId: f.event.id,
        gateId: f.gate.id,
        operatorUserId: f.operator.userId,
        kind: "CHECK_IN",
        acceptedAt: new Date(result.body.decided_at),
      });
      expect(
        (
          await db.registration.findUniqueOrThrow({
            where: { id: f.registration.id },
          })
        ).firstAcceptedCheckInAt,
      ).toEqual(transition.acceptedAt);
      const evidence = await db.scanDecision.findUniqueOrThrow({
        where: { id: transition.scanDecisionId },
      });
      expect(evidence).toMatchObject({
        credentialId: f.credential.id,
        registrationId: f.registration.id,
        correlationId: corr,
        decision: "ACCEPTED",
      });
      const audit = await db.auditEvent.findFirstOrThrow({
        where: { correlationId: corr, action: "SCAN_CHECK_IN" },
      });
      const replay = await db.commandReplay.findFirstOrThrow({
        where: { actorUserId: f.operator.userId, action: "SCAN_CHECK_IN" },
      });
      for (const data of [result.body, audit, replay, evidence, transition]) {
        const encoded = JSON.stringify(data);
        expect(encoded).not.toContain(f.token);
        expect(encoded).not.toContain(f.credential.verifierHash);
        expect(encoded).not.toContain("private-contact");
      }
      expect(result.headers["cache-control"]).toContain("no-store");
    },
  );
  it("replays the same ID with original time and one durable decision/audit", async () => {
    const f = await fixture(),
      first = await scan(f),
      second = await scan(f);
    expect(second.body).toEqual({
      ...first.body,
      replayed: true,
      correlation_id: expect.any(String),
    });
    expect(
      await db.scanDecision.count({ where: { eventId: f.event.id } }),
    ).toBe(1);
    expect(
      await db.auditEvent.count({
        where: { eventId: f.event.id, action: "SCAN_CHECK_IN" },
      }),
    ).toBe(1);
    expect(
      await db.attendanceTransition.count({ where: { eventId: f.event.id } }),
    ).toBe(1);
  });
  it("rejects a different scan ID as a durable duplicate without another transition", async () => {
    const f = await fixture();
    await scan(f);
    const result = await scan(f, { ...f.body, scan_id: randomUUID() });
    expect(result.body).toMatchObject({
      decision: "REJECTED",
      reason: "ALREADY_CHECKED_IN",
      attendance_status: "INSIDE",
      replayed: false,
    });
    expect(
      await db.scanDecision.count({ where: { eventId: f.event.id } }),
    ).toBe(2);
    expect(
      await db.attendanceTransition.count({ where: { eventId: f.event.id } }),
    ).toBe(1);
  });
  it.each([false, true])(
    "serializes concurrent deliveries with same scan ID=%s",
    async (sameId) => {
      const f = await fixture();
      const results = await Promise.all([
        scan(f),
        scan(f, { ...f.body, scan_id: sameId ? f.body.scan_id : randomUUID() }),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(results.map((r) => r.body.reason).sort()).toEqual(
        sameId ? ["ACCEPTED", "ACCEPTED"] : ["ACCEPTED", "ALREADY_CHECKED_IN"],
      );
      expect(results.filter((r) => r.body.replayed)).toHaveLength(
        sameId ? 1 : 0,
      );
      expect(
        await db.attendanceTransition.count({ where: { eventId: f.event.id } }),
      ).toBe(1);
    },
  );
  it("serializes scans from two assigned gates and operators", async () => {
    const f = await fixture(),
      other = await actor();
    const gate = await db.gate.create({ data: { eventId: f.event.id } });
    await db.eventRoleAssignment.create({
      data: {
        eventId: f.event.id,
        gateId: gate.id,
        userId: other.userId,
        role: "GATE_SECURITY",
        scopeKey: gate.id,
        grantedByUserId: f.owner.userId,
      },
    });
    const results = await Promise.all([
      scan(f),
      scan(f, { ...f.body, gate_id: gate.id, scan_id: randomUUID() }, other),
    ]);
    expect(results.map((r) => r.body.reason).sort()).toEqual([
      "ACCEPTED",
      "ALREADY_CHECKED_IN",
    ]);
    expect(
      await db.attendanceTransition.count({ where: { eventId: f.event.id } }),
    ).toBe(1);
  });
  it.each(["changed credential", "changed event"])(
    "rejects conflicting replay: %s",
    async (variant) => {
      const f = await fixture();
      await scan(f);
      const other =
        variant === "changed event" ? randomUUID() : f.body.event_id;
      const result = await scan(f, {
        ...f.body,
        event_id: other,
        credential: variant === "changed credential" ? "changed" : f.token,
      });
      expect(result.status).toBe(variant === "changed event" ? 403 : 409);
      expect(result.body.code).toBe(
        variant === "changed event"
          ? "UNAUTHORIZED_GATE"
          : "IDEMPOTENCY_CONFLICT",
      );
    },
  );
  it("does not reconstruct an expired replay from the scan ledger", async () => {
    const f = await fixture();
    await scan(f);
    await db.commandReplay.updateMany({
      where: { actorUserId: f.operator.userId },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    const result = await scan(f);
    expect(result.status).toBe(410);
    expect(result.body.code).toBe("SCAN_REPLAY_EXPIRED");
    expect(
      await db.scanDecision.count({ where: { eventId: f.event.id } }),
    ).toBe(1);
  });
  it.each(["garbage", "qr1." + "A".repeat(43), "qr1." + "A".repeat(42) + "B"])(
    "rejects forged/malformed proof %#",
    async (credential) => {
      const f = await fixture(),
        result = await scan(f, { ...f.body, credential });
      expect(result.body).toMatchObject({
        decision: "REJECTED",
        reason: "INVALID_CREDENTIAL",
        registration_status: null,
        attendance_status: null,
      });
      await noAttendance(f);
    },
  );
  it("makes wrong-event and unknown proof indistinguishable, including durable references", async () => {
    const f = await fixture(),
      foreign = await fixture();
    const a = await scan(f, { ...f.body, credential: foreign.token });
    const b = await scan(f, {
      ...f.body,
      scan_id: randomUUID(),
      credential: "qr1." + "A".repeat(43),
    });
    expect(b.body).toEqual({
      ...a.body,
      scan_id: b.body.scan_id,
      decided_at: b.body.decided_at,
      correlation_id: b.body.correlation_id,
    });
    expect(a.status).toBe(b.status);
    expect(a.body).not.toHaveProperty("registration_id");
    const rows = await db.scanDecision.findMany({
      where: { eventId: f.event.id },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.credentialId).toBeNull();
      expect(row.registrationId).toBeNull();
    }
    await noAttendance(f);
    await noAttendance(foreign);
  });
  it("rejects expired credentials", async () => {
    const f = await fixture();
    await db.qRCredential.update({
      where: { id: f.credential.id },
      data: {
        issuedAt: new Date(Date.now() - 20000),
        expiresAt: new Date(Date.now() - 10000),
      },
    });
    expect((await scan(f)).body.reason).toBe("EXPIRED_CREDENTIAL");
    await noAttendance(f);
  });
  it.each([false, true])(
    "rejects revoked credential and cancelled registration=%s",
    async (cancelled) => {
      const f = await fixture();
      if (cancelled) {
        const result = await request(app)
          .post("/api/v1/registrations/" + f.registration.id + "/cancel")
          .set("Cookie", f.participant.cookie)
          .set("Origin", origin)
          .set("X-CSRF-Token", f.participant.csrf)
          .set("Idempotency-Key", randomUUID())
          .send({});
        expect(result.status).toBe(200);
      } else
        await db.qRCredential.update({
          where: { id: f.credential.id },
          data: { revokedAt: new Date(), protectedRepresentation: null },
        });
      expect((await scan(f)).body.reason).toBe("CANCELLED_CREDENTIAL");
      await noAttendance(f);
    },
  );
  it.each(["DRAFT", "PUBLISHED", "COMPLETED", "CANCELLED"] as const)(
    "requires LIVE, rejects %s",
    async (state) => {
      const f = await fixture();
      await db.event.update({ where: { id: f.event.id }, data: { state } });
      expect((await scan(f)).body.reason).toBe("REGISTRATION_UNAVAILABLE");
      await noAttendance(f);
    },
  );
  it.each(["OWNER", "EVENT_ADMIN", "VOLUNTEER", "PARTICIPANT"])(
    "does not grant scan execution to %s",
    async (role) => {
      const f = await fixture(),
        who = role === "OWNER" ? f.owner : f.participant;
      if (role === "EVENT_ADMIN" || role === "VOLUNTEER")
        await db.eventRoleAssignment.create({
          data: {
            eventId: f.event.id,
            userId: who.userId,
            role,
            scopeKey: "EVENT",
            grantedByUserId: f.owner.userId,
          },
        });
      const result = await scan(f, f.body, who);
      expect(result.status).toBe(403);
      expect(result.body.code).toBe("UNAUTHORIZED_GATE");
      await noAttendance(f);
    },
  );
  it.each(["other event", "unassigned gate", "missing gate", "missing event"])(
    "denies client-selected scope: %s",
    async (variant) => {
      const f = await fixture(),
        foreign = await fixture();
      const gate = await db.gate.create({ data: { eventId: f.event.id } });
      const body = {
        ...f.body,
        event_id: variant === "missing event" ? randomUUID() : f.event.id,
        gate_id:
          variant === "other event"
            ? foreign.gate.id
            : variant === "unassigned gate"
              ? gate.id
              : variant === "missing gate"
                ? randomUUID()
                : f.gate.id,
      };
      const result = await scan(f, body);
      expect(result.status).toBe(403);
      expect(result.body.code).toBe("UNAUTHORIZED_GATE");
      await noAttendance(f);
    },
  );
  it("requires account authentication and denies guest proof", async () => {
    const f = await fixture();
    expect(
      (await request(app).post("/api/v1/scan-decisions").send(f.body)).status,
    ).toBe(401);
    const proof = await signGuestProof(
      "a".repeat(64),
      "GUEST_OWNERSHIP",
      null,
      config.jwtSecret,
    );
    expect(
      (
        await request(app)
          .post("/api/v1/scan-decisions")
          .set("Cookie", "eoc_guest_proof=" + proof)
          .send(f.body)
      ).status,
    ).toBe(401);
  });
  it.each(["csrf", "origin", "extra field", "header mismatch", "bad id"])(
    "rejects unsafe/malformed request: %s",
    async (variant) => {
      const f = await fixture(),
        body =
          variant === "extra field"
            ? { ...f.body, operator_user_id: f.operator.userId }
            : variant === "bad id"
              ? { ...f.body, gate_id: "bad" }
              : f.body;
      const result = await request(app)
        .post("/api/v1/scan-decisions")
        .set("Cookie", f.operator.cookie)
        .set("Origin", variant === "origin" ? "https://evil.example" : origin)
        .set("X-CSRF-Token", variant === "csrf" ? "bad" : f.operator.csrf)
        .set(
          "Idempotency-Key",
          variant === "header mismatch" ? randomUUID() : f.body.scan_id,
        )
        .send(body);
      expect(result.status).toBe(
        ["csrf", "origin"].includes(variant) ? 403 : 400,
      );
      await noAttendance(f);
    },
  );
  it.each(["assignment", "session"])(
    "rechecks current %s before replay",
    async (variant) => {
      const f = await fixture();
      await scan(f);
      if (variant === "assignment")
        await db.eventRoleAssignment.update({
          where: { id: f.assignment.id },
          data: { revokedAt: new Date(), revokedByUserId: f.owner.userId },
        });
      else
        await db.session.update({
          where: { id: f.operator.sessionId },
          data: { revokedAt: new Date() },
        });
      expect((await scan(f)).status).toBe(variant === "assignment" ? 403 : 401);
    },
  );
  it("rechecks assignment after waiting for the event lock", async () => {
    const f = await fixture();
    let release!: () => void, locked!: () => void;
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${f.event.id}::uuid FOR UPDATE`;
      await tx.eventRoleAssignment.update({
        where: { id: f.assignment.id },
        data: { revokedAt: new Date(), revokedByUserId: f.owner.userId },
      });
      locked();
      await barrier;
    });
    await acquired;
    const outcome = checkIn(deps, f.operator, f.body, randomUUID()).then(
      () => null,
      (error) => error,
    );
    try {
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const rows = await db.$queryRaw<
          { waiting: boolean }[]
        >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE ${"%" + f.event.id + "%"}) AS waiting`;
        // Bound queries use parameters, so observe any event-row lock waiter on this isolated DB.
        const locks = await db.$queryRaw<
          { count: bigint }[]
        >`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
        waiting = rows[0].waiting || Number(locks[0].count) > 0;
        if (waiting) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
    } finally {
      release();
      await blocker;
    }
    expect(await outcome).toMatchObject({
      status: 403,
      code: "UNAUTHORIZED_GATE",
    });
    await noAttendance(f);
  });
  it("prevents participant and organizer cancellation after actual accepted check-in", async () => {
    const f = await fixture();
    await scan(f);
    for (const who of [f.participant, f.owner]) {
      const result = await request(app)
        .post("/api/v1/registrations/" + f.registration.id + "/cancel")
        .set("Cookie", who.cookie)
        .set("Origin", origin)
        .set("X-CSRF-Token", who.csrf)
        .set("Idempotency-Key", randomUUID())
        .send({});
      expect(result.status).toBe(409);
      expect(result.body.code).toBe("ALREADY_CHECKED_IN");
    }
    expect(
      (
        await db.registration.findUniqueOrThrow({
          where: { id: f.registration.id },
        })
      ).state,
    ).toBe("REGISTERED");
  });
  it("serializes cancellation racing with check-in", async () => {
    const f = await fixture();
    const [result, cancel] = await Promise.all([
      scan(f),
      request(app)
        .post("/api/v1/registrations/" + f.registration.id + "/cancel")
        .set("Cookie", f.participant.cookie)
        .set("Origin", origin)
        .set("X-CSRF-Token", f.participant.csrf)
        .set("Idempotency-Key", randomUUID())
        .send({}),
    ]);
    expect(result.status).toBe(200);
    if (result.body.decision === "ACCEPTED") {
      expect(cancel.status).toBe(409);
      expect(cancel.body.code).toBe("ALREADY_CHECKED_IN");
    } else {
      expect(cancel.status).toBe(200);
      expect(result.body.reason).toBe("CANCELLED_CREDENTIAL");
      await noAttendance(f);
    }
  });
  it.each(["accepted", "rejected", "denied"])(
    "fails closed if required %s audit cannot persist",
    async (variant) => {
      const f = await fixture(),
        corr = randomUUID();
      await db.$executeRawUnsafe(
        `CREATE FUNCTION slice5_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."correlationId" = '${corr}' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END $$`,
      );
      await db.$executeRawUnsafe(
        'CREATE TRIGGER slice5_fail_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION slice5_fail_audit()',
      );
      try {
        const result = await scan(
          f,
          variant === "rejected"
            ? { ...f.body, credential: "invalid" }
            : f.body,
          variant === "denied" ? f.participant : f.operator,
        ).set("X-Correlation-Id", corr);
        expect(result.status).toBe(503);
        await noAttendance(f);
        expect(
          await db.scanDecision.count({ where: { eventId: f.event.id } }),
        ).toBe(0);
        expect(
          await db.commandReplay.count({
            where: { actorUserId: f.operator.userId },
          }),
        ).toBe(0);
      } finally {
        await db.$executeRawUnsafe(
          'DROP TRIGGER slice5_fail_audit ON "AuditEvent"',
        );
        await db.$executeRawUnsafe("DROP FUNCTION slice5_fail_audit()");
      }
    },
  );
  it("enforces unique and immutable attendance, source associations and cancellation barrier in PostgreSQL", async () => {
    const f = await fixture();
    await scan(f);
    const row = await db.attendanceTransition.findUniqueOrThrow({
      where: { registrationId: f.registration.id },
    });
    const data = {
      eventId: row.eventId,
      gateId: row.gateId,
      operatorUserId: row.operatorUserId,
      registrationId: row.registrationId,
      scanDecisionId: row.scanDecisionId,
      kind: row.kind,
      acceptedAt: row.acceptedAt,
    };
    await expect(db.attendanceTransition.create({ data })).rejects.toThrow();
    await expect(
      db.attendanceTransition.update({
        where: { id: row.id },
        data: { acceptedAt: new Date() },
      }),
    ).rejects.toThrow();
    await expect(
      db.attendanceTransition.delete({ where: { id: row.id } }),
    ).rejects.toThrow();
    await expect(
      db.scanDecision.delete({ where: { id: row.scanDecisionId } }),
    ).rejects.toThrow();
    await expect(
      db.scanDecision.update({
        where: { id: row.scanDecisionId },
        data: { reason: "INVALID_CREDENTIAL" },
      }),
    ).rejects.toThrow();
    await expect(
      db.registration.update({
        where: { id: f.registration.id },
        data: { firstAcceptedCheckInAt: null },
      }),
    ).rejects.toThrow();
    const foreign = await fixture();
    await expect(
      db.attendanceTransition.create({
        data: { ...data, registrationId: foreign.registration.id },
      }),
    ).rejects.toThrow();
    await expect(
      db.scanDecision.create({
        data: {
          scanId: randomUUID(),
          eventId: f.event.id,
          gateId: f.gate.id,
          operatorUserId: f.operator.userId,
          registrationId: foreign.registration.id,
          credentialId: foreign.credential.id,
          decision: "REJECTED",
          reason: "EXPIRED_CREDENTIAL",
          decidedAt: new Date(),
          correlationId: randomUUID(),
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.scanDecision.create({
        data: {
          scanId: randomUUID(),
          eventId: foreign.event.id,
          gateId: foreign.gate.id,
          operatorUserId: foreign.operator.userId,
          registrationId: foreign.registration.id,
          credentialId: foreign.credential.id,
          decision: "ACCEPTED",
          reason: "ACCEPTED",
          decidedAt: new Date(),
          correlationId: randomUUID(),
        },
      }),
    ).rejects.toThrow();
    const rejected = await scan(foreign, {
      ...foreign.body,
      credential: "bad",
    });
    expect(rejected.body.decision).toBe("REJECTED");
    const source = await db.scanDecision.findFirstOrThrow({
      where: { eventId: foreign.event.id },
    });
    await expect(
      db.attendanceTransition.create({
        data: {
          ...data,
          eventId: foreign.event.id,
          gateId: foreign.gate.id,
          registrationId: foreign.registration.id,
          scanDecisionId: source.id,
        },
      }),
    ).rejects.toThrow();
    await noAttendance(foreign);
  });
});
