import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { createServer } from "node:http";
import { io as connect, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createDatabase } from "../../config/database.js";
import { createLogger } from "../../config/logger.js";
import { OtpService } from "../auth/otp.js";
import { csrfToken, signAccountToken, signGuestProof } from "../auth/tokens.js";
import {
  issueCredential,
  recoverCredential,
} from "../registrations/credential.js";
import { operationsSnapshot } from "./service.js";
import { attachOperationsRealtime } from "./realtime.js";
const url = process.env.TEST_DATABASE_URL,
  origin = "http://127.0.0.1:5173";
const config = {
  databaseUrl: url ?? "",
  jwtSecret: Buffer.alloc(32, 9),
  contactKey: Buffer.alloc(32, 10),
  otpKey: Buffer.alloc(32, 11),
  cookieSecure: false,
};
describe.skipIf(!url)("Slice 6 transactional operations snapshots", () => {
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
  const server = createServer(app);
  const realtime = attachOperationsRealtime(server, deps, 25);
  let address = "";
  const clients: Socket[] = [];
  beforeAll(async () => {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const bound = server.address();
    if (!bound || typeof bound === "string")
      throw new Error("Missing socket address");
    address = `http://127.0.0.1:${bound.port}`;
  });
  afterAll(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>((done) => realtime.close(() => done()));
    await db.$disconnect();
  });
  async function client(cookie?: string, requestOrigin = origin) {
    const socket = connect(address, {
      path: "/api/v1/realtime/socket.io",
      transports: ["websocket"],
      extraHeaders: {
        Origin: requestOrigin,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      reconnection: false,
      autoConnect: false,
    });
    clients.push(socket);
    const result = new Promise<Socket>((resolve, reject) => {
      socket.once("connect", () => resolve(socket));
      socket.once("connect_error", reject);
    });
    socket.connect();
    return result;
  }
  async function subscribe(socket: Socket, eventId: string) {
    return socket
      .timeout(3000)
      .emitWithAck("operations.subscribe", { event_id: eventId });
  }
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
  async function fixture() {
    const owner = await actor(true),
      admin = await actor(),
      operator = await actor(),
      volunteer = await actor(),
      participant = await actor();
    const event = await db.event.create({
      data: {
        ownerUserId: owner.userId,
        name: "Internal occupancy",
        state: "LIVE",
        visibility: "PRIVATE",
        publishedAt: new Date(),
        registrationCapacity: 1,
        startAt: new Date(Date.now() + 3600000),
        endAt: new Date(Date.now() + 7200000),
        timeZone: "UTC",
      },
    });
    const gate = await db.gate.create({ data: { eventId: event.id } });
    const adminAssignment = await db.eventRoleAssignment.create({
      data: {
        eventId: event.id,
        userId: admin.userId,
        role: "EVENT_ADMIN",
        scopeKey: "EVENT",
        grantedByUserId: owner.userId,
      },
    });
    await db.eventRoleAssignment.create({
      data: {
        eventId: event.id,
        userId: operator.userId,
        role: "GATE_SECURITY",
        gateId: gate.id,
        scopeKey: gate.id,
        grantedByUserId: owner.userId,
      },
    });
    await db.eventRoleAssignment.create({
      data: {
        eventId: event.id,
        userId: volunteer.userId,
        role: "VOLUNTEER",
        scopeKey: "EVENT",
        grantedByUserId: owner.userId,
      },
    });
    const registrations = [];
    for (const userId of [participant.userId, (await actor()).userId]) {
      const registration = await db.registration.create({
        data: { eventId: event.id, userId },
      });
      const credential = await db.qRCredential.create({
        data: {
          registrationId: registration.id,
          ...issueCredential(registration.id, config.contactKey),
        },
      });
      registrations.push({
        registration,
        credential,
        token: recoverCredential(
          registration.id,
          credential.protectedRepresentation!,
          config.contactKey,
        ),
      });
    }
    return {
      owner,
      admin,
      operator,
      volunteer,
      participant,
      event,
      gate,
      adminAssignment,
      registrations,
    };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function read(f: Fixture, who = f.owner, id = f.event.id) {
    return request(app)
      .get(`/api/v1/events/${id}/operations`)
      .set("Cookie", who.cookie);
  }
  function scan(
    f: Fixture,
    index = 0,
    scanId = randomUUID(),
    gateId = f.gate.id,
  ) {
    return request(app)
      .post("/api/v1/scan-decisions")
      .set("Cookie", f.operator.cookie)
      .set("Origin", origin)
      .set("X-CSRF-Token", f.operator.csrf)
      .set("Idempotency-Key", scanId)
      .send({
        scan_id: scanId,
        event_id: f.event.id,
        gate_id: gateId,
        credential: f.registrations[index].token,
      });
  }
  async function waitForLock() {
    for (let i = 0; i < 100; i++) {
      const rows = await db.$queryRaw<
        { waiting: boolean }[]
      >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock') AS waiting`;
      if (rows[0].waiting) return;
      await new Promise((done) => setTimeout(done, 10));
    }
    throw new Error("Expected a waiting event reader");
  }
  it("returns an explicit aggregate allowlist for owner and assigned Admin without audit mutation", async () => {
    const f = await fixture(),
      correlationIds: string[] = [];
    for (const who of [f.owner, f.admin]) {
      const response = await read(f, who);
      expect(response.status).toBe(200);
      correlationIds.push(response.body.correlation_id);
      expect(response.body).toEqual({
        event_id: f.event.id,
        event_name: f.event.name,
        event_state: "LIVE",
        occupied: 0,
        registered: 2,
        capacity: 1,
        remaining: 1,
        utilization_percentage: 0,
        attendance_state: "INSIDE",
        last_attendance_at: null,
        calculated_at: expect.any(String),
        correlation_id: expect.any(String),
        revision: 0,
        as_of: expect.any(String),
      });
      expect(response.headers["cache-control"]).toContain("no-store");
      expect(response.body.as_of).toBe(response.body.calculated_at);
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      expect(JSON.stringify(response.body)).not.toContain(
        f.registrations[0].token,
      );
      expect(JSON.stringify(response.body)).not.toContain(f.participant.userId);
    }
    // Other feature suites legitimately write audit rows in this shared database.
    expect(
      await db.auditEvent.count({
        where: { correlationId: { in: correlationIds } },
      }),
    ).toBe(0);
  });
  it.each(["operator", "volunteer", "participant", "foreign"] as const)(
    "hides event existence from %s",
    async (role) => {
      const f = await fixture(),
        who = role === "foreign" ? await actor(true) : f[role];
      for (const id of [f.event.id, randomUUID(), "malformed"]) {
        const result = await read(f, who, id);
        expect(result.status).toBe(404);
        expect(result.body.code).toBe("EVENT_NOT_FOUND");
        expect(JSON.stringify(result.body)).not.toContain(f.event.name);
        const audit = await db.auditEvent.findFirstOrThrow({
          where: {
            correlationId: result.body.correlation_id,
            action: "OPERATIONS_READ_DENIED",
          },
        });
        expect(audit.eventId).toBeNull();
      }
    },
  );
  it("requires an account, not an anonymous or guest proof", async () => {
    const f = await fixture();
    expect(
      (await request(app).get(`/api/v1/events/${f.event.id}/operations`))
        .status,
    ).toBe(401);
    const guest = await db.guestIdentity.create({
      data: { lookupHash: randomUUID().replaceAll("-", "").repeat(2) },
    });
    expect(
      (
        await request(app)
          .get(`/api/v1/events/${f.event.id}/operations`)
          .set(
            "Cookie",
            "eoc_guest=" +
              (await signGuestProof(
                guest.lookupHash,
                "GUEST_REGISTRATION",
                f.event.id,
                config.jwtSecret,
              )),
          )
      ).status,
    ).toBe(401);
  });
  it("rejects query/body mutation attempts and has no operations writer", async () => {
    const f = await fixture();
    expect((await read(f).query({ occupied: 20 })).status).toBe(400);
    expect((await read(f).send({ occupied: 20 })).status).toBe(400);
    expect(
      (
        await request(app)
          .post(`/api/v1/events/${f.event.id}/operations`)
          .set("Cookie", f.owner.cookie)
          .send({ occupied: 20 })
      ).status,
    ).toBe(404);
    expect((await read(f)).body.occupied).toBe(0);
  });
  it("counts committed check-ins once despite duplicate and replay requests", async () => {
    const f = await fixture(),
      id = randomUUID(),
      first = await scan(f, 0, id);
    expect(first.body.decision).toBe("ACCEPTED");
    expect((await scan(f, 0, id)).body.replayed).toBe(true);
    expect((await scan(f)).body.reason).toBe("ALREADY_CHECKED_IN");
    const result = await read(f);
    expect(result.body).toMatchObject({
      occupied: 1,
      revision: 1,
      registered: 2,
      remaining: 0,
      utilization_percentage: 100,
      last_attendance_at: first.body.decided_at,
    });
    expect(
      await db.attendanceTransition.count({ where: { eventId: f.event.id } }),
    ).toBe(1);
    expect(
      (await db.event.findUniqueOrThrow({ where: { id: f.event.id } }))
        .revision,
    ).toBe(1);
  });
  it("accepts concurrent valid check-ins at different gates above registration capacity without lost attendance", async () => {
    const f = await fixture(),
      gate = await db.gate.create({ data: { eventId: f.event.id } });
    await db.eventRoleAssignment.create({
      data: {
        eventId: f.event.id,
        userId: f.operator.userId,
        role: "GATE_SECURITY",
        gateId: gate.id,
        scopeKey: gate.id,
        grantedByUserId: f.owner.userId,
      },
    });
    const responses = await Promise.all([
      scan(f),
      scan(f, 1, randomUUID(), gate.id),
    ]);
    expect(responses.map((r) => r.body.decision)).toEqual([
      "ACCEPTED",
      "ACCEPTED",
    ]);
    expect((await read(f)).body).toMatchObject({
      occupied: 2,
      revision: 2,
      registered: 2,
      capacity: 1,
      remaining: -1,
      utilization_percentage: 200,
    });
    expect(
      await db.attendanceTransition.count({ where: { eventId: f.event.id } }),
    ).toBe(2);
    expect(
      await db.auditEvent.count({
        where: {
          eventId: f.event.id,
          action: "SCAN_CHECK_IN",
          outcome: "ACCEPTED",
        },
      }),
    ).toBe(2);
  });
  it("preserves Published cap reductions below active registrations and subsequent admission", async () => {
    const f = await fixture();
    await db.event.update({
      where: { id: f.event.id },
      data: { state: "PUBLISHED", registrationCapacity: 2 },
    });
    const edit = await request(app)
      .patch(`/api/v1/events/${f.event.id}`)
      .set("Cookie", f.owner.cookie)
      .set("Origin", origin)
      .set("X-CSRF-Token", f.owner.csrf)
      .set("If-Match", '"1"')
      .send({ registration_capacity: 1 });
    expect(edit.status).toBe(200);
    expect(
      await db.registration.count({
        where: { eventId: f.event.id, state: "REGISTERED" },
      }),
    ).toBe(2);
    await db.event.update({
      where: { id: f.event.id },
      data: { state: "LIVE" },
    });
    for (const i of [0, 1])
      expect((await scan(f, i)).body.decision).toBe("ACCEPTED");
    expect((await read(f)).body).toMatchObject({
      occupied: 2,
      remaining: -1,
      utilization_percentage: 200,
    });
  });
  it("counts the ledger, not the first-check-in marker or cancelled registrations", async () => {
    const f = await fixture();
    await db.registration.update({
      where: { id: f.registrations[0].registration.id },
      data: { firstAcceptedCheckInAt: new Date() },
    });
    await db.registration.update({
      where: { id: f.registrations[1].registration.id },
      data: {
        state: "CANCELLED",
        cancelledAt: new Date(),
        cancelledByUserId: f.participant.userId,
        cancelledActorKind: "ACCOUNT",
      },
    });
    expect((await read(f)).body).toMatchObject({
      occupied: 0,
      registered: 1,
      last_attendance_at: null,
    });
  });
  it.each(["COMPLETED", "CANCELLED"] as const)(
    "retains factual attendance after %s",
    async (state) => {
      const f = await fixture();
      await scan(f);
      await db.event.update({ where: { id: f.event.id }, data: { state } });
      expect((await read(f)).body).toMatchObject({
        event_state: state,
        occupied: 1,
        registered: 2,
      });
    },
  );
  it("preserves legacy unset capacity as unavailable metrics", async () => {
    const f = await fixture();
    await db.event.update({
      where: { id: f.event.id },
      data: { state: "DRAFT", registrationCapacity: null },
    });
    expect((await read(f)).body).toMatchObject({
      capacity: null,
      remaining: null,
      utilization_percentage: null,
    });
  });
  it.each(["assignment", "session", "capability"] as const)(
    "rechecks current %s after waiting for event lock",
    async (variant) => {
      const f = await fixture(),
        who = variant === "assignment" ? f.admin : f.owner;
      let release!: () => void, acquired!: () => void;
      const barrier = new Promise<void>((done) => {
          release = done;
        }),
        ready = new Promise<void>((done) => {
          acquired = done;
        });
      const blocker = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Event" WHERE id=${f.event.id}::uuid FOR UPDATE`;
        if (variant === "assignment")
          await tx.eventRoleAssignment.update({
            where: { id: f.adminAssignment.id },
            data: { revokedAt: new Date(), revokedByUserId: f.owner.userId },
          });
        if (variant === "session")
          await tx.session.update({
            where: { id: who.sessionId },
            data: { revokedAt: new Date() },
          });
        if (variant === "capability")
          await tx.user.update({
            where: { id: who.userId },
            data: { organizerCapable: false },
          });
        acquired();
        await barrier;
      });
      await ready;
      const outcome = operationsSnapshot(
        deps,
        who,
        f.event.id,
        randomUUID(),
      ).then(
        () => null,
        (error) => error,
      );
      try {
        await waitForLock();
      } finally {
        release();
        await blocker;
      }
      expect(await outcome).toMatchObject({
        status: variant === "session" ? 401 : 404,
      });
    },
  );
  it.each([false, true])(
    "reads only committed attendance when an in-flight transaction rolls back=%s",
    async (rollback) => {
      const f = await fixture();
      const socket = await client(f.owner.cookie);
      expect(await subscribe(socket, f.event.id)).toMatchObject({
        ok: true,
        revision: 0,
      });
      const notifications: { revision: number }[] = [];
      socket.on("occupancy.updated", (message) => notifications.push(message));
      let release!: () => void, acquired!: () => void;
      const barrier = new Promise<void>((done) => {
          release = done;
        }),
        ready = new Promise<void>((done) => {
          acquired = done;
        });
      const writing = db
        .$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Event" WHERE id=${f.event.id}::uuid FOR UPDATE`;
          const decidedAt = new Date();
          const scan = await tx.scanDecision.create({
            data: {
              scanId: randomUUID(),
              eventId: f.event.id,
              gateId: f.gate.id,
              operatorUserId: f.operator.userId,
              registrationId: f.registrations[0].registration.id,
              credentialId: f.registrations[0].credential.id,
              decision: "ACCEPTED",
              reason: "ACCEPTED",
              decidedAt,
              correlationId: randomUUID(),
            },
          });
          await tx.attendanceTransition.create({
            data: {
              eventId: f.event.id,
              gateId: f.gate.id,
              operatorUserId: f.operator.userId,
              registrationId: f.registrations[0].registration.id,
              scanDecisionId: scan.id,
              acceptedAt: decidedAt,
            },
          });
          await tx.auditEvent.create({
            data: {
              actorKind: "ACCOUNT",
              actorUserId: f.operator.userId,
              eventId: f.event.id,
              action: "SCAN_CHECK_IN",
              outcome: "ACCEPTED",
              correlationId: scan.correlationId,
            },
          });
          acquired();
          await barrier;
          if (rollback) throw new Error("rollback");
        })
        .catch((error) => {
          if (!rollback) throw error;
        });
      await ready;
      const reading = operationsSnapshot(
        deps,
        f.owner,
        f.event.id,
        randomUUID(),
      );
      try {
        await waitForLock();
        expect(notifications).toHaveLength(0);
      } finally {
        release();
        await writing;
      }
      const snapshot = await reading;
      expect(snapshot.occupied).toBe(rollback ? 0 : 1);
      expect(snapshot.revision).toBe(rollback ? 0 : 1);
      expect(snapshot.as_of).toBe(snapshot.calculated_at);
      if (rollback) {
        await new Promise((done) => setTimeout(done, 100));
        expect(notifications).toHaveLength(0);
      } else {
        await expect.poll(() => notifications.at(-1)?.revision).toBe(1);
      }
      socket.disconnect();
    },
  );
  it.each(["scan", "read"])(
    "fails closed for required %s audit failure without changing occupancy",
    async (variant) => {
      const f = await fixture(),
        corr = randomUUID();
      await db.$executeRawUnsafe(
        `CREATE FUNCTION slice6_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."correlationId" = '${corr}' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END $$`,
      );
      await db.$executeRawUnsafe(
        'CREATE TRIGGER slice6_fail_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION slice6_fail_audit()',
      );
      try {
        const result = await (
          variant === "scan" ? scan(f) : read(f, f.operator)
        ).set("X-Correlation-Id", corr);
        expect(result.status).toBe(503);
        expect((await read(f)).body).toMatchObject({
          occupied: 0,
          revision: 0,
        });
        expect(
          await db.attendanceTransition.count({
            where: { eventId: f.event.id },
          }),
        ).toBe(0);
      } finally {
        await db.$executeRawUnsafe(
          'DROP TRIGGER slice6_fail_audit ON "AuditEvent"',
        );
        await db.$executeRawUnsafe("DROP FUNCTION slice6_fail_audit()");
      }
    },
  );
  it("never discloses occupancy through public discovery or bearer detail", async () => {
    const f = await fixture();
    await scan(f);
    await db.event.update({
      where: { id: f.event.id },
      data: { state: "PUBLISHED", visibility: "PUBLIC" },
    });
    const detail = await request(app).get(
        `/api/v1/discovery/events/${f.event.id}`,
      ),
      catalog = await request(app).get("/api/v1/discovery/events");
    expect(detail.status).toBe(200);
    expect(catalog.status).toBe(200);
    await db.event.update({
      where: { id: f.event.id },
      data: { visibility: "PRIVATE" },
    });
    const issued = await request(app)
      .post(`/api/v1/events/${f.event.id}/private-link`)
      .set("Cookie", f.owner.cookie)
      .set("Origin", origin)
      .set("X-CSRF-Token", f.owner.csrf)
      .set("If-Match", '"1"')
      .set("Idempotency-Key", randomUUID())
      .send({});
    expect(issued.status).toBe(201);
    const proof = new URL(issued.body.access_url as string).hash.slice(
      "#access=".length,
    );
    const privateDetail = await request(app)
      .get("/api/v1/discovery/private")
      .set("Authorization", `PrivateLink ${proof}`);
    expect(privateDetail.status).toBe(200);
    for (const response of [detail, catalog, privateDetail])
      for (const key of [
        "occupied",
        "utilization_percentage",
        "last_attendance_at",
        "calculated_at",
        "registered",
      ])
        expect(JSON.stringify(response.body)).not.toContain('"' + key + '"');
  });
  it("does not advance revision for an invalid rejected check-in", async () => {
    const f = await fixture();
    const response = await scan(f).send({ credential: "invalid" });
    expect(response.body.reason).toBe("INVALID_CREDENTIAL");
    expect((await read(f)).body).toMatchObject({ occupied: 0, revision: 0 });
  });
  it("authenticates socket Origin and account session before any event subscription", async () => {
    const f = await fixture();
    await expect(client()).rejects.toThrow();
    await expect(
      client(f.owner.cookie, "https://untrusted.example"),
    ).rejects.toThrow();
    await db.session.update({
      where: { id: f.owner.sessionId },
      data: { revokedAt: new Date() },
    });
    await expect(client(f.owner.cookie)).rejects.toThrow();
  });
  it("allows only current owner/Admin subscriptions and hides unauthorized event facts", async () => {
    const f = await fixture();
    for (const who of [f.owner, f.admin]) {
      const socket = await client(who.cookie);
      expect(await subscribe(socket, f.event.id)).toMatchObject({
        ok: true,
        event_id: f.event.id,
        revision: 0,
        as_of: expect.any(String),
      });
      socket.disconnect();
    }
    for (const who of [
      f.operator,
      f.volunteer,
      f.participant,
      await actor(true),
    ]) {
      const socket = await client(who.cookie);
      expect(await subscribe(socket, f.event.id)).toEqual({
        ok: false,
        code: "EVENT_NOT_FOUND",
      });
      expect(await subscribe(socket, randomUUID())).toEqual({
        ok: false,
        code: "EVENT_NOT_FOUND",
      });
      expect(
        await socket.timeout(3000).emitWithAck("operations.subscribe", {
          event_id: f.event.id,
          role: "EVENT_ADMIN",
        }),
      ).toEqual({ ok: false, code: "VALIDATION" });
      socket.disconnect();
    }
  });
  it("delivers committed versioned metadata with event isolation and reconnect resync", async () => {
    const f = await fixture(),
      other = await fixture();
    const a = await client(f.owner.cookie),
      b = await client(other.owner.cookie);
    await subscribe(a, f.event.id);
    await subscribe(b, other.event.id);
    const messages: { revision: number; event_id: string }[] = [],
      foreign: unknown[] = [];
    a.on("occupancy.updated", (message) => messages.push(message));
    b.on("occupancy.updated", (message) => foreign.push(message));
    await scan(f);
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toEqual({
      message_id: "operations:" + f.event.id + ":1",
      schema_version: 1,
      event_id: f.event.id,
      revision: 1,
      as_of: expect.any(String),
      occurred_at: expect.any(String),
      correlation_id: expect.any(String),
    });
    await scan(f); // duplicate cannot publish another occupancy revision
    await new Promise((done) => setTimeout(done, 100));
    expect(messages).toHaveLength(1);
    expect(foreign).toHaveLength(0);
    a.disconnect();
    await scan(f, 1);
    const reconnect = await client(f.owner.cookie);
    expect(await subscribe(reconnect, f.event.id)).toMatchObject({
      ok: true,
      revision: 2,
    });
    expect((await read(f)).body).toMatchObject({ occupied: 2, revision: 2 });
    reconnect.disconnect();
    b.disconnect();
  });
  it.each(["assignment", "session", "capability"])(
    "terminates subscriptions when current %s authority is revoked",
    async (variant) => {
      const f = await fixture(),
        who = variant === "assignment" ? f.admin : f.owner;
      const socket = await client(who.cookie);
      await subscribe(socket, f.event.id);
      const closed = new Promise<void>((done) =>
        socket.once("disconnect", () => done()),
      );
      if (variant === "assignment")
        await db.eventRoleAssignment.update({
          where: { id: f.adminAssignment.id },
          data: { revokedAt: new Date(), revokedByUserId: f.owner.userId },
        });
      if (variant === "session")
        await db.session.update({
          where: { id: who.sessionId },
          data: { expiresAt: new Date() },
        });
      if (variant === "capability")
        await db.user.update({
          where: { id: who.userId },
          data: { organizerCapable: false },
        });
      await closed;
      expect(socket.connected).toBe(false);
    },
  );
  it("clears an old subscription before a denied context switch", async () => {
    const f = await fixture(),
      socket = await client(f.owner.cookie);
    await subscribe(socket, f.event.id);
    const messages: unknown[] = [];
    socket.on("occupancy.updated", (message) => messages.push(message));
    expect(await subscribe(socket, randomUUID())).toEqual({
      ok: false,
      code: "EVENT_NOT_FOUND",
    });
    await scan(f);
    await new Promise((done) => setTimeout(done, 100));
    expect(messages).toHaveLength(0);
    socket.disconnect();
  });
});
