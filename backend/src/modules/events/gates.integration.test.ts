import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createDatabase } from "../../config/database.js";
import type { FoundationConfig } from "../../config/foundation.js";
import { createLogger } from "../../config/logger.js";
import { OtpService } from "../auth/otp.js";
import { csrfToken, signAccountToken } from "../auth/tokens.js";
import { createEventGate } from "./gates.js";
import { lockEventForCommand } from "./private-links.js";
import { executeIdempotentCommand } from "./command-safety.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = "http://127.0.0.1:5173";
describe.skipIf(!databaseUrl)("V5 Gate configuration (PostgreSQL)", () => {
  const db = createDatabase(databaseUrl ?? "");
  const config: FoundationConfig = {
    databaseUrl: databaseUrl ?? "",
    jwtSecret: new Uint8Array(Buffer.alloc(32, 9)),
    contactKey: Buffer.alloc(32, 10),
    otpKey: Buffer.alloc(32, 11),
    cookieSecure: false,
  };
  const deps = {
    db,
    config,
    frontendOrigin: origin,
    otp: new OtpService(db, config, {
      available: () => false,
      async send() {},
    }),
  };
  const app = createApp(
    { port: 3000, frontendOrigin: origin },
    createLogger(
      new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      }),
    ),
    deps,
  );
  async function actor(organizerCapable = false) {
    const user = await db.user.create({ data: { organizerCapable } });
    const session = await db.session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 300_000) },
    });
    return {
      id: user.id,
      sessionId: session.id,
      cookie: `eoc_session=${await signAccountToken(user.id, session.id, config.jwtSecret)}`,
      csrf: csrfToken(session.id, config.jwtSecret),
    };
  }
  async function fixture() {
    const owner = await actor(true),
      admin = await actor();
    const event = await db.event.create({
      data: { ownerUserId: owner.id, name: "Gate event" },
    });
    const assignment = await db.eventRoleAssignment.create({
      data: {
        eventId: event.id,
        userId: admin.id,
        role: "EVENT_ADMIN",
        scopeKey: "EVENT",
        grantedByUserId: owner.id,
      },
    });
    return { owner, admin, event, assignment };
  }
  function create(
    account: Awaited<ReturnType<typeof actor>>,
    eventId: string,
    revision = 1,
    key = randomUUID(),
    body: unknown = {},
  ) {
    return request(app)
      .post(`/api/v1/events/${eventId}/gates`)
      .set("Cookie", account.cookie)
      .set("Origin", origin)
      .set("X-CSRF-Token", account.csrf)
      .set("If-Match", `"${revision}"`)
      .set("Idempotency-Key", key)
      .send(body as object);
  }
  function read(account: Awaited<ReturnType<typeof actor>>, eventId: string) {
    return request(app)
      .get(`/api/v1/events/${eventId}`)
      .set("Cookie", account.cookie);
  }
  afterAll(async () => {
    await db.$disconnect();
  });

  it("persists an owner-created Gate, advances revision and derives readiness solely from association", async () => {
    const { owner, event } = await fixture();
    const missing = await read(owner, event.id);
    expect(missing.body.readiness).toMatchObject({
      configured_gate_present: false,
      publish_blockers: expect.arrayContaining(["CONFIGURED_GATE_REQUIRED"]),
      live_blockers: ["CONFIGURED_GATE_REQUIRED"],
    });
    const response = await create(owner, event.id);
    expect(response.status).toBe(201);
    expect(Object.keys(response.body).sort()).toEqual(
      [
        "gate_id",
        "event_id",
        "readiness",
        "revision",
        "as_of",
        "correlation_id",
      ].sort(),
    );
    expect(response.body).toMatchObject({
      event_id: event.id,
      revision: 2,
      readiness: {
        configured_gate_present: true,
        publish_blockers: [
          "VISIBILITY_REQUIRED",
          "SCHEDULE_REQUIRED",
          "TIME_ZONE_REQUIRED",
          "REGISTRATION_CAPACITY_REQUIRED",
        ],
        live_blockers: [],
      },
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(
      await db.gate.findUniqueOrThrow({ where: { id: response.body.gate_id } }),
    ).toMatchObject({ eventId: event.id });
    expect(
      await db.eventRoleAssignment.count({
        where: { gateId: response.body.gate_id },
      }),
    ).toBe(0);
    expect((await read(owner, event.id)).body).toMatchObject({
      gates: [{ gate_id: response.body.gate_id, event_id: event.id }],
      revision: 2,
      state: "DRAFT",
      readiness: response.body.readiness,
    });
    expect(
      await db.auditEvent.findFirstOrThrow({
        where: { eventId: event.id, action: "GATE_CREATED" },
      }),
    ).toMatchObject({
      actorUserId: owner.id,
      outcome: "ACCEPTED",
      correlationId: response.body.correlation_id,
      metadata: {
        gate_id: response.body.gate_id,
        previous_revision: 1,
        revision: 2,
      },
    });
  });
  it("allows assigned Event Admin to configure a Published event without granting lifecycle or broader configuration authority", async () => {
    const { owner, admin, event } = await fixture();
    await db.event.update({
      where: { id: event.id },
      data: {
        state: "PUBLISHED",
        visibility: "PUBLIC",
        startAt: new Date("2030-01-01T10:00:00Z"),
        endAt: new Date("2030-01-01T12:00:00Z"),
        timeZone: "UTC",
        registrationCapacity: 100,
      },
    });
    const response = await create(admin, event.id);
    expect(response.status).toBe(201);
    expect(response.body.readiness).toEqual({
      configured_gate_present: true,
      publish_blockers: [],
      live_blockers: [],
    });
    const detail = await read(admin, event.id);
    expect(detail.body.state).toBe("PUBLISHED");
    expect(detail.body.permitted_actions).toEqual([
      "EDIT_EVENT",
      "CREATE_GATE",
    ]);
    expect(
      (
        await request(app)
          .patch(`/api/v1/events/${event.id}`)
          .set("Cookie", admin.cookie)
          .set("Origin", origin)
          .set("X-CSRF-Token", admin.csrf)
          .set("If-Match", '"2"')
          .send({ registration_capacity: 200 })
      ).status,
    ).toBe(403);
    expect(
      (await db.event.findUniqueOrThrow({ where: { id: event.id } }))
        .ownerUserId,
    ).toBe(owner.id);
  });
  it("conceals cross-event scope and denies participants, Volunteers and Gate/Security staff with audited denials", async () => {
    const { owner, admin, event } = await fixture();
    const stranger = await actor(true),
      participant = await actor(),
      volunteer = await actor(),
      security = await actor();
    const gate = await db.gate.create({ data: { eventId: event.id } });
    await db.eventRoleAssignment.create({
      data: {
        eventId: event.id,
        userId: volunteer.id,
        role: "VOLUNTEER",
        scopeKey: "EVENT",
        grantedByUserId: owner.id,
      },
    });
    await db.eventRoleAssignment.create({
      data: {
        eventId: event.id,
        userId: security.id,
        role: "GATE_SECURITY",
        gateId: gate.id,
        scopeKey: gate.id,
        grantedByUserId: owner.id,
      },
    });
    const other = await db.event.create({
      data: { ownerUserId: stranger.id, name: "Hidden" },
    });
    for (const [account, id] of [
      [stranger, event.id],
      [participant, event.id],
      [volunteer, event.id],
      [security, event.id],
      [owner, other.id],
      [admin, other.id],
    ] as const) {
      const response = await create(account, id);
      expect(response.status).toBe(404);
      expect(response.body.code).toBe("EVENT_NOT_FOUND");
      expect(response.body).not.toHaveProperty("revision");
      expect(
        await db.auditEvent.findFirstOrThrow({
          where: {
            actorUserId: account.id,
            correlationId: response.body.correlation_id,
          },
        }),
      ).toMatchObject({
        action: "EVENT_ACTION_DENIED",
        outcome: "DENIED",
        eventId: null,
        metadata: null,
      });
    }
    for (const id of [randomUUID(), "malformed"])
      expect((await create(owner, id)).status).toBe(404);
    expect(await db.gate.count({ where: { eventId: event.id } })).toBe(1);
  });
  it("requires session, CSRF, exact empty body, idempotency key and quoted revision", async () => {
    const { owner, event } = await fixture();
    expect(
      (await request(app).post(`/api/v1/events/${event.id}/gates`).send({}))
        .status,
    ).toBe(401);
    expect(
      (await create(owner, event.id).set("X-CSRF-Token", "invalid")).status,
    ).toBe(403);
    expect(
      (await create(owner, event.id).set("Origin", "https://other.example"))
        .status,
    ).toBe(403);
    for (const body of [
      { name: "invented" },
      { event_id: event.id },
      { scanner_ready: true },
      [],
      "invalid",
    ])
      expect(
        (await create(owner, event.id, 1, randomUUID(), body)).status,
      ).toBe(400);
    for (const key of ["", "short", "x".repeat(201)])
      expect(
        (await create(owner, event.id).set("Idempotency-Key", key)).status,
      ).toBe(400);
    for (const revision of ["", "1", 'W/"1"', '"0"'])
      expect(
        (await create(owner, event.id).set("If-Match", revision)).status,
      ).toBe(400);
    expect(
      (await db.event.findUniqueOrThrow({ where: { id: event.id } })).revision,
    ).toBe(1);
    expect(await db.gate.count({ where: { eventId: event.id } })).toBe(0);
  });
  it.each(["LIVE", "COMPLETED", "CANCELLED"] as const)(
    "rejects new gate configuration in %s for both authorized roles",
    async (state) => {
      const { owner, admin, event } = await fixture();
      await db.event.update({ where: { id: event.id }, data: { state } });
      for (const account of [owner, admin]) {
        const response = await create(account, event.id);
        expect(response.status).toBe(422);
        expect(response.body.code).toBe("WRONG_LIFECYCLE_STATE");
      }
      expect(await db.gate.count({ where: { eventId: event.id } })).toBe(0);
    },
  );
  it("settles concurrent same-key creation once, replaying the exact original result before stale revision/state", async () => {
    const { admin, event } = await fixture();
    const key = randomUUID();
    const responses = await Promise.all([
      create(admin, event.id, 1, key),
      create(admin, event.id, 1, key),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(responses[0].body).toEqual(responses[1].body);
    const canonicalReplay = await create(admin, event.id.toUpperCase(), 1, key);
    expect(canonicalReplay.status).toBe(201);
    expect(canonicalReplay.body).toEqual(responses[0].body);
    await db.event.update({
      where: { id: event.id },
      data: { revision: { increment: 1 }, state: "LIVE" },
    });
    const replay = await create(admin, event.id, 1, key);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(responses[0].body);
    expect(await db.gate.count({ where: { eventId: event.id } })).toBe(1);
    expect(
      await db.auditEvent.count({
        where: { eventId: event.id, action: "GATE_CREATED" },
      }),
    ).toBe(1);
  });
  it("conflicts different-key commands at the same revision but allows another gate with a fresh revision", async () => {
    const { owner, event } = await fixture();
    const responses = await Promise.all([
      create(owner, event.id),
      create(owner, event.id),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    expect(
      responses.find((response) => response.status === 409)!.body,
    ).toMatchObject({
      code: "VERSION_CONFLICT",
      details: { current_revision: 2 },
    });
    expect((await create(owner, event.id, 2)).status).toBe(201);
    expect(await db.gate.count({ where: { eventId: event.id } })).toBe(2);
  });
  it("scopes the same replay key to actor, action and event and detects a mismatched fingerprint", async () => {
    const { owner, event } = await fixture();
    const other = await db.event.create({
      data: { ownerUserId: owner.id, name: "Other owned" },
    });
    const key = randomUUID();
    expect((await create(owner, event.id, 1, key)).status).toBe(201);
    expect((await create(owner, other.id, 1, key)).status).toBe(201);
    const mismatchKey = randomUUID();
    await executeIdempotentCommand(
      db,
      {
        actorUserId: owner.id,
        action: "GATE_CREATE",
        resourceKey: event.id,
        idempotencyKey: mismatchKey,
        request: { incompatible: "fixture" },
      },
      async () => ({ status: 201, body: { fixture: true } }),
    );
    const conflict = await create(owner, event.id, 2, mismatchKey);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(await db.gate.count({ where: { eventId: event.id } })).toBe(1);
  });
  it.each(["assignment", "capability", "session"] as const)(
    "refuses original replay after %s revocation",
    async (authority) => {
      const { owner, admin, event, assignment } = await fixture();
      const account = authority === "assignment" ? admin : owner,
        key = randomUUID();
      expect((await create(account, event.id, 1, key)).status).toBe(201);
      if (authority === "assignment")
        await db.eventRoleAssignment.update({
          where: { id: assignment.id },
          data: { revokedAt: new Date(), revokedByUserId: owner.id },
        });
      else if (authority === "capability")
        await db.user.update({
          where: { id: owner.id },
          data: { organizerCapable: false },
        });
      else
        await db.session.update({
          where: { id: owner.sessionId },
          data: { revokedAt: new Date() },
        });
      expect((await create(account, event.id, 1, key)).status).toBe(
        authority === "session" ? 401 : 404,
      );
      expect(await db.gate.count({ where: { eventId: event.id } })).toBe(1);
    },
  );
  it("rechecks authenticated Admin scope while a gate command waits for the event lock", async () => {
    const { owner, admin, event, assignment } = await fixture();
    let release!: () => void, locked!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const held = db.$transaction(async (tx) => {
      await lockEventForCommand(tx, event.id);
      locked();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await ready;
    const denied = expect(
      createEventGate(
        deps,
        { userId: admin.id, sessionId: admin.sessionId },
        event.id,
        1,
        randomUUID(),
        {},
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 404 });
    try {
      await db.eventRoleAssignment.update({
        where: { id: assignment.id },
        data: { revokedAt: new Date(), revokedByUserId: owner.id },
      });
    } finally {
      release();
      await held;
    }
    await denied;
    expect(await db.gate.count({ where: { eventId: event.id } })).toBe(0);
  });
  it("rolls back gate/revision/replay on audit failure and fails closed if denial audit fails", async () => {
    const { owner, event } = await fixture();
    const suffix = randomUUID().replaceAll("-", ""),
      functionName = `v5_reject_audit_${suffix}`,
      triggerName = `v5_audit_failure_${suffix}`,
      key = randomUUID();
    await db.$executeRawUnsafe(
      `CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."correlationId" = 'v5-force-audit-failure' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END; $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`,
    );
    try {
      const response = await create(owner, event.id, 1, key).set(
        "X-Correlation-ID",
        "v5-force-audit-failure",
      );
      expect(response.status).toBe(503);
      expect(response.body.code).toBe("DEPENDENCY_UNAVAILABLE");
      expect(await db.gate.count({ where: { eventId: event.id } })).toBe(0);
      expect(
        (await db.event.findUniqueOrThrow({ where: { id: event.id } }))
          .revision,
      ).toBe(1);
      expect(
        await db.commandReplay.count({
          where: {
            actorUserId: owner.id,
            action: "GATE_CREATE",
            resourceKey: event.id,
          },
        }),
      ).toBe(0);
      const participant = await actor();
      expect(
        (
          await create(participant, event.id).set(
            "X-Correlation-ID",
            "v5-force-audit-failure",
          )
        ).status,
      ).toBe(503);
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER "${triggerName}" ON "AuditEvent"`,
      );
      await db.$executeRawUnsafe(`DROP FUNCTION "${functionName}"()`);
    }
    expect((await create(owner, event.id, 1, key)).status).toBe(201);
  });
});
