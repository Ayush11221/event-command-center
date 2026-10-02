import { randomBytes, randomUUID } from "node:crypto";
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
import { editManagementEvent } from "./edit.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = "http://127.0.0.1:5173";
describe.skipIf(!databaseUrl)("V4 permitted Event editing (PostgreSQL)", () => {
  const db = createDatabase(databaseUrl ?? "");
  const config: FoundationConfig = {
    databaseUrl: databaseUrl ?? "",
    jwtSecret: new Uint8Array(Buffer.alloc(32, 9)),
    contactKey: Buffer.alloc(32, 10),
    otpKey: Buffer.alloc(32, 11),
    cookieSecure: false,
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
    {
      db,
      config,
      frontendOrigin: origin,
      otp: new OtpService(db, config, {
        available: () => false,
        async send() {},
      }),
    },
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
      data: {
        ownerUserId: owner.id,
        name: "Original",
        description: "Original description",
      },
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
  function patch(
    actor: Awaited<ReturnType<typeof fixture>>["owner"],
    eventId: string,
    body: object,
    revision = 1,
  ) {
    return request(app)
      .patch(`/api/v1/events/${eventId}`)
      .set("Cookie", actor.cookie)
      .set("Origin", origin)
      .set("X-CSRF-Token", actor.csrf)
      .set("If-Match", `"${revision}"`)
      .send(body);
  }
  afterAll(async () => {
    await db.$disconnect();
  });

  it.each(["assignment", "capability", "session"] as const)(
    "rechecks %s revocation for an already-authenticated actor waiting on the event lock",
    async (authority) => {
      const { owner, admin, event, assignment } = await fixture();
      const account = authority === "assignment" ? admin : owner;
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
      const editing = editManagementEvent(
        {
          db,
          config,
          frontendOrigin: origin,
          otp: new OtpService(db, config, {
            available: () => false,
            async send() {},
          }),
        },
        { userId: account.id, sessionId: account.sessionId },
        event.id,
        1,
        { name: "Denied" },
        randomUUID(),
      );
      const denied = expect(editing).rejects.toMatchObject({
        status: authority === "session" ? 401 : 404,
      });
      try {
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
      } finally {
        release();
        await held;
      }
      await denied;
      expect(
        (await db.event.findUniqueOrThrow({ where: { id: event.id } }))
          .revision,
      ).toBe(1);
    },
  );

  it("updates the complete Organizer allowlist, returns current management detail and audits without replay", async () => {
    const { owner, event } = await fixture();
    const body = {
      name: "Edited",
      description: "Description",
      public_location: "Hall",
      image_url: "https://images.example.org/banner.jpg",
      category: "Conference",
      tags: ["Technology"],
      start_at: "2030-01-01T10:00:00Z",
      end_at: "2030-01-01T12:00:00Z",
      time_zone: "Asia/Kolkata",
      visibility: "PRIVATE",
      registration_capacity: 200,
      registration_opens_at: "2029-12-01T10:00:00Z",
      registration_closes_at: "2030-01-01T11:00:00Z",
      registration_cancellation_cutoff_at: "2029-12-31T10:00:00Z",
      registration_manually_closed: true,
      checkout_enabled: true,
    };
    const response = await patch(owner, event.id, body);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ...body,
      start_at: "2030-01-01T10:00:00.000Z",
      end_at: "2030-01-01T12:00:00.000Z",
      registration_opens_at: "2029-12-01T10:00:00.000Z",
      registration_closes_at: "2030-01-01T11:00:00.000Z",
      registration_cancellation_cutoff_at: "2029-12-31T10:00:00.000Z",
      event_id: event.id,
      revision: 2,
      state: "DRAFT",
      availability: {
        policy_status: "CLOSED",
        reasons: ["NOT_OPEN_YET", "MANUALLY_CLOSED"],
      },
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(
      await db.commandReplay.count({ where: { actorUserId: owner.id } }),
    ).toBe(0);
    const audit = await db.auditEvent.findFirstOrThrow({
      where: { eventId: event.id, action: "EVENT_UPDATED" },
    });
    expect(audit).toMatchObject({
      actorUserId: owner.id,
      outcome: "ACCEPTED",
      correlationId: response.body.correlation_id,
      metadata: {
        fields: Object.keys(body),
        previous_revision: 1,
        revision: 2,
        published_material_edit: false,
      },
    });
    const partial = await patch(owner, event.id, { description: null }, 2);
    expect(partial.status).toBe(200);
    expect(partial.body).toMatchObject({
      name: "Edited",
      description: null,
      registration_capacity: 200,
      revision: 3,
    });
  });
  it("allows exactly the six Admin public fields and rejects every Organizer-only/unknown field atomically", async () => {
    const { admin, event, owner } = await fixture();
    const publicBody = {
      name: "Admin edit",
      description: "Details",
      public_location: "Public Hall",
      image_url: null,
      category: "Workshop",
      tags: ["Skills"],
    };
    expect((await patch(admin, event.id, publicBody)).status).toBe(200);
    for (const [field, value] of Object.entries({
      owner_user_id: owner.id,
      state: "LIVE",
      gates: [],
      private_link: "secret",
      visibility: "PUBLIC",
      start_at: null,
      end_at: null,
      time_zone: "UTC",
      registration_capacity: 100,
      registration_opens_at: null,
      registration_closes_at: null,
      registration_cancellation_cutoff_at: null,
      registration_manually_closed: true,
      checkout_enabled: true,
      attendance_policy: "any",
      certificate_policy: "any",
    })) {
      const response = await patch(
        admin,
        event.id,
        { name: "Must not change", [field]: value },
        2,
      );
      expect(response.status, field).toBe(403);
      expect(response.body.code).toBe("FORBIDDEN");
    }
    expect(
      await db.event.findUniqueOrThrow({ where: { id: event.id } }),
    ).toMatchObject({ name: "Admin edit", revision: 2 });
    expect(
      await db.auditEvent.count({
        where: { eventId: event.id, action: "EVENT_UPDATED" },
      }),
    ).toBe(1);
    const denials = await db.auditEvent.findMany({
      where: { actorUserId: admin.id, action: "EVENT_ACTION_DENIED" },
    });
    expect(denials).toHaveLength(16);
    expect(
      denials.every(
        (audit) => audit.eventId === null && audit.metadata === null,
      ),
    ).toBe(true);
  });
  it("conceals other events from owners, Admins and non-Admin assignments", async () => {
    const { owner, admin, event } = await fixture();
    const stranger = await actor(true),
      volunteer = await actor();
    await db.eventRoleAssignment.create({
      data: {
        eventId: event.id,
        userId: volunteer.id,
        role: "VOLUNTEER",
        scopeKey: "EVENT",
        grantedByUserId: owner.id,
      },
    });
    const other = await db.event.create({
      data: { name: "Other", ownerUserId: stranger.id },
    });
    for (const [account, id] of [
      [stranger, event.id],
      [volunteer, event.id],
      [admin, other.id],
      [owner, other.id],
    ] as const) {
      const response = await patch(account, id, { name: "Denied" });
      expect(response.status).toBe(404);
      expect(response.body.code).toBe("EVENT_NOT_FOUND");
      expect(JSON.stringify(response.body)).not.toContain("Original");
    }
    expect((await patch(owner, randomUUID(), { name: "Denied" })).status).toBe(
      404,
    );
  });
  it("requires authentication, CSRF, exact revision and rejects unknown Organizer fields", async () => {
    const { owner, event } = await fixture();
    expect(
      (
        await request(app)
          .patch(`/api/v1/events/${event.id}`)
          .send({ name: "Denied" })
      ).status,
    ).toBe(401);
    expect(
      (
        await patch(owner, event.id, { name: "Denied" }).set(
          "X-CSRF-Token",
          "invalid",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await patch(owner, event.id, { name: "Denied" }).set(
          "Origin",
          "https://other.example",
        )
      ).status,
    ).toBe(403);
    for (const value of ["", "1", 'W/"1"', '"0"', '"1", "2"'])
      expect(
        (
          await patch(owner, event.id, { name: "Denied" }).set(
            "If-Match",
            value,
          )
        ).status,
      ).toBe(400);
    for (const field of [
      "owner_user_id",
      "state",
      "gates",
      "revision",
      "private_link",
      "certificate_policy",
    ]) {
      const response = await patch(owner, event.id, {
        name: "Denied",
        [field]: "secret",
      });
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).not.toContain(field);
      expect(JSON.stringify(response.body)).not.toContain("secret");
    }
    expect(
      (await db.event.findUniqueOrThrow({ where: { id: event.id } })).revision,
    ).toBe(1);
  });
  it("validates the merged configuration, retaining all prior fields on rejection", async () => {
    const { owner, event } = await fixture();
    for (const body of [
      { name: " " },
      { start_at: "2030-01-01T10:00:00Z" },
      { start_at: "2030-01-01T10:00:00Z", end_at: "2030-01-01T09:00:00Z" },
      {
        registration_opens_at: "2030-01-01T10:00:00Z",
        registration_closes_at: "2030-01-01T09:00:00Z",
      },
      { time_zone: "Invalid/Zone" },
      { image_url: "data:image/png;base64,secret" },
      { registration_capacity: 0 },
      { tags: ["duplicate", "duplicate"] },
    ])
      expect((await patch(owner, event.id, body)).status).toBe(400);
    expect(
      (
        await patch(owner, event.id, {
          start_at: "2030-01-01T10:00:00Z",
          end_at: "2030-01-01T12:00:00Z",
        })
      ).status,
    ).toBe(200);
    expect(
      (await patch(owner, event.id, { start_at: "2030-01-01T13:00:00Z" }, 2))
        .status,
    ).toBe(400);
    expect(
      (await db.event.findUniqueOrThrow({ where: { id: event.id } })).revision,
    ).toBe(2);
  });
  it("accepts Published material edits with audit, rejects Live and terminal states", async () => {
    const { owner, admin, event } = await fixture();
    await db.event.update({
      where: { id: event.id },
      data: { state: "PUBLISHED" },
    });
    expect(
      (await patch(admin, event.id, { name: "Published edit" })).status,
    ).toBe(200);
    expect(
      (
        await db.auditEvent.findFirstOrThrow({
          where: { eventId: event.id, action: "EVENT_UPDATED" },
        })
      ).metadata,
    ).toMatchObject({ published_material_edit: true });
    for (const state of ["LIVE", "COMPLETED", "CANCELLED"] as const) {
      await db.event.update({ where: { id: event.id }, data: { state } });
      for (const account of [owner, admin]) {
        const response = await patch(account, event.id, { name: "Denied" }, 2);
        expect(response.status).toBe(422);
        expect(response.body.code).toBe("WRONG_LIFECYCLE_STATE");
      }
    }
  });
  it("serializes concurrent same-revision edits with one winner and no duplicate audit", async () => {
    const { owner, event } = await fixture();
    const responses = await Promise.all([
      patch(owner, event.id, { name: "First" }),
      patch(owner, event.id, { name: "Second" }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect(
      responses.find((response) => response.status === 409)!.body,
    ).toMatchObject({
      code: "VERSION_CONFLICT",
      details: { current_revision: 2 },
    });
    expect(
      (await db.event.findUniqueOrThrow({ where: { id: event.id } })).revision,
    ).toBe(2);
    expect(
      await db.auditEvent.count({
        where: { eventId: event.id, action: "EVENT_UPDATED" },
      }),
    ).toBe(1);
    expect((await patch(owner, event.id, { name: "Retry" })).status).toBe(409);
  });
  it("rechecks revoked assignment, capability and session rather than cached authority", async () => {
    const { owner, admin, event, assignment } = await fixture();
    await db.eventRoleAssignment.update({
      where: { id: assignment.id },
      data: { revokedAt: new Date(), revokedByUserId: owner.id },
    });
    expect((await patch(admin, event.id, { name: "Denied" })).status).toBe(404);
    await db.user.update({
      where: { id: owner.id },
      data: { organizerCapable: false },
    });
    expect((await patch(owner, event.id, { name: "Denied" })).status).toBe(404);
    await db.session.update({
      where: { id: owner.sessionId },
      data: { revokedAt: new Date() },
    });
    expect((await patch(owner, event.id, { name: "Denied" })).status).toBe(401);
  });
  it("rechecks an assignment revoked while the edit waits for the event lock", async () => {
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
    const editing = patch(admin, event.id, {
      name: "Denied after revoke",
    }).then((response) => response);
    try {
      await db.eventRoleAssignment.update({
        where: { id: assignment.id },
        data: { revokedAt: new Date(), revokedByUserId: owner.id },
      });
    } finally {
      release();
      await held;
    }
    expect((await editing).status).toBe(404);
    expect(
      (await db.event.findUniqueOrThrow({ where: { id: event.id } })).revision,
    ).toBe(1);
  });
  it("atomically invalidates PRIVATE-to-PUBLIC proof and never revives it", async () => {
    const { owner, event } = await fixture();
    await db.event.update({
      where: { id: event.id },
      data: { visibility: "PRIVATE", state: "PUBLISHED" },
    });
    const link = await db.privateAccessLink.create({
      data: {
        eventId: event.id,
        verifierHash: randomBytes(32).toString("hex"),
        verifierKeyVersion: 1,
      },
    });
    const response = await patch(owner, event.id, { visibility: "PUBLIC" });
    expect(response.status).toBe(200);
    expect(
      (await db.privateAccessLink.findUniqueOrThrow({ where: { id: link.id } }))
        .revokedAt,
    ).not.toBeNull();
    expect(JSON.stringify(response.body)).not.toContain("verifier");
    expect(
      (await patch(owner, event.id, { visibility: "PRIVATE" }, 2)).status,
    ).toBe(200);
    expect(
      await db.privateAccessLink.count({
        where: { eventId: event.id, revokedAt: null },
      }),
    ).toBe(0);
  });
  it("rolls back configuration, revision and proof invalidation when required audit fails", async () => {
    const { owner, event } = await fixture();
    await db.event.update({
      where: { id: event.id },
      data: { visibility: "PRIVATE", state: "PUBLISHED" },
    });
    const link = await db.privateAccessLink.create({
      data: {
        eventId: event.id,
        verifierHash: randomBytes(32).toString("hex"),
        verifierKeyVersion: 1,
      },
    });
    const suffix = randomUUID().replaceAll("-", ""),
      functionName = `v4_reject_audit_${suffix}`,
      triggerName = `v4_audit_failure_${suffix}`;
    await db.$executeRawUnsafe(
      `CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."correlationId" = 'v4-force-audit-failure' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END; $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`,
    );
    try {
      const response = await patch(owner, event.id, {
        name: "Must roll back",
        visibility: "PUBLIC",
      }).set("X-Correlation-ID", "v4-force-audit-failure");
      expect(response.status).toBe(503);
      expect(response.body.code).toBe("DEPENDENCY_UNAVAILABLE");
      expect(
        await db.event.findUniqueOrThrow({ where: { id: event.id } }),
      ).toMatchObject({ name: "Original", visibility: "PRIVATE", revision: 1 });
      expect(
        (
          await db.privateAccessLink.findUniqueOrThrow({
            where: { id: link.id },
          })
        ).revokedAt,
      ).toBeNull();
      expect(
        await db.auditEvent.count({
          where: { eventId: event.id, action: "EVENT_UPDATED" },
        }),
      ).toBe(0);
      const admin = await actor();
      const denial = await patch(admin, event.id, { name: "Denied" }).set(
        "X-Correlation-ID",
        "v4-force-audit-failure",
      );
      expect(denial.status).toBe(503);
      expect(denial.body.code).toBe("DEPENDENCY_UNAVAILABLE");
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER "${triggerName}" ON "AuditEvent"`,
      );
      await db.$executeRawUnsafe(`DROP FUNCTION "${functionName}"()`);
    }
  });
});
