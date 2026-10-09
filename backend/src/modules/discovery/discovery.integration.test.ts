import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Writable } from "node:stream";
import type { EventState, EventVisibility, Prisma } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { createDatabase } from "../../config/database.js";
import { createLogger } from "../../config/logger.js";
import { OtpService } from "../auth/otp.js";
import { encodeEventCursor } from "../events/cursor.js";
import { signAccountToken } from "../auth/tokens.js";

const sourceUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!sourceUrl)(
  "V7 anonymous PUBLIC discovery (PostgreSQL)",
  () => {
    const url = new URL(sourceUrl ?? "postgresql://invalid/invalid"),
      databaseName = `v7_discovery_${randomUUID().replaceAll("-", "")}`;
    const adminUrl = new URL(url);
    adminUrl.pathname = "/postgres";
    adminUrl.searchParams.delete("schema");
    url.pathname = `/${databaseName}`;
    url.searchParams.delete("schema");
    const admin = createDatabase(adminUrl.toString()),
      db = createDatabase(url.toString());
    const config = {
      databaseUrl: url.toString(),
      jwtSecret: new Uint8Array(Buffer.alloc(32, 9)),
      contactKey: Buffer.alloc(32, 10),
      otpKey: Buffer.alloc(32, 11),
      cookieSecure: false,
    };
    const origin = "http://127.0.0.1:5173",
      logs: string[] = [];
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
          write(chunk, _encoding, done) {
            logs.push(String(chunk));
            done();
          },
        }),
      ),
      deps,
    );
    let ownerId: string,
      created = false;
    beforeAll(async () => {
      if (!/^v7_discovery_[0-9a-f]{32}$/.test(databaseName))
        throw new Error("Unsafe verification database name");
      await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
      created = true;
      const root = resolve(import.meta.dirname, "../../../..");
      execFileSync(
        process.execPath,
        [
          resolve(root, "node_modules/prisma/build/index.js"),
          "migrate",
          "deploy",
          "--config",
          "database/prisma7.config.ts",
        ],
        {
          cwd: root,
          env: { ...process.env, DATABASE_URL: url.toString() },
          stdio: "pipe",
          timeout: 90_000,
        },
      );
      ownerId = (await db.user.create({ data: { organizerCapable: true } })).id;
    }, 120_000);
    afterAll(async () => {
      await db.$disconnect();
      if (created)
        await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
      await admin.$disconnect();
    });
    async function event(
      state: EventState = "PUBLISHED",
      visibility: EventVisibility = "PUBLIC",
      extra: Partial<Prisma.EventUncheckedCreateInput> = {},
    ) {
      return db.event.create({
        data: {
          ownerUserId: ownerId,
          name: "Public conference",
          description: "Meet the community.",
          state,
          visibility,
          startAt: new Date("2030-01-01T10:00:00Z"),
          endAt: new Date("2030-01-01T12:00:00Z"),
          timeZone: "Asia/Kolkata",
          publicLocation: "City hall",
          imageUrl: "https://example.org/banner.png",
          category: "Conference",
          tags: ["Community"],
          registrationCapacity: 100,
          registrationClosesAt: new Date("2030-01-01T14:00:00Z"),
          publishedAt: new Date(),
          ...extra,
        },
      });
    }
    const listFields = [
      "event_id",
      "event_state",
      "name",
      "start_at",
      "end_at",
      "time_zone",
      "public_location",
      "image_url",
      "category",
      "tags",
      "availability",
    ];
    it("returns the exact empty catalog wrapper", async () => {
      const response = await request(app).get("/api/v1/discovery/events");
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        items: [],
        next_cursor: null,
        as_of: expect.any(String),
        correlation_id: expect.any(String),
      });
    });
    it("returns only PUBLIC PUBLISHED and LIVE events without session, CSRF, or context", async () => {
      const eligible = await event("PUBLISHED", "PUBLIC", {
        publishedAt: new Date("2030-01-01T00:00:00Z"),
      });
      const live = await event("LIVE", "PUBLIC", {
        publishedAt: new Date("2030-01-02T00:00:00Z"),
      });
      const excluded = [];
      for (const state of ["DRAFT", "COMPLETED", "CANCELLED"] as const)
        excluded.push(await event(state));
      excluded.push(await event("PUBLISHED", "PRIVATE"));
      excluded.push(await event("LIVE", "PRIVATE"));
      const response = await request(app).get("/api/v1/discovery/events");
      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(Object.keys(response.body).sort()).toEqual(
        ["items", "next_cursor", "as_of", "correlation_id"].sort(),
      );
      expect(
        response.body.items.map((item: { event_id: string }) => item.event_id),
      ).toEqual([live.id, eligible.id]);
      expect(
        response.body.items.map(
          (item: { event_state: string }) => item.event_state,
        ),
      ).toEqual(["LIVE", "PUBLISHED"]);
      for (const hidden of excluded)
        expect(JSON.stringify(response.body)).not.toContain(hidden.id);
      expect(Object.keys(response.body.items[0]).sort()).toEqual(
        listFields.sort(),
      );
      expect(response.body.items[0].availability.as_of).toBe(
        response.body.as_of,
      );
      const invalidCookie = await request(app)
        .get("/api/v1/discovery/events")
        .set("Cookie", "eoc_session=invalid")
        .set("Authorization", "Bearer invalid");
      expect(invalidCookie.status).toBe(200);
      expect(
        invalidCookie.body.items.map(
          (item: { event_id: string }) => item.event_id,
        ),
      ).toEqual([live.id, eligible.id]);
    });
    it("returns exact public detail fields and never exposes management relations or credentials", async () => {
      const record = await event();
      const gate = await db.gate.create({ data: { eventId: record.id } });
      await db.privateAccessLink.create({
        data: { eventId: record.id, verifierHash: "a".repeat(64) },
      });
      const staff = await db.user.create({ data: {} });
      await db.eventRoleAssignment.create({
        data: {
          eventId: record.id,
          userId: staff.id,
          role: "EVENT_ADMIN",
          scopeKey: "EVENT",
          grantedByUserId: ownerId,
        },
      });
      const response = await request(app).get(
        `/api/v1/discovery/events/${record.id.toUpperCase()}`,
      );
      expect(response.status).toBe(200);
      expect(Object.keys(response.body).sort()).toEqual(
        [...listFields, "description", "as_of", "correlation_id"].sort(),
      );
      expect(response.body).toMatchObject({
        event_id: record.id,
        event_state: "PUBLISHED",
        name: record.name,
        description: record.description,
        time_zone: record.timeZone,
        public_location: record.publicLocation,
        availability: { policy_status: "OPEN", reasons: [] },
      });
      for (const secret of [
        ownerId,
        staff.id,
        gate.id,
        "a".repeat(64),
        "registration_capacity",
        "revision",
        "readiness",
        "permitted_actions",
        "visibility",
        "checkout_enabled",
        "published_at",
        "audit",
        "occupancy",
      ])
        expect(JSON.stringify(response.body)).not.toContain(secret);
      expect(response.body.availability.as_of).toBe(response.body.as_of);
    });
    it("conceals guessed, PRIVATE, Draft and terminal events even for an owner", async () => {
      const hidden = [];
      for (const state of ["DRAFT", "COMPLETED", "CANCELLED"] as const)
        hidden.push((await event(state)).id);
      hidden.push(
        (await event("PUBLISHED", "PRIVATE")).id,
        (await event("LIVE", "PRIVATE")).id,
        randomUUID(),
        "malformed",
      );
      const session = await db.session.create({
        data: { userId: ownerId, expiresAt: new Date(Date.now() + 60_000) },
      });
      const token = await signAccountToken(
        ownerId,
        session.id,
        config.jwtSecret,
      );
      for (const id of hidden) {
        const response = await request(app)
          .get(`/api/v1/discovery/events/${id}`)
          .set("Cookie", `eoc_session=${token}`)
          .set("X-Correlation-ID", "public-unavailable-test");
        expect(response.status).toBe(404);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.body).toEqual({
          code: "EVENT_NOT_FOUND",
          message: "Event not found",
          correlation_id: "public-unavailable-test",
        });
      }
    });
    it("rechecks visibility and lifecycle on the next detail read and catalog continuation", async () => {
      const visible = await event("PUBLISHED", "PUBLIC", {
        publishedAt: new Date("2099-01-02T00:00:00Z"),
      });
      const next = await event("PUBLISHED", "PUBLIC", {
        publishedAt: new Date("2099-01-01T00:00:00Z"),
      });
      const first = await request(app).get("/api/v1/discovery/events?limit=1");
      expect(first.body.items[0].event_id).toBe(visible.id);
      expect(
        (await request(app).get(`/api/v1/discovery/events/${next.id}`)).status,
      ).toBe(200);
      await db.event.update({
        where: { id: next.id },
        data: { visibility: "PRIVATE" },
      });
      const continuation = await request(app)
        .get("/api/v1/discovery/events")
        .query({ limit: "100", cursor: first.body.next_cursor });
      expect(
        continuation.body.items.map(
          (item: { event_id: string }) => item.event_id,
        ),
      ).not.toContain(next.id);
      expect(
        (await request(app).get(`/api/v1/discovery/events/${next.id}`)).status,
      ).toBe(404);
      await db.event.update({
        where: { id: visible.id },
        data: { state: "LIVE" },
      });
      const live = await request(app).get(
        `/api/v1/discovery/events/${visible.id}`,
      );
      expect(live.status).toBe(200);
      expect(live.body.event_state).toBe("LIVE");
      expect(Object.keys(live.body).sort()).toEqual(
        [...listFields, "description", "as_of", "correlation_id"].sort(),
      );
      expect(
        (
          await request(app).get("/api/v1/discovery/events?limit=100")
        ).body.items.map((item: { event_id: string }) => item.event_id),
      ).toContain(visible.id);
      await db.event.update({
        where: { id: visible.id },
        data: { state: "COMPLETED" },
      });
      expect(
        (await request(app).get(`/api/v1/discovery/events/${visible.id}`))
          .status,
      ).toBe(404);
      expect(
        (
          await request(app).get("/api/v1/discovery/events?limit=100")
        ).body.items.map((item: { event_id: string }) => item.event_id),
      ).not.toContain(visible.id);
    });
    it("pages by publication time then descending ID, independent of creation order, and filters before paging", async () => {
      const stamp = new Date("2100-01-01T00:00:00Z"),
        fixtures = [];
      for (let index = 0; index < 22; index++)
        fixtures.push(
          await event("PUBLISHED", "PUBLIC", {
            publishedAt: stamp,
            createdAt: new Date(2000 + index, 0, 1),
          }),
        );
      await event("PUBLISHED", "PRIVATE", {
        publishedAt: new Date("2101-01-01T00:00:00Z"),
      });
      const first = await request(app).get("/api/v1/discovery/events");
      expect(first.body.items).toHaveLength(20);
      const ordered = fixtures
        .map((e) => e.id)
        .sort()
        .reverse();
      expect(
        first.body.items.map((item: { event_id: string }) => item.event_id),
      ).toEqual(ordered.slice(0, 20));
      const second = await request(app)
        .get("/api/v1/discovery/events")
        .query({ cursor: first.body.next_cursor, limit: "100" });
      expect(
        second.body.items
          .slice(0, 2)
          .map((item: { event_id: string }) => item.event_id),
      ).toEqual(ordered.slice(20));
      expect(second.body.next_cursor).toBeNull();
      expect(second.body).not.toHaveProperty("total_count");
    });
    it("handles legacy nullable publication boundaries without changing PUBLIC eligibility", async () => {
      const a = await event("PUBLISHED", "PUBLIC", { publishedAt: null });
      const b = await event("PUBLISHED", "PUBLIC", { publishedAt: null });
      const first = await request(app).get("/api/v1/discovery/events?limit=1");
      expect(first.body.items[0].event_id).toBe(
        [a.id, b.id].sort().reverse()[0],
      );
      const second = await request(app)
        .get("/api/v1/discovery/events")
        .query({ limit: "1", cursor: first.body.next_cursor });
      expect(second.body.items[0].event_id).toBe(
        [a.id, b.id].sort().reverse()[1],
      );
      const third = await request(app)
        .get("/api/v1/discovery/events")
        .query({ limit: "1", cursor: second.body.next_cursor });
      expect([a.id, b.id]).not.toContain(third.body.items[0].event_id);
    });
    it("rejects tampering, management cursors, unsupported filters and malformed pagination", async () => {
      const managementCursor = encodeEventCursor(
        {
          v: 1,
          actor: ownerId,
          view: "owned",
          created_at: new Date().toISOString(),
          event_id: randomUUID(),
        },
        config.jwtSecret,
      );
      for (const query of [
        { cursor: managementCursor },
        { cursor: "tampered" },
        { limit: "101" },
        { limit: "0" },
        { limit: "1.2" },
        { cursor: "" },
        { state: "DRAFT" },
        { visibility: "PRIVATE" },
        { owner_id: ownerId },
        { view: "owned" },
      ]) {
        const response = await request(app)
          .get("/api/v1/discovery/events")
          .query(query);
        expect(response.status).toBe(400);
        expect(response.body.code).toBe("VALIDATION");
        expect(response.body).not.toHaveProperty("items");
      }
      expect(
        (await request(app).get("/api/v1/discovery/events?limit=1&limit=2"))
          .status,
      ).toBe(400);
      expect(
        (
          await request(app).get(
            `/api/v1/discovery/events/${randomUUID()}?visibility=PRIVATE`,
          )
        ).status,
      ).toBe(400);
      expect((await request(app).get("/api/v1/discovery/private")).status).toBe(
        404,
      );
    });
    it("preserves all approved availability reasons and configured/default closing boundaries", async () => {
      for (const [configuration, reasons] of [
        [
          { registrationOpensAt: new Date("2200-01-01T00:00:00Z") },
          ["NOT_OPEN_YET"],
        ],
        [
          { registrationClosesAt: new Date("2000-01-01T00:00:00Z") },
          ["SCHEDULED_CLOSE_REACHED"],
        ],
        [{ registrationManuallyClosed: true }, ["MANUALLY_CLOSED"]],
        [
          {
            registrationClosesAt: null,
            startAt: new Date("2000-01-01T00:00:00Z"),
          },
          ["SCHEDULED_CLOSE_REACHED"],
        ],
        [
          {
            registrationManuallyClosed: true,
            registrationOpensAt: new Date("2200-01-01T00:00:00Z"),
          },
          ["NOT_OPEN_YET", "MANUALLY_CLOSED"],
        ],
      ] as const) {
        // Configured opening/closing must remain coherent under database checks.
        const record = await event("PUBLISHED", "PUBLIC", {
          ...configuration,
          ...(configuration.registrationOpensAt
            ? { registrationClosesAt: new Date("2200-01-02T00:00:00Z") }
            : {}),
        });
        const response = await request(app).get(
          `/api/v1/discovery/events/${record.id}`,
        );
        expect(response.status).toBe(200);
        expect(response.body.availability.reasons).toEqual(reasons);
        expect(response.body.availability.policy_status).toBe("CLOSED");
      }
    });
    it("fails closed on database errors without leaking event facts in errors or logs", async () => {
      const read = vi
        .spyOn(db.event, "findFirst")
        .mockRejectedValueOnce(new Error("secret-database-fact"));
      try {
        const response = await request(app).get(
          `/api/v1/discovery/events/${randomUUID()}`,
        );
        expect(response.status).toBe(503);
        expect(response.body).toMatchObject({
          code: "DEPENDENCY_UNAVAILABLE",
          message: "Service unavailable",
          retryable: true,
        });
        expect(JSON.stringify(response.body)).not.toContain("secret");
        expect(logs.join("")).not.toContain("secret-database-fact");
      } finally {
        read.mockRestore();
      }
      const list = vi
        .spyOn(db.event, "findMany")
        .mockRejectedValueOnce(new Error("secret-catalog-fact"));
      try {
        expect(
          (await request(app).get("/api/v1/discovery/events")).status,
        ).toBe(503);
      } finally {
        list.mockRestore();
      }
    });
  },
);
