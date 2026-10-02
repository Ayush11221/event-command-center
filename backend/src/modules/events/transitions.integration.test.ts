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
import { lockEventForCommand } from "./private-links.js";
import { transitionEvent } from "./transitions.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = "http://127.0.0.1:5173";
describe.skipIf(!databaseUrl)("V6 lifecycle commands (PostgreSQL)", () => {
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
  async function fixture(
    state: "DRAFT" | "PUBLISHED" | "LIVE" | "COMPLETED" | "CANCELLED" = "DRAFT",
    withGate = true,
  ) {
    const owner = await actor(true),
      admin = await actor();
    const event = await db.event.create({
      data: {
        ownerUserId: owner.id,
        name: "Lifecycle event",
        state,
        visibility: "PRIVATE",
        startAt: new Date("2030-01-01T10:00:00Z"),
        endAt: new Date("2030-01-01T12:00:00Z"),
        timeZone: "Asia/Kolkata",
        registrationCapacity: 100,
        registrationClosesAt: new Date("2030-01-01T14:00:00Z"),
      },
    });
    const gate = withGate
      ? await db.gate.create({ data: { eventId: event.id } })
      : null;
    await db.eventRoleAssignment.create({
      data: {
        eventId: event.id,
        userId: admin.id,
        role: "EVENT_ADMIN",
        scopeKey: "EVENT",
        grantedByUserId: owner.id,
      },
    });
    return { owner, admin, event, gate };
  }
  function change(
    account: Awaited<ReturnType<typeof actor>>,
    eventId: string,
    target_state = "PUBLISHED",
    revision = 1,
    key = randomUUID(),
    extra: object = {},
    rawBody?: object,
  ) {
    return request(app)
      .post(`/api/v1/events/${eventId}/transitions`)
      .set("Cookie", account.cookie)
      .set("Origin", origin)
      .set("X-CSRF-Token", account.csrf)
      .set("If-Match", `"${revision}"`)
      .set("Idempotency-Key", key)
      .send(rawBody ?? { target_state, ...extra });
  }
  function read(account: Awaited<ReturnType<typeof actor>>, eventId: string) {
    return request(app)
      .get(`/api/v1/events/${eventId}`)
      .set("Cookie", account.cookie);
  }
  afterAll(async () => {
    await db.$disconnect();
  });

  it("publishes, starts, and completes with exact response schema, timestamps, revisions and audits", async () => {
    const { owner, admin, event } = await fixture();
    expect((await read(owner, event.id)).body.permitted_actions).toContain(
      "PUBLISH",
    );
    let previous = "DRAFT";
    for (const [index, state] of ["PUBLISHED", "LIVE", "COMPLETED"].entries()) {
      const response = await change(owner, event.id, state, index + 1);
      expect(response.status).toBe(200);
      expect(Object.keys(response.body).sort()).toEqual(
        [
          "event_id",
          "previous_state",
          "state",
          "revision",
          "readiness",
          "availability",
          "as_of",
          "correlation_id",
        ].sort(),
      );
      expect(response.body).toMatchObject({
        event_id: event.id,
        previous_state: previous,
        state,
        revision: index + 2,
        readiness: { configured_gate_present: true },
        availability: {
          policy_status: "OPEN",
          reasons: [],
          closes_at: event.registrationClosesAt!.toISOString(),
        },
      });
      expect(response.headers["cache-control"]).toBe("no-store");
      const current = await db.event.findUniqueOrThrow({
        where: { id: event.id },
      });
      expect(current.publishedAt).not.toBeNull();
      expect(current.registrationClosesAt).toEqual(event.registrationClosesAt);
      const audit = await db.auditEvent.findFirstOrThrow({
        where: {
          eventId: event.id,
          correlationId: response.body.correlation_id,
        },
      });
      expect(audit).toMatchObject({
        actorUserId: owner.id,
        action: "EVENT_TRANSITIONED",
        outcome: "ACCEPTED",
        metadata: {
          previous_state: previous,
          state,
          previous_revision: index + 1,
          revision: index + 2,
          transitioned_at: response.body.as_of,
        },
      });
      expect((await read(admin, event.id)).body.permitted_actions).not.toEqual(
        expect.arrayContaining(["PUBLISH"]),
      );
      previous = state;
    }
    expect((await read(owner, event.id)).body.permitted_actions).toEqual([]);
  });
  it.each(["DRAFT", "PUBLISHED", "LIVE"] as const)(
    "cancels %s with a retained nonblank audit reason",
    async (state) => {
      const { owner, event } = await fixture(state);
      const response = await change(
        owner,
        event.id,
        "CANCELLED",
        1,
        randomUUID(),
        { reason: " Venue unavailable " },
      );
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        previous_state: state,
        state: "CANCELLED",
        revision: 2,
        availability: { policy_status: "OPEN", reasons: [] },
      });
      expect(
        await db.auditEvent.findFirstOrThrow({
          where: { eventId: event.id, action: "EVENT_TRANSITIONED" },
        }),
      ).toMatchObject({
        metadata: {
          reason: "Venue unavailable",
          transitioned_at: response.body.as_of,
        },
      });
      expect((await read(owner, event.id)).body.permitted_actions).toEqual([]);
    },
  );
  it.each(["DRAFT", "PUBLISHED", "LIVE", "COMPLETED", "CANCELLED"] as const)(
    "enforces every forbidden edge from %s without mutation",
    async (from) => {
      const { owner, event } = await fixture(from);
      const allowed: Record<string, string[]> = {
        DRAFT: ["PUBLISHED", "CANCELLED"],
        PUBLISHED: ["LIVE", "CANCELLED"],
        LIVE: ["COMPLETED", "CANCELLED"],
        COMPLETED: [],
        CANCELLED: [],
      };
      for (const target of [
        "DRAFT",
        "PUBLISHED",
        "LIVE",
        "COMPLETED",
        "CANCELLED",
      ].filter((to) => !allowed[from].includes(to))) {
        const response = await change(
          owner,
          event.id,
          target,
          1,
          randomUUID(),
          { reason: "Fixture reason" },
        );
        expect(response.status).toBe(409);
        expect(response.body.code).toBe("INVALID_TRANSITION");
      }
      expect(
        await db.event.findUniqueOrThrow({ where: { id: event.id } }),
      ).toMatchObject({ state: from, revision: 1 });
      expect(
        await db.commandReplay.count({ where: { resourceKey: event.id } }),
      ).toBe(0);
    },
  );
  it("requires complete publication configuration and independently rechecks gates at Publish and Live", async () => {
    const { owner, event } = await fixture("DRAFT", false);
    const missing = await change(owner, event.id);
    expect(missing.status).toBe(422);
    expect(missing.body.code).toBe("MISSING_CONFIGURED_GATE");
    await db.gate.create({ data: { eventId: event.id } });
    await db.event.update({
      where: { id: event.id },
      data: { timeZone: null },
    });
    const incomplete = await change(owner, event.id);
    expect(incomplete.status).toBe(422);
    expect(incomplete.body).toMatchObject({
      code: "VALIDATION",
      details: { blockers: ["TIME_ZONE_REQUIRED"] },
    });
    expect((await read(owner, event.id)).body.permitted_actions).not.toContain(
      "PUBLISH",
    );
    await db.event.update({
      where: { id: event.id },
      data: { timeZone: "UTC" },
    });
    expect((await change(owner, event.id)).status).toBe(200);
    expect((await read(owner, event.id)).body.readiness.live_blockers).toEqual(
      [],
    );
    await db.gate.deleteMany({ where: { eventId: event.id } });
    const live = await change(owner, event.id, "LIVE", 2);
    expect(live.status).toBe(422);
    expect(live.body.code).toBe("MISSING_CONFIGURED_GATE");
    expect(
      await db.event.findUniqueOrThrow({ where: { id: event.id } }),
    ).toMatchObject({ state: "PUBLISHED", revision: 2 });
  });
  it("denies every Admin transition and conceals cross-event and lower-role scope", async () => {
    const { owner, admin, event, gate } = await fixture();
    for (const target of ["PUBLISHED", "LIVE", "COMPLETED", "CANCELLED"]) {
      const response = await change(admin, event.id, target, 1, randomUUID(), {
        reason: "Unauthorized",
      });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("FORBIDDEN");
      expect(response.body).not.toHaveProperty("state");
    }
    const stranger = await actor(true),
      participant = await actor(),
      volunteer = await actor(),
      security = await actor();
    for (const [account, role, gateId] of [
      [volunteer, "VOLUNTEER", null],
      [security, "GATE_SECURITY", gate!.id],
    ] as const)
      await db.eventRoleAssignment.create({
        data: {
          eventId: event.id,
          userId: account.id,
          role,
          gateId,
          scopeKey: gateId ?? "EVENT",
          grantedByUserId: owner.id,
        },
      });
    for (const account of [stranger, participant, volunteer, security]) {
      const response = await change(account, event.id);
      expect(response.status).toBe(404);
      expect(response.body.code).toBe("EVENT_NOT_FOUND");
      expect(
        await db.auditEvent.findFirstOrThrow({
          where: { correlationId: response.body.correlation_id },
        }),
      ).toMatchObject({
        action: "EVENT_ACTION_DENIED",
        eventId: null,
        metadata: null,
      });
    }
    const other = await db.event.create({
      data: { ownerUserId: stranger.id, name: "Other" },
    });
    for (const id of [other.id, randomUUID(), "malformed"])
      expect((await change(owner, id)).status).toBe(404);
    expect(
      await db.event.findUniqueOrThrow({ where: { id: event.id } }),
    ).toMatchObject({ state: "DRAFT", revision: 1 });
  });
  it("requires session, CSRF, exact body, reason, quoted revision and idempotency", async () => {
    const { owner, event } = await fixture();
    expect(
      (
        await request(app)
          .post(`/api/v1/events/${event.id}/transitions`)
          .send({ target_state: "PUBLISHED" })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post(`/api/v1/events/${event.id}/transitions`)
          .set("Cookie", owner.cookie)
          .set("Origin", origin)
          .set("X-CSRF-Token", owner.csrf)
          .set("If-Match", '"1"')
          .set("Idempotency-Key", randomUUID())
      ).status,
    ).toBe(400);
    expect(
      (await change(owner, event.id).set("X-CSRF-Token", "invalid")).status,
    ).toBe(403);
    expect(
      (await change(owner, event.id).set("Origin", "https://other.example"))
        .status,
    ).toBe(403);
    for (const revision of ["", "1", 'W/"1"', '"0"'])
      expect(
        (await change(owner, event.id).set("If-Match", revision)).status,
      ).toBe(400);
    for (const key of ["", "short"])
      expect(
        (await change(owner, event.id).set("Idempotency-Key", key)).status,
      ).toBe(400);
    for (const body of [
      {},
      { target_state: "PAUSED" },
      { target_state: "PUBLISHED", confirmed: true },
      { target_state: "PUBLISHED", ownerUserId: owner.id },
    ])
      expect(
        (await change(owner, event.id, "PUBLISHED", 1, randomUUID(), {}, body))
          .status,
      ).toBe(400);
    for (const reason of [undefined, "", "   "])
      expect(
        (
          await change(owner, event.id, "CANCELLED", 1, randomUUID(), {
            reason,
          })
        ).status,
      ).toBe(422);
    expect(
      (
        await change(owner, event.id, "CANCELLED", 1, randomUUID(), {
          reason: 42,
        })
      ).status,
    ).toBe(400);
  });
  it("replays concurrent same-key commands exactly before revision/state checks and conflicts changed payloads", async () => {
    const { owner, event } = await fixture();
    const key = randomUUID();
    const responses = await Promise.all([
      change(owner, event.id, "PUBLISHED", 1, key),
      change(owner, event.id, "PUBLISHED", 1, key),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(responses[0].body).toEqual(responses[1].body);
    expect((await change(owner, event.id, "LIVE", 2)).status).toBe(200);
    expect(
      (await change(owner, event.id.toUpperCase(), "PUBLISHED", 1, key)).body,
    ).toEqual(responses[0].body);
    const conflict = await change(owner, event.id, "COMPLETED", 3, key);
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(
      await db.auditEvent.count({
        where: { eventId: event.id, action: "EVENT_TRANSITIONED" },
      }),
    ).toBe(2);
  });
  it("serializes different-key commands and concurrent edits at the same revision", async () => {
    const first = await fixture();
    const responses = await Promise.all([
      change(first.owner, first.event.id),
      change(first.owner, first.event.id, "CANCELLED", 1, randomUUID(), {
        reason: "Concurrent cancel",
      }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(responses.find((r) => r.status === 409)!.body.code).toBe(
      "VERSION_CONFLICT",
    );
    const second = await fixture();
    const mixed = await Promise.all([
      change(second.owner, second.event.id),
      request(app)
        .patch(`/api/v1/events/${second.event.id}`)
        .set("Cookie", second.owner.cookie)
        .set("Origin", origin)
        .set("X-CSRF-Token", second.owner.csrf)
        .set("If-Match", '"1"')
        .send({ name: "Concurrent edit" }),
    ]);
    expect(mixed.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it.each(["capability", "session"] as const)(
    "denies replay after %s revocation",
    async (authority) => {
      const { owner, event } = await fixture();
      const key = randomUUID();
      expect((await change(owner, event.id, "PUBLISHED", 1, key)).status).toBe(
        200,
      );
      if (authority === "capability")
        await db.user.update({
          where: { id: owner.id },
          data: { organizerCapable: false },
        });
      else
        await db.session.update({
          where: { id: owner.sessionId },
          data: { revokedAt: new Date() },
        });
      expect((await change(owner, event.id, "PUBLISHED", 1, key)).status).toBe(
        authority === "session" ? 401 : 404,
      );
    },
  );
  it("rechecks authority and gates after waiting for the event lock", async () => {
    for (const revoked of ["capability", "session", "gate"] as const) {
      const { owner, event, gate } = await fixture("PUBLISHED");
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
      const pending = expect(
        transitionEvent(
          deps,
          { userId: owner.id, sessionId: owner.sessionId },
          event.id,
          1,
          randomUUID(),
          { target_state: "LIVE" },
          randomUUID(),
        ),
      ).rejects.toMatchObject({
        status: revoked === "session" ? 401 : revoked === "gate" ? 422 : 404,
      });
      try {
        if (revoked === "capability")
          await db.user.update({
            where: { id: owner.id },
            data: { organizerCapable: false },
          });
        else if (revoked === "session")
          await db.session.update({
            where: { id: owner.sessionId },
            data: { revokedAt: new Date() },
          });
        else await db.gate.delete({ where: { id: gate!.id } });
      } finally {
        release();
        await held;
      }
      await pending;
      expect(
        await db.event.findUniqueOrThrow({ where: { id: event.id } }),
      ).toMatchObject({ state: "PUBLISHED", revision: 1 });
    }
  });
  it("rolls back state, timestamp, revision and replay on audit failure; denial audit also fails closed", async () => {
    const { owner, admin, event } = await fixture();
    const suffix = randomUUID().replaceAll("-", ""),
      fn = `v6_reject_audit_${suffix}`,
      trigger = `v6_audit_failure_${suffix}`,
      key = randomUUID();
    await db.$executeRawUnsafe(
      `CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."correlationId" = 'v6-force-audit-failure' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END; $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER "${trigger}" BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`,
    );
    try {
      expect(
        (
          await change(owner, event.id, "PUBLISHED", 1, key).set(
            "X-Correlation-ID",
            "v6-force-audit-failure",
          )
        ).status,
      ).toBe(503);
      expect(
        await db.event.findUniqueOrThrow({ where: { id: event.id } }),
      ).toMatchObject({ state: "DRAFT", publishedAt: null, revision: 1 });
      expect(
        await db.commandReplay.count({ where: { resourceKey: event.id } }),
      ).toBe(0);
      expect(
        (
          await change(admin, event.id).set(
            "X-Correlation-ID",
            "v6-force-audit-failure",
          )
        ).status,
      ).toBe(503);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER "${trigger}" ON "AuditEvent"`);
      await db.$executeRawUnsafe(`DROP FUNCTION "${fn}"()`);
    }
    expect((await change(owner, event.id, "PUBLISHED", 1, key)).status).toBe(
      200,
    );
  });
});
