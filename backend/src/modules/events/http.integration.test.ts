import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { StaffRole } from "@prisma/client";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createDatabase } from "../../config/database.js";
import type { FoundationConfig } from "../../config/foundation.js";
import { createLogger } from "../../config/logger.js";
import { OtpService } from "../auth/otp.js";
import { csrfToken, signAccountToken } from "../auth/tokens.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = "http://127.0.0.1:5173";
const config: FoundationConfig = {
  databaseUrl: databaseUrl ?? "",
  jwtSecret: new Uint8Array(Buffer.alloc(32, 9)),
  contactKey: Buffer.alloc(32, 10),
  otpKey: Buffer.alloc(32, 11),
  cookieSecure: false,
};

describe.skipIf(!databaseUrl)("Slice 3 V2 Event API", () => {
  const db = createDatabase(databaseUrl ?? "");
  const otp = new OtpService(db, config, {
    available: () => false,
    async send() {},
  });
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

  async function actor(organizerCapable: boolean) {
    const user = await db.user.create({ data: { organizerCapable } });
    const session = await db.session.create({
      data: {
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const token = await signAccountToken(user.id, session.id, config.jwtSecret);
    return {
      id: user.id,
      cookie: `eoc_session=${token}`,
      csrf: csrfToken(session.id, config.jwtSecret),
    };
  }

  afterAll(async () => {
    await db.$disconnect();
  });

  it("requires a current account session and Organizer capability for owned events", async () => {
    expect((await request(app).get("/api/v1/events?view=owned")).status).toBe(
      401,
    );
    expect(
      (await request(app).post("/api/v1/events").send({ name: "Denied" }))
        .status,
    ).toBe(401);
    const participant = await actor(false);
    const deniedList = await request(app)
      .get("/api/v1/events?view=owned")
      .set("Cookie", participant.cookie);
    expect(deniedList.status).toBe(403);
    expect(deniedList.body.code).toBe("FORBIDDEN");
    const deniedCreate = await request(app)
      .post("/api/v1/events")
      .set("Cookie", participant.cookie)
      .set("Origin", origin)
      .set("X-CSRF-Token", participant.csrf)
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Denied" });
    expect(deniedCreate.status).toBe(403);
    expect(
      await db.event.count({ where: { ownerUserId: participant.id } }),
    ).toBe(0);
    expect(
      await db.auditEvent.count({
        where: {
          actorUserId: participant.id,
          action: "EVENT_ACTION_DENIED",
          outcome: "DENIED",
        },
      }),
    ).toBe(2);
  });

  it("filters owner and current Admin lists before cursor paging", async () => {
    const owner = await actor(true);
    const other = await actor(true);
    const admin = await actor(false);
    const first = await db.event.create({
      data: { ownerUserId: owner.id, name: "First Draft" },
    });
    const second = await db.event.create({
      data: { ownerUserId: owner.id, name: "Second Draft" },
    });
    const third = await db.event.create({
      data: { ownerUserId: owner.id, name: "Third Draft" },
    });
    await db.event.create({
      data: { ownerUserId: other.id, name: "Other owner" },
    });
    const page = await request(app)
      .get("/api/v1/events?view=owned&limit=2")
      .set("Cookie", owner.cookie);
    expect(page.status).toBe(200);
    expect(page.body.items).toHaveLength(2);
    expect(
      page.body.items.every(
        (item: { relationship: string }) => item.relationship === "owned",
      ),
    ).toBe(true);
    expect(page.body.items[0]).toEqual(
      expect.objectContaining({
        start_at: null,
        end_at: null,
        time_zone: null,
      }),
    );
    expect(page.body.next_cursor).toEqual(expect.any(String));
    expect(page.body).not.toHaveProperty("total_count");
    const next = await request(app)
      .get("/api/v1/events")
      .query({ view: "owned", limit: 2, cursor: page.body.next_cursor })
      .set("Cookie", owner.cookie);
    expect(next.status).toBe(200);
    const ids = [...page.body.items, ...next.body.items].map(
      (item: { event_id: string }) => item.event_id,
    );
    expect(ids.sort()).toEqual([first.id, second.id, third.id].sort());
    expect(next.body.next_cursor).toBeNull();
    expect(
      (
        await request(app)
          .get("/api/v1/events")
          .query({ view: "assigned", cursor: page.body.next_cursor })
          .set("Cookie", owner.cookie)
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .get("/api/v1/events")
          .query({ view: "owned", cursor: page.body.next_cursor })
          .set("Cookie", other.cookie)
      ).status,
    ).toBe(400);

    const assignment = await db.eventRoleAssignment.create({
      data: {
        eventId: first.id,
        userId: admin.id,
        role: StaffRole.EVENT_ADMIN,
        scopeKey: "EVENT",
        grantedByUserId: owner.id,
      },
    });
    const assigned = await request(app)
      .get("/api/v1/events?view=assigned")
      .set("Cookie", admin.cookie);
    expect(assigned.status).toBe(200);
    expect(assigned.body.items).toEqual([
      expect.objectContaining({ event_id: first.id, relationship: "assigned" }),
    ]);
    expect(
      (
        await request(app)
          .get("/api/v1/events?view=owned")
          .set("Cookie", admin.cookie)
      ).status,
    ).toBe(403);
    await db.eventRoleAssignment.update({
      where: { id: assignment.id },
      data: { revokedAt: new Date(), revokedByUserId: owner.id },
    });
    expect(
      (
        await request(app)
          .get("/api/v1/events?view=assigned")
          .set("Cookie", admin.cookie)
      ).status,
    ).toBe(403);
  });

  it("creates only a revision-one Draft and replays the exact audited result", async () => {
    const owner = await actor(true);
    const key = randomUUID();
    const post = (name: string) =>
      request(app)
        .post("/api/v1/events")
        .set("Cookie", owner.cookie)
        .set("Origin", origin)
        .set("X-CSRF-Token", owner.csrf)
        .set("Idempotency-Key", key)
        .send({ name });
    const first = await post("Opening night");
    expect(first.status).toBe(201);
    expect(first.body).toEqual(
      expect.objectContaining({
        name: "Opening night",
        state: "DRAFT",
        revision: 1,
        visibility: null,
        start_at: null,
        registration_capacity: null,
        gates: [],
        correlation_id: expect.any(String),
        as_of: expect.any(String),
      }),
    );
    expect(first.body.readiness.configured_gate_present).toBe(false);
    const again = await post("Opening night");
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    const conflict = await post("Different body");
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("IDEMPOTENCY_CONFLICT");
    expect((await post(" Opening night ")).body.code).toBe(
      "IDEMPOTENCY_CONFLICT",
    );
    expect(await db.event.count({ where: { ownerUserId: owner.id } })).toBe(1);
    expect(
      await db.auditEvent.count({
        where: { eventId: first.body.event_id, action: "EVENT_CREATED" },
      }),
    ).toBe(1);
    expect(
      await db.commandReplay.count({
        where: { actorUserId: owner.id, action: "EVENT_CREATE" },
      }),
    ).toBe(1);
  });

  it("rejects unknown Draft fields, invalid name, missing key, and failed CSRF", async () => {
    const owner = await actor(true);
    const base = () =>
      request(app)
        .post("/api/v1/events")
        .set("Cookie", owner.cookie)
        .set("Origin", origin)
        .set("X-CSRF-Token", owner.csrf)
        .set("Idempotency-Key", randomUUID());
    expect(
      (await base().send({ name: "Valid", state: "PUBLISHED" })).status,
    ).toBe(400);
    const blank = await base().send({ name: "   " });
    expect(blank.status).toBe(400);
    expect(blank.body.details).toEqual({ field: "name" });
    expect((await base().send({ name: "x".repeat(201) })).status).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/v1/events")
          .set("Cookie", owner.cookie)
          .set("Origin", origin)
          .set("X-CSRF-Token", owner.csrf)
          .send({ name: "No key" })
      ).status,
    ).toBe(400);
    const csrf = await request(app)
      .post("/api/v1/events")
      .set("Cookie", owner.cookie)
      .set("Origin", origin)
      .set("Idempotency-Key", randomUUID())
      .send({ name: "No CSRF" });
    expect(csrf.status).toBe(403);
    expect(csrf.body.code).toBe("CSRF_INVALID");
    expect(
      (
        await request(app)
          .post("/api/v1/events")
          .set("Cookie", owner.cookie)
          .set("Origin", "http://evil.invalid")
          .set("X-CSRF-Token", owner.csrf)
          .set("Idempotency-Key", randomUUID())
          .send({ name: "Wrong origin" })
      ).status,
    ).toBe(403);
    expect(await db.event.count({ where: { ownerUserId: owner.id } })).toBe(0);
  });

  it("settles concurrent same-key Draft creation once", async () => {
    const owner = await actor(true);
    const key = randomUUID();
    const post = () =>
      request(app)
        .post("/api/v1/events")
        .set("Cookie", owner.cookie)
        .set("Origin", origin)
        .set("X-CSRF-Token", owner.csrf)
        .set("Idempotency-Key", key)
        .send({ name: "Concurrent Draft" });
    const [first, second] = await Promise.all([post(), post()]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await db.event.count({ where: { ownerUserId: owner.id } })).toBe(1);
  });

  it("rolls back Draft and replay if required audit persistence fails", async () => {
    const owner = await actor(true);
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `v2_reject_audit_${suffix}`;
    const triggerName = `v2_audit_failure_${suffix}`;
    await db.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."correlationId" = 'v2-force-audit-failure' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END; $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "AuditEvent"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
    try {
      const response = await request(app)
        .post("/api/v1/events")
        .set("Cookie", owner.cookie)
        .set("Origin", origin)
        .set("X-CSRF-Token", owner.csrf)
        .set("Idempotency-Key", randomUUID())
        .set("X-Correlation-Id", "v2-force-audit-failure")
        .send({ name: "Must roll back" });
      expect(response.status).toBe(503);
      expect(response.body).not.toHaveProperty("event_id");
      expect(await db.event.count({ where: { ownerUserId: owner.id } })).toBe(
        0,
      );
      expect(
        await db.commandReplay.count({
          where: { actorUserId: owner.id, action: "EVENT_CREATE" },
        }),
      ).toBe(0);
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER "${triggerName}" ON "AuditEvent"`,
      );
      await db.$executeRawUnsafe(`DROP FUNCTION "${functionName}"()`);
    }
  });
});
