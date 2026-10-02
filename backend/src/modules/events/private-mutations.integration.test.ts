import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import type { EventState } from "@prisma/client";
import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { createDatabase } from "../../config/database.js";
import { createLogger } from "../../config/logger.js";
import { OtpService } from "../auth/otp.js";
import { csrfToken, signAccountToken } from "../auth/tokens.js";
import {
  privateLinkKeys,
  privateLinkVerifier,
  lockEventForCommand,
} from "./private-links.js";
import {
  COMMAND_REPLAY_RETENTION_MS,
  PROTECTED_REPLAY_RETENTION_MS,
} from "./command-safety.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)(
  "V9 standalone private-link commands (PostgreSQL)",
  () => {
    const db = createDatabase(databaseUrl ?? "");
    const config = {
      databaseUrl: databaseUrl ?? "",
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
      state: EventState = "PUBLISHED",
      visibility: "PRIVATE" | "PUBLIC" = "PRIVATE",
    ) {
      const owner = await actor(true),
        admin = await actor();
      const event = await db.event.create({
        data: {
          ownerUserId: owner.id,
          name: "Controlled conference",
          description: "Private public-field description",
          publicLocation: "City hall",
          state,
          visibility,
          startAt: new Date("2030-01-01T10:00:00Z"),
          endAt: new Date("2030-01-01T12:00:00Z"),
          timeZone: "Asia/Kolkata",
          registrationCapacity: 50,
          registrationClosesAt: new Date("2030-01-01T14:00:00Z"),
        },
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
      return { owner, admin, event };
    }
    function issue(
      account: Awaited<ReturnType<typeof actor>>,
      id: string,
      revision = 1,
      key = randomUUID(),
      body: unknown = {},
    ) {
      return request(app)
        .post(`/api/v1/events/${id}/private-link`)
        .set("Cookie", account.cookie)
        .set("Origin", origin)
        .set("X-CSRF-Token", account.csrf)
        .set("If-Match", `"${revision}"`)
        .set("Idempotency-Key", key)
        .send(body as object);
    }
    const proofOf = (response: { body: { access_url: string } }) =>
      new URL(response.body.access_url).hash.slice("#access=".length);
    function detail(proof?: string) {
      const req = request(app)
        .get("/api/v1/discovery/private")
        .set("X-Correlation-ID", "v8-safe-detail");
      return proof ? req.set("Authorization", `PrivateLink ${proof}`) : req;
    }
    afterAll(async () => {
      await db.$disconnect();
    });

    function command(
      operation: "reissue" | "revoke",
      account: Awaited<ReturnType<typeof actor>>,
      id: string,
      revision = 2,
      key = randomUUID(),
      body: unknown = {},
    ) {
      return request(app)
        .post(`/api/v1/events/${id}/private-link/${operation}`)
        .set("Cookie", account.cookie)
        .set("Origin", origin)
        .set("X-CSRF-Token", account.csrf)
        .set("If-Match", `"${revision}"`)
        .set("Idempotency-Key", key)
        .send(body as object);
    }
    async function activeFixture() {
      const f = await fixture();
      const issued = await issue(f.owner, f.event.id);
      expect(issued.status).toBe(201);
      return { ...f, issued };
    }
    it("atomically replaces the proof, records lineage and returns only approved fields", async () => {
      const { owner, event, issued } = await activeFixture();
      const before = await db.privateAccessLink.findFirstOrThrow({
        where: { eventId: event.id },
      });
      const result = await command("reissue", owner, event.id).set(
        "Host",
        "attacker.test",
      );
      expect(result.status).toBe(200);
      expect(Object.keys(result.body).sort()).toEqual(
        [
          "event_id",
          "link_state",
          "access_url",
          "issued_at",
          "previous_revoked_at",
          "revision",
          "as_of",
          "correlation_id",
        ].sort(),
      );
      expect(result.body).toMatchObject({
        event_id: event.id,
        link_state: "ACTIVE",
        revision: 3,
      });
      expect(result.body.access_url).toMatch(
        /^http:\/\/127\.0\.0\.1:5173\/private#access=[A-Za-z0-9_-]{43}$/,
      );
      expect(proofOf(result)).not.toBe(proofOf(issued));
      expect(result.headers).toMatchObject({
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      });
      const current = await db.privateAccessLink.findFirstOrThrow({
        where: { eventId: event.id, revokedAt: null },
      });
      const old = await db.privateAccessLink.findUniqueOrThrow({
        where: { id: before.id },
      });
      expect(current.replacesLinkId).toBe(before.id);
      expect(old.revokedAt!.toISOString()).toBe(
        result.body.previous_revoked_at,
      );
      expect(current.issuedAt.toISOString()).toBe(result.body.issued_at);
      expect(current.verifierHash).toBe(
        privateLinkVerifier(
          proofOf(result),
          privateLinkKeys(config.contactKey).verifier,
        ),
      );
      expect((await detail(proofOf(issued))).status).toBe(404);
      const bearer = await detail(proofOf(result));
      expect(bearer.status).toBe(200);
      expect(Object.keys(bearer.body).sort()).toEqual(
        [
          "event_id",
          "name",
          "description",
          "start_at",
          "end_at",
          "time_zone",
          "public_location",
          "image_url",
          "category",
          "tags",
          "availability",
          "as_of",
          "correlation_id",
        ].sort(),
      );
      expect(bearer.body.availability.policy_status).toBe("OPEN");
      const audit = await db.auditEvent.findFirstOrThrow({
        where: { eventId: event.id, action: "PRIVATE_LINK_REISSUED" },
      });
      expect(audit.metadata).toEqual({
        link_id: current.id,
        previous_link_id: old.id,
        previous_revision: 2,
        revision: 3,
      });
      expect(JSON.stringify(audit)).not.toContain(proofOf(result));
      expect(logs.join("")).not.toContain(proofOf(result));
    });
    it("revokes immediately with the exact secret-free result and safe audit", async () => {
      const { owner, event, issued } = await activeFixture();
      const result = await command("revoke", owner, event.id);
      expect(result.status).toBe(200);
      expect(Object.keys(result.body).sort()).toEqual(
        [
          "event_id",
          "link_state",
          "revoked_at",
          "revision",
          "as_of",
          "correlation_id",
        ].sort(),
      );
      expect(result.body).toMatchObject({
        event_id: event.id,
        link_state: "REVOKED",
        revision: 3,
      });
      expect(result.headers).toMatchObject({
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      });
      expect((await detail(proofOf(issued))).body).toEqual(
        (await detail()).body,
      );
      expect(
        await db.privateAccessLink.count({
          where: { eventId: event.id, revokedAt: null },
        }),
      ).toBe(0);
      const audit = await db.auditEvent.findFirstOrThrow({
        where: { eventId: event.id, action: "PRIVATE_LINK_REVOKED" },
      });
      expect(JSON.stringify(audit)).not.toContain(proofOf(issued));
      expect(audit.metadata).toMatchObject({
        previous_revision: 2,
        revision: 3,
      });
    });
    it.each(["reissue", "revoke"] as const)(
      "replays %s exactly before stale revision and rejects changed body",
      async (operation) => {
        const { owner, event } = await activeFixture(),
          key = randomUUID();
        const first = await command(operation, owner, event.id, 2, key);
        const replay = await command(operation, owner, event.id, 2, key);
        expect(replay.status).toBe(200);
        expect(replay.body).toEqual(first.body);
        expect(
          (await command(operation, owner, event.id, 2, key, { changed: true }))
            .body.code,
        ).toBe("IDEMPOTENCY_CONFLICT");
        expect(
          await db.auditEvent.count({
            where: {
              eventId: event.id,
              action:
                operation === "reissue"
                  ? "PRIVATE_LINK_REISSUED"
                  : "PRIVATE_LINK_REVOKED",
            },
          }),
        ).toBe(1);
        const row = await db.commandReplay.findFirstOrThrow({
          where: {
            resourceKey: event.id,
            action: `PRIVATE_LINK_${operation.toUpperCase()}`,
          },
        });
        if (operation === "reissue") {
          expect(row.responseBody).toBeNull();
          expect(row.protectedResponseKeyVersion).toBe(1);
          expect(
            row.protectedReplayExpiresAt!.getTime() - row.createdAt.getTime(),
          ).toBe(PROTECTED_REPLAY_RETENTION_MS);
          expect(
            Buffer.from(row.protectedResponse!).includes(
              Buffer.from(first.body.access_url),
            ),
          ).toBe(false);
        } else {
          expect(row.protectedResponse).toBeNull();
          expect(row.responseBody).toEqual(first.body);
          expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(
            COMMAND_REPLAY_RETENTION_MS,
          );
        }
      },
    );
    it.each(["reissue", "revoke"] as const)(
      "settles concurrent same-key %s exactly once",
      async (operation) => {
        const { owner, event } = await activeFixture(),
          key = randomUUID();
        const results = await Promise.all([
          command(operation, owner, event.id, 2, key),
          command(operation, owner, event.id, 2, key),
        ]);
        expect(results.map((r) => r.status)).toEqual([200, 200]);
        expect(results[0]!.body).toEqual(results[1]!.body);
        expect(
          (await db.event.findUniqueOrThrow({ where: { id: event.id } }))
            .revision,
        ).toBe(3);
        expect(
          await db.privateAccessLink.count({
            where: { eventId: event.id, revokedAt: null },
          }),
        ).toBe(operation === "reissue" ? 1 : 0);
        expect(
          await db.privateAccessLink.count({ where: { eventId: event.id } }),
        ).toBe(operation === "reissue" ? 2 : 1);
      },
    );
    it.each([
      ["reissue", "reissue"],
      ["revoke", "revoke"],
      ["reissue", "revoke"],
    ] as const)(
      "serializes competing %s/%s with one revision winner",
      async (a, b) => {
        const { owner, event, issued } = await activeFixture();
        const results = await Promise.all([
          command(a, owner, event.id),
          command(b, owner, event.id),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
        expect(results.find((r) => r.status === 409)!.body.code).toBe(
          "VERSION_CONFLICT",
        );
        expect(
          await db.privateAccessLink.count({
            where: { eventId: event.id, revokedAt: null },
          }),
        ).toBe(
          results.find((r) => r.status === 200)!.body.link_state === "ACTIVE"
            ? 1
            : 0,
        );
        expect((await detail(proofOf(issued))).status).toBe(404);
      },
    );
    it.each(["reissue", "revoke"] as const)(
      "requires active link for %s without audit/replay/revision change",
      async (operation) => {
        const { owner, event } = await fixture();
        expect((await command(operation, owner, event.id, 1)).body.code).toBe(
          "LINK_NOT_ACTIVE",
        );
        expect(
          (await db.event.findUniqueOrThrow({ where: { id: event.id } }))
            .revision,
        ).toBe(1);
        expect(
          await db.commandReplay.count({ where: { resourceKey: event.id } }),
        ).toBe(0);
        expect(
          await db.privateAccessLink.count({ where: { eventId: event.id } }),
        ).toBe(0);
      },
    );
    it.each(["reissue", "revoke"] as const)(
      "denies Admin, unrelated accounts and guessed IDs for %s",
      async (operation) => {
        const { owner, admin, event } = await activeFixture();
        expect((await command(operation, admin, event.id)).status).toBe(403);
        expect((await command(operation, await actor(), event.id)).status).toBe(
          404,
        );
        expect(
          (await command(operation, await actor(true), event.id)).status,
        ).toBe(404);
        expect((await command(operation, owner, randomUUID())).status).toBe(
          404,
        );
        expect((await command(operation, owner, "guessed-id")).status).toBe(
          404,
        );
        expect(
          (await db.event.findUniqueOrThrow({ where: { id: event.id } }))
            .revision,
        ).toBe(2);
        expect(
          await db.privateAccessLink.count({
            where: { eventId: event.id, revokedAt: null },
          }),
        ).toBe(1);
      },
    );
    it.each(["reissue", "revoke"] as const)(
      "enforces session/CSRF/origin/preconditions/exact body for %s",
      async (operation) => {
        const { owner, event } = await activeFixture();
        expect(
          (
            await request(app)
              .post(`/api/v1/events/${event.id}/private-link/${operation}`)
              .send({})
          ).status,
        ).toBe(401);
        expect(
          (
            await command(operation, owner, event.id).set(
              "X-CSRF-Token",
              "wrong",
            )
          ).status,
        ).toBe(403);
        expect(
          (
            await command(operation, owner, event.id).set(
              "Origin",
              "https://attacker.test",
            )
          ).status,
        ).toBe(403);
        expect(
          (await command(operation, owner, event.id).set("If-Match", "2"))
            .status,
        ).toBe(400);
        expect(
          (
            await command(operation, owner, event.id).set(
              "Idempotency-Key",
              "short",
            )
          ).status,
        ).toBe(400);
        expect(
          (
            await command(operation, owner, event.id, 2, randomUUID(), {
              access_url: "client",
            })
          ).status,
        ).toBe(400);
        expect((await command(operation, owner, event.id, 1)).body.code).toBe(
          "VERSION_CONFLICT",
        );
        expect(
          (await db.event.findUniqueOrThrow({ where: { id: event.id } }))
            .revision,
        ).toBe(2);
      },
    );
    it.each(["DRAFT", "LIVE", "COMPLETED", "CANCELLED"] as EventState[])(
      "denies both commands and bearer after leaving Published for %s",
      async (state) => {
        const { owner, event, issued } = await activeFixture();
        await db.event.update({ where: { id: event.id }, data: { state } });
        for (const operation of ["reissue", "revoke"] as const)
          expect((await command(operation, owner, event.id)).body.code).toBe(
            "WRONG_LIFECYCLE_STATE",
          );
        expect((await detail(proofOf(issued))).body).toEqual(
          (await detail()).body,
        );
      },
    );
    it("denies PUBLIC and never reveals PRIVATE metadata to Admin", async () => {
      const { owner, event, admin } = await activeFixture();
      const before = (
        await request(app)
          .get(`/api/v1/events/${event.id}`)
          .set("Cookie", admin.cookie)
      ).body;
      await command("reissue", owner, event.id);
      const after = (
        await request(app)
          .get(`/api/v1/events/${event.id}`)
          .set("Cookie", admin.cookie)
      ).body;
      expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
      expect(JSON.stringify(after)).not.toMatch(
        /access_url|verifier|replacesLink|private_link/,
      );
      await db.event.update({
        where: { id: event.id },
        data: { visibility: "PUBLIC" },
      });
      for (const operation of ["reissue", "revoke"] as const)
        expect((await command(operation, owner, event.id, 3)).body.code).toBe(
          "WRONG_LIFECYCLE_STATE",
        );
    });
    it.each(["reissue", "revoke"] as const)(
      "rechecks current Organizer capability and session before %s replay",
      async (operation) => {
        const { owner, event } = await activeFixture(),
          key = randomUUID();
        await command(operation, owner, event.id, 2, key);
        await db.user.update({
          where: { id: owner.id },
          data: { organizerCapable: false },
        });
        const denied = await command(operation, owner, event.id, 2, key);
        expect(denied.status).toBe(404);
        expect(denied.body.access_url).toBeUndefined();
        await db.user.update({
          where: { id: owner.id },
          data: { organizerCapable: true },
        });
        const unrelated = await actor(true);
        const otherReplay = await command(
          operation,
          unrelated,
          event.id,
          2,
          key,
        );
        expect(otherReplay.status).toBe(404);
        expect(otherReplay.body.access_url).toBeUndefined();
        await db.session.update({
          where: { id: owner.sessionId },
          data: { revokedAt: new Date() },
        });
        expect((await command(operation, owner, event.id, 2, key)).status).toBe(
          401,
        );
      },
    );
    it("never resurrects old proof when replaying replaced/revoked reissue results", async () => {
      const { owner, event, issued } = await activeFixture(),
        key = randomUUID();
      const first = await command("reissue", owner, event.id, 2, key);
      const second = await command("reissue", owner, event.id, 3);
      expect((await command("reissue", owner, event.id, 2, key)).body).toEqual(
        first.body,
      );
      expect((await detail(proofOf(first))).status).toBe(404);
      expect((await detail(proofOf(second))).status).toBe(200);
      await command("revoke", owner, event.id, 4);
      expect((await command("reissue", owner, event.id, 2, key)).body).toEqual(
        first.body,
      );
      for (const response of [issued, first, second])
        expect((await detail(proofOf(response))).status).toBe(404);
      expect(
        await db.privateAccessLink.count({
          where: { eventId: event.id, revokedAt: null },
        }),
      ).toBe(0);
    });
    it("replays revoke without revoking a subsequently issued link", async () => {
      const { owner, event } = await activeFixture(),
        key = randomUUID();
      const revoked = await command("revoke", owner, event.id, 2, key);
      const newlyIssued = await issue(owner, event.id, 3);
      expect(newlyIssued.status).toBe(201);
      const replay = await command("revoke", owner, event.id, 2, key);
      expect(replay.body).toEqual(revoked.body);
      expect((await detail(proofOf(newlyIssued))).status).toBe(200);
      expect(
        (await db.event.findUniqueOrThrow({ where: { id: event.id } }))
          .revision,
      ).toBe(4);
    });
    it("denies protected replay if Organizer capability is removed while waiting for the event lock", async () => {
      const { owner, event } = await activeFixture(),
        key = randomUUID();
      await command("reissue", owner, event.id, 2, key);
      let release!: () => void, locked!: () => void, authenticated!: () => void;
      const releasePromise = new Promise<void>((resolve) => {
        release = resolve;
      });
      const lockedPromise = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const authenticatedPromise = new Promise<void>((resolve) => {
        authenticated = resolve;
      });
      const held = db.$transaction(async (tx) => {
        await lockEventForCommand(tx, event.id);
        locked();
        await releasePromise;
      });
      await lockedPromise;
      const original = db.session.findUnique.bind(db.session);
      const spy = vi
        .spyOn(db.session, "findUnique")
        .mockImplementationOnce((args) => {
          const session = original(args);
          void session.then(() => authenticated());
          return session;
        });
      const replay = command("reissue", owner, event.id, 2, key).then(
        (response) => response,
      );
      try {
        await authenticatedPromise;
        await db.user.update({
          where: { id: owner.id },
          data: { organizerCapable: false },
        });
        release();
        await held;
        const denied = await replay;
        expect(denied.status).toBe(404);
        expect(denied.body.access_url).toBeUndefined();
        expect(
          (await db.event.findUniqueOrThrow({ where: { id: event.id } }))
            .revision,
        ).toBe(3);
      } finally {
        release();
        await held;
        spy.mockRestore();
      }
    });
    it("expires protected replay at 24h without expiring the active proof", async () => {
      const { owner, event } = await activeFixture(),
        key = randomUUID();
      const result = await command("reissue", owner, event.id, 2, key);
      await db.commandReplay.updateMany({
        where: { resourceKey: event.id, action: "PRIVATE_LINK_REISSUE" },
        data: {
          createdAt: new Date(0),
          expiresAt: new Date(PROTECTED_REPLAY_RETENTION_MS),
          protectedReplayExpiresAt: new Date(PROTECTED_REPLAY_RETENTION_MS),
        },
      });
      expect(
        (await command("reissue", owner, event.id, 2, key)).body.code,
      ).toBe("VERSION_CONFLICT");
      await db.privateAccessLink.updateMany({
        where: { eventId: event.id, revokedAt: null },
        data: { issuedAt: new Date(0) },
      });
      expect((await detail(proofOf(result))).status).toBe(200);
    });
    it("fails closed on corrupt protected reissue replay", async () => {
      const { owner, event } = await activeFixture(),
        key = randomUUID();
      const result = await command("reissue", owner, event.id, 2, key);
      await db.commandReplay.updateMany({
        where: { resourceKey: event.id, action: "PRIVATE_LINK_REISSUE" },
        data: { protectedResponse: new Uint8Array([1, 2, 3]) },
      });
      expect((await command("reissue", owner, event.id, 2, key)).status).toBe(
        503,
      );
      expect((await detail(proofOf(result))).status).toBe(200);
      expect(
        await db.privateAccessLink.count({ where: { eventId: event.id } }),
      ).toBe(2);
    });
    it.each(["reissue", "revoke"] as const)(
      "rolls back %s, revision, lineage and replay when required audit fails",
      async (operation) => {
        const { owner, event, issued } = await activeFixture(),
          suffix = randomUUID().replaceAll("-", ""),
          fn = `v9_audit_${suffix}`,
          trigger = `v9_trigger_${suffix}`,
          correlation = `v9-failure-${suffix}`;
        await db.$executeRawUnsafe(
          `CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."correlationId" = '${correlation}' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END; $$`,
        );
        await db.$executeRawUnsafe(
          `CREATE TRIGGER "${trigger}" BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`,
        );
        try {
          const failed = await command(operation, owner, event.id).set(
            "X-Correlation-ID",
            correlation,
          );
          expect(failed.status).toBe(503);
          expect(failed.body.access_url).toBeUndefined();
          expect(
            await db.privateAccessLink.count({ where: { eventId: event.id } }),
          ).toBe(1);
          expect(
            await db.privateAccessLink.count({
              where: { eventId: event.id, revokedAt: null },
            }),
          ).toBe(1);
          expect(
            (await db.event.findUniqueOrThrow({ where: { id: event.id } }))
              .revision,
          ).toBe(2);
          expect(
            await db.commandReplay.count({
              where: {
                resourceKey: event.id,
                action: `PRIVATE_LINK_${operation.toUpperCase()}`,
              },
            }),
          ).toBe(0);
          expect((await detail(proofOf(issued))).status).toBe(200);
        } finally {
          await db.$executeRawUnsafe(
            `DROP TRIGGER "${trigger}" ON "AuditEvent"`,
          );
          await db.$executeRawUnsafe(`DROP FUNCTION "${fn}"()`);
        }
      },
    );
    it.each(["PUBLIC", "LIVE"] as const)(
      "serializes reissue against %s change without proof resurrection",
      async (target) => {
        const { owner, event, issued } = await activeFixture();
        await db.gate.create({ data: { eventId: event.id } });
        const edit = request(app)
          [target === "PUBLIC" ? "patch" : "post"](
            `/api/v1/events/${event.id}${target === "PUBLIC" ? "" : "/transitions"}`,
          )
          .set("Cookie", owner.cookie)
          .set("Origin", origin)
          .set("X-CSRF-Token", owner.csrf)
          .set("If-Match", '"2"')
          .set("Idempotency-Key", randomUUID())
          .send(
            target === "PUBLIC"
              ? { visibility: "PUBLIC" }
              : { target_state: "LIVE" },
          );
        const results = await Promise.all([
          command("reissue", owner, event.id),
          edit,
        ]);
        expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
        if (results[1]!.status === 409) {
          const follow = request(app)
            [target === "PUBLIC" ? "patch" : "post"](
              `/api/v1/events/${event.id}${target === "PUBLIC" ? "" : "/transitions"}`,
            )
            .set("Cookie", owner.cookie)
            .set("Origin", origin)
            .set("X-CSRF-Token", owner.csrf)
            .set("If-Match", '"3"')
            .set("Idempotency-Key", randomUUID())
            .send(
              target === "PUBLIC"
                ? { visibility: "PUBLIC" }
                : { target_state: "LIVE" },
            );
          expect((await follow).status).toBe(200);
        }
        expect((await detail(proofOf(issued))).status).toBe(404);
        if (results[0]!.status === 200)
          expect((await detail(proofOf(results[0]!))).status).toBe(404);
      },
    );
  },
);
