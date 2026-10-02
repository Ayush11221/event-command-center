import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { StaffRole } from "@prisma/client";
import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
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

  it("V3 conceals absent, malformed, cross-event and non-Admin detail with audited denial", async () => {
    const owner = await actor(true);
    const outsider = await actor(true);
    const event = await db.event.create({
      data: { name: "Confidential configuration", ownerUserId: owner.id },
    });
    expect((await request(app).get(`/api/v1/events/${event.id}`)).status).toBe(
      401,
    );
    for (const id of [event.id, randomUUID(), "malformed"]) {
      const response = await request(app)
        .get(`/api/v1/events/${id}?role=Organizer`)
        .set("Cookie", outsider.cookie);
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        code: "EVENT_NOT_FOUND",
        message: "Event not found",
      });
      expect(response.body).not.toHaveProperty("event_id");
    }
    for (const role of [StaffRole.VOLUNTEER, StaffRole.GATE_SECURITY]) {
      const staff = await actor(false);
      const gate =
        role === StaffRole.GATE_SECURITY
          ? await db.gate.create({ data: { eventId: event.id } })
          : null;
      await db.eventRoleAssignment.create({
        data: {
          eventId: event.id,
          userId: staff.id,
          role,
          gateId: gate?.id,
          scopeKey: gate?.id ?? "EVENT",
          grantedByUserId: owner.id,
        },
      });
      expect(
        (
          await request(app)
            .get(`/api/v1/events/${event.id}`)
            .set("Cookie", staff.cookie)
        ).status,
      ).toBe(404);
    }
    expect(
      await db.auditEvent.count({
        where: { actorUserId: outsider.id, action: "EVENT_ACTION_DENIED" },
      }),
    ).toBe(3);
  });

  it("V3 returns only management fields, scoped gates and role-limited guidance without PRIVATE secrets", async () => {
    const owner = await actor(true);
    const admin = await actor(false);
    const event = await db.event.create({
      data: {
        name: "Assigned detail",
        ownerUserId: owner.id,
        visibility: "PRIVATE",
        registrationCapacity: 100,
        revision: 3,
      },
    });
    const gate = await db.gate.create({ data: { eventId: event.id } });
    await db.eventRoleAssignment.create({
      data: {
        eventId: event.id,
        userId: admin.id,
        role: "EVENT_ADMIN",
        scopeKey: "EVENT",
        grantedByUserId: owner.id,
      },
    });
    const verifier = randomUUID().replaceAll("-", "").repeat(2);
    await db.privateAccessLink.create({
      data: { eventId: event.id, verifierHash: verifier },
    });
    for (const [user, actions] of [
      [owner, ["EDIT_EVENT", "CREATE_GATE", "CANCEL"]],
      [admin, ["EDIT_EVENT", "CREATE_GATE"]],
    ] as const) {
      const response = await request(app)
        .get(`/api/v1/events/${event.id}`)
        .set("Cookie", user.cookie)
        .set("If-Match", '"1"');
      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toMatchObject({
        event_id: event.id,
        revision: 3,
        visibility: "PRIVATE",
        registration_capacity: 100,
        permitted_actions: [...actions],
        gates: [{ gate_id: gate.id, event_id: event.id }],
        readiness: { configured_gate_present: true },
      });
      expect(Object.keys(response.body).sort()).toEqual(
        [
          "event_id",
          "name",
          "description",
          "state",
          "visibility",
          "public_location",
          "image_url",
          "category",
          "tags",
          "start_at",
          "end_at",
          "time_zone",
          "registration_capacity",
          "registration_opens_at",
          "registration_closes_at",
          "registration_cancellation_cutoff_at",
          "registration_manually_closed",
          "checkout_enabled",
          "gates",
          "readiness",
          "availability",
          "permitted_actions",
          "revision",
          "as_of",
          "correlation_id",
        ].sort(),
      );
      expect(JSON.stringify(response.body)).not.toContain(verifier);
    }
  });

  it("V3 rechecks assignment, session and Organizer capability on the next detail request", async () => {
    const owner = await actor(true);
    const admin = await actor(false);
    const event = await db.event.create({
      data: { name: "Revocable detail", ownerUserId: owner.id },
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
    const read = (cookie: string) =>
      request(app).get(`/api/v1/events/${event.id}`).set("Cookie", cookie);
    expect((await read(admin.cookie)).status).toBe(200);
    await db.eventRoleAssignment.update({
      where: { id: assignment.id },
      data: { revokedAt: new Date(), revokedByUserId: owner.id },
    });
    expect((await read(admin.cookie)).status).toBe(404);
    await db.user.update({
      where: { id: owner.id },
      data: { organizerCapable: false },
    });
    expect((await read(owner.cookie)).status).toBe(404);
    await db.session.updateMany({
      where: { userId: admin.id },
      data: { revokedAt: new Date() },
    });
    expect((await read(admin.cookie)).status).toBe(401);
  });

  it("V3 returns configuration-derived availability separately from every lifecycle state", async () => {
    const owner = await actor(true);
    const admin = await actor(false);
    const event = await db.event.create({
      data: { name: "Availability detail", ownerUserId: owner.id },
    });
    await db.eventRoleAssignment.create({
      data: {
        eventId: event.id,
        userId: admin.id,
        role: "EVENT_ADMIN",
        scopeKey: "EVENT",
        grantedByUserId: owner.id,
      },
    });
    const future = new Date(Date.now() + 86_400_000);
    const past = new Date(Date.now() - 86_400_000);
    for (const state of [
      "DRAFT",
      "PUBLISHED",
      "LIVE",
      "COMPLETED",
      "CANCELLED",
    ] as const) {
      for (const [configuration, reasons] of [
        [
          {
            registrationOpensAt: null,
            registrationClosesAt: null,
            startAt: future,
            registrationManuallyClosed: false,
          },
          [],
        ],
        [
          {
            registrationOpensAt: future,
            registrationClosesAt: null,
            startAt: null,
            registrationManuallyClosed: false,
          },
          ["NOT_OPEN_YET"],
        ],
        [
          {
            registrationOpensAt: null,
            registrationClosesAt: null,
            startAt: past,
            registrationManuallyClosed: false,
          },
          ["SCHEDULED_CLOSE_REACHED"],
        ],
        [
          {
            registrationOpensAt: null,
            registrationClosesAt: past,
            startAt: future,
            registrationManuallyClosed: true,
          },
          ["SCHEDULED_CLOSE_REACHED", "MANUALLY_CLOSED"],
        ],
      ] as const) {
        await db.event.update({
          where: { id: event.id },
          data: {
            state,
            ...configuration,
            endAt: configuration.startAt
              ? new Date(configuration.startAt.getTime() + 3_600_000)
              : null,
          },
        });
        for (const cookie of [owner.cookie, admin.cookie]) {
          const response = await request(app)
            .get(`/api/v1/events/${event.id}`)
            .set("Cookie", cookie);
          expect(response.status).toBe(200);
          expect(response.body.state).toBe(state);
          expect(response.body.availability).toEqual({
            policy_status: reasons.length ? "CLOSED" : "OPEN",
            reasons: [...reasons],
            opens_at: configuration.registrationOpensAt?.toISOString() ?? null,
            closes_at:
              (
                configuration.registrationClosesAt ?? configuration.startAt
              )?.toISOString() ?? null,
            as_of: response.body.as_of,
          });
        }
      }
    }
  });

  it("V3 keeps dual owner/Admin relationships valid without trusting the selected client role", async () => {
    const owner = await actor(true);
    const event = await db.event.create({
      data: { name: "Dual context", ownerUserId: owner.id },
    });
    await db.eventRoleAssignment.create({
      data: {
        eventId: event.id,
        userId: owner.id,
        role: "EVENT_ADMIN",
        scopeKey: "EVENT",
        grantedByUserId: owner.id,
      },
    });
    for (const view of ["owned", "assigned"]) {
      const response = await request(app)
        .get(`/api/v1/events?view=${view}`)
        .set("Cookie", owner.cookie);
      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([
        expect.objectContaining({ event_id: event.id, relationship: view }),
      ]);
    }
    expect(
      (
        await request(app)
          .get(`/api/v1/events/${event.id}?role=EVENT_ADMIN`)
          .set("Cookie", owner.cookie)
      ).body.permitted_actions,
    ).toContain("CANCEL");
  });
  it("V3 returns safe dependency errors without exposing Event data", async () => {
    const owner = await actor(true);
    const failed = vi
      .spyOn(db.event, "findFirst")
      .mockRejectedValueOnce(new Error("private storage failure"));
    try {
      const response = await request(app)
        .get(`/api/v1/events/${randomUUID()}`)
        .set("Cookie", owner.cookie);
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        code: "DEPENDENCY_UNAVAILABLE",
        retryable: true,
      });
      expect(response.body).not.toHaveProperty("event_id");
      expect(JSON.stringify(response.body)).not.toContain(
        "private storage failure",
      );
    } finally {
      failed.mockRestore();
    }
  });
});
