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
  generatePrivateLinkProof,
  privateLinkKeys,
  privateLinkVerifier,
  replacePrivateAccessLink,
  revokePrivateAccessLink,
  lockEventForCommand,
} from "./private-links.js";
import { PROTECTED_REPLAY_RETENTION_MS } from "./command-safety.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)(
  "V8 issuance and PRIVATE bearer detail (PostgreSQL)",
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

    it("issues one protected proof, advances revision, audits, and returns only the approved owner result", async () => {
      const { owner, event } = await fixture();
      const response = await issue(owner, event.id).set(
        "Host",
        "attacker.example",
      );
      expect(response.status).toBe(201);
      expect(Object.keys(response.body).sort()).toEqual(
        [
          "event_id",
          "link_state",
          "access_url",
          "issued_at",
          "revision",
          "as_of",
          "correlation_id",
        ].sort(),
      );
      expect(response.body).toMatchObject({
        event_id: event.id,
        link_state: "ACTIVE",
        revision: 2,
      });
      expect(response.body.access_url).toMatch(
        /^http:\/\/127.0.0.1:5173\/private#access=[A-Za-z0-9_-]{43}$/,
      );
      expect(response.headers).toMatchObject({
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      });
      const link = await db.privateAccessLink.findFirstOrThrow({
        where: { eventId: event.id },
      });
      expect(link.verifierHash).toBe(
        privateLinkVerifier(
          proofOf(response),
          privateLinkKeys(config.contactKey).verifier,
        ),
      );
      expect(link.revokedAt).toBeNull();
      expect(link.replacesLinkId).toBeNull();
      const audit = await db.auditEvent.findFirstOrThrow({
        where: { eventId: event.id, action: "PRIVATE_LINK_ISSUED" },
      });
      expect(audit.metadata).toEqual({
        link_id: link.id,
        previous_revision: 1,
        revision: 2,
      });
    });
    it("allows anonymous bearer detail with the identical public allowlist and unchanged V6 availability", async () => {
      const { owner, event } = await fixture();
      const issued = await issue(owner, event.id);
      const response = await detail(proofOf(issued)).set(
        "Cookie",
        "eoc_session=invalid",
      );
      expect(response.status).toBe(200);
      expect(Object.keys(response.body).sort()).toEqual(
        [
          "event_id",
          "name",
          "event_state",
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
      expect(response.body.availability).toMatchObject({
        policy_status: "OPEN",
        reasons: [],
        opens_at: null,
        closes_at: "2030-01-01T14:00:00.000Z",
      });
      expect(response.headers).toMatchObject({
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      });
      expect(
        (await request(app).get(`/api/v1/discovery/events/${event.id}`)).status,
      ).toBe(404);
      for (const account of [owner, await actor(true)]) {
        const management = await request(app)
          .get(`/api/v1/events/${event.id}`)
          .set("Cookie", account.cookie);
        expect(JSON.stringify(management.body)).not.toContain(proofOf(issued));
        expect(JSON.stringify(management.body)).not.toContain("access_url");
      }
    });
    it("replays the original encrypted result before stale revision without a second proof/audit", async () => {
      const { owner, event } = await fixture(),
        key = randomUUID();
      const first = await issue(owner, event.id, 1, key),
        replay = await issue(owner, event.id, 1, key);
      expect(replay.status).toBe(201);
      expect(replay.body).toEqual(first.body);
      expect(
        await db.privateAccessLink.count({ where: { eventId: event.id } }),
      ).toBe(1);
      expect(
        await db.auditEvent.count({
          where: { eventId: event.id, action: "PRIVATE_LINK_ISSUED" },
        }),
      ).toBe(1);
      const row = await db.commandReplay.findFirstOrThrow({
        where: { resourceKey: event.id, action: "PRIVATE_LINK_ISSUE" },
      });
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
      expect(
        (await issue(owner, event.id, 1, key, { changed: true })).body.code,
      ).toBe("IDEMPOTENCY_CONFLICT");
    });
    it("settles concurrent identical issuance once and enforces different-key/version conflicts", async () => {
      const { owner, event } = await fixture(),
        key = randomUUID();
      const responses = await Promise.all([
        issue(owner, event.id, 1, key),
        issue(owner, event.id, 1, key),
      ]);
      expect(responses.map((r) => r.status)).toEqual([201, 201]);
      expect(responses[0]!.body).toEqual(responses[1]!.body);
      expect((await issue(owner, event.id, 1)).body.code).toBe(
        "VERSION_CONFLICT",
      );
      expect((await issue(owner, event.id, 2)).body.code).toBe(
        "LINK_ALREADY_ACTIVE",
      );
      const second = await fixture();
      const rivals = await Promise.all([
        issue(second.owner, second.event.id),
        issue(second.owner, second.event.id),
      ]);
      expect(rivals.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        await db.privateAccessLink.count({
          where: { eventId: second.event.id, revokedAt: null },
        }),
      ).toBe(1);
    });
    it("rejects Admin/participant/unrelated Organizer/unknown IDs without link mutation", async () => {
      const { owner, admin, event } = await fixture();
      expect((await issue(admin, event.id)).status).toBe(403);
      expect((await issue(await actor(), event.id)).status).toBe(404);
      expect((await issue(await actor(true), event.id)).status).toBe(404);
      expect((await issue(owner, randomUUID())).status).toBe(404);
      expect((await issue(owner, "guessed-id")).status).toBe(404);
      expect(
        await db.privateAccessLink.count({ where: { eventId: event.id } }),
      ).toBe(0);
    });
    it("requires session, origin/CSRF, quoted revision, key and exact body", async () => {
      const { owner, event } = await fixture();
      expect(
        (
          await request(app)
            .post(`/api/v1/events/${event.id}/private-link`)
            .send({})
        ).status,
      ).toBe(401);
      expect(
        (await issue(owner, event.id).set("X-CSRF-Token", "wrong")).body.code,
      ).toBe("CSRF_INVALID");
      expect(
        (await issue(owner, event.id).set("Origin", "https://attacker.test"))
          .status,
      ).toBe(403);
      expect((await issue(owner, event.id).set("If-Match", "1")).status).toBe(
        400,
      );
      expect(
        (await issue(owner, event.id).set("Idempotency-Key", "short")).status,
      ).toBe(400);
      expect(
        (
          await issue(owner, event.id, 1, randomUUID(), {
            proof: "client-secret",
          })
        ).status,
      ).toBe(400);
      expect(
        await db.privateAccessLink.count({ where: { eventId: event.id } }),
      ).toBe(0);
    });
    it.each(["DRAFT", "LIVE", "COMPLETED", "CANCELLED"] as EventState[])(
      "rejects issuance for %s",
      async (state) => {
        const { owner, event } = await fixture(state);
        expect((await issue(owner, event.id)).body.code).toBe(
          "WRONG_LIFECYCLE_STATE",
        );
      },
    );
    it("rejects PUBLIC Published issuance", async () => {
      const { owner, event } = await fixture("PUBLISHED", "PUBLIC");
      expect((await issue(owner, event.id)).status).toBe(422);
    });
    it("rechecks current capability and session before disclosing protected replay", async () => {
      const { owner, event } = await fixture(),
        key = randomUUID();
      await issue(owner, event.id, 1, key);
      await db.user.update({
        where: { id: owner.id },
        data: { organizerCapable: false },
      });
      const denied = await issue(owner, event.id, 1, key);
      expect(denied.status).toBe(404);
      expect(denied.body.access_url).toBeUndefined();
      await db.user.update({
        where: { id: owner.id },
        data: { organizerCapable: true },
      });
      await db.session.update({
        where: { id: owner.sessionId },
        data: { revokedAt: new Date() },
      });
      expect((await issue(owner, event.id, 1, key)).status).toBe(401);
    });
    it("expires protected replay after 24 hours while retaining the usable non-expiring link", async () => {
      const { owner, event } = await fixture(),
        key = randomUUID();
      const issued = await issue(owner, event.id, 1, key);
      await db.commandReplay.updateMany({
        where: { resourceKey: event.id },
        data: {
          createdAt: new Date(0),
          expiresAt: new Date(PROTECTED_REPLAY_RETENTION_MS),
          protectedReplayExpiresAt: new Date(PROTECTED_REPLAY_RETENTION_MS),
        },
      });
      expect((await issue(owner, event.id, 1, key)).body.code).toBe(
        "VERSION_CONFLICT",
      );
      expect(
        await db.commandReplay.count({ where: { resourceKey: event.id } }),
      ).toBe(0);
      await db.privateAccessLink.updateMany({
        where: { eventId: event.id },
        data: { issuedAt: new Date("2000-01-01T00:00:00Z") },
      });
      expect((await detail(proofOf(issued))).status).toBe(200);
    });
    it("fails closed on protected-response corruption without creating another link", async () => {
      const { owner, event } = await fixture(),
        key = randomUUID();
      const issued = await issue(owner, event.id, 1, key);
      await db.commandReplay.updateMany({
        where: { resourceKey: event.id },
        data: { protectedResponse: new Uint8Array([1, 2, 3]) },
      });
      expect((await issue(owner, event.id, 1, key)).status).toBe(503);
      expect((await detail(proofOf(issued))).status).toBe(200);
      expect(
        await db.privateAccessLink.count({ where: { eventId: event.id } }),
      ).toBe(1);
    });
    it("collapses missing/malformed/invalid proofs, query IDs and account-without-proof identically", async () => {
      const { owner, event } = await fixture();
      const issued = await issue(owner, event.id),
        baseline = await detail();
      for (const header of [
        "Bearer bad",
        `PrivateLink ${event.id}`,
        "PrivateLink short",
        `PrivateLink ${generatePrivateLinkProof()}`,
      ]) {
        const result = await detail().set("Authorization", header);
        expect(result.status).toBe(404);
        expect(result.body).toEqual(baseline.body);
      }
      expect((await detail().set("Cookie", owner.cookie)).body).toEqual(
        baseline.body,
      );
      expect(
        (await detail(proofOf(issued)).query({ event_id: event.id })).body,
      ).toEqual(baseline.body);
    });
    it("denies revoked and replaced proofs immediately using existing internal primitives only", async () => {
      const first = await fixture(),
        issued = await issue(first.owner, first.event.id),
        proof = proofOf(issued);
      await db.$transaction(async (tx) => {
        await lockEventForCommand(tx, first.event.id);
        await revokePrivateAccessLink(tx, first.event.id, new Date());
      });
      expect((await detail(proof)).body).toEqual((await detail()).body);
      const second = await fixture(),
        old = await issue(second.owner, second.event.id),
        replacement = generatePrivateLinkProof(),
        keys = privateLinkKeys(config.contactKey);
      await db.$transaction(async (tx) => {
        await lockEventForCommand(tx, second.event.id);
        await replacePrivateAccessLink(tx, {
          eventId: second.event.id,
          verifierHash: privateLinkVerifier(replacement, keys.verifier),
          verifierKeyVersion: 1,
          replacedAt: new Date(),
        });
      });
      expect((await detail(proofOf(old))).body).toEqual((await detail()).body);
      expect((await detail(replacement)).status).toBe(200);
    });
    it.each(["DRAFT", "LIVE", "COMPLETED", "CANCELLED"] as EventState[])(
      "conceals proof associated with %s on next read",
      async (state) => {
        const { owner, event } = await fixture();
        const issued = await issue(owner, event.id);
        await db.event.update({ where: { id: event.id }, data: { state } });
        expect((await detail(proofOf(issued))).body).toEqual(
          (await detail()).body,
        );
      },
    );
    it("atomically invalidates PRIVATE-to-PUBLIC proof and prevents visibility resurrection", async () => {
      const { owner, event } = await fixture();
      const issued = await issue(owner, event.id);
      async function visibility(value: string, revision: number) {
        return request(app)
          .patch(`/api/v1/events/${event.id}`)
          .set("Cookie", owner.cookie)
          .set("Origin", origin)
          .set("X-CSRF-Token", owner.csrf)
          .set("If-Match", `"${revision}"`)
          .send({ visibility: value });
      }
      expect((await visibility("PUBLIC", 2)).status).toBe(200);
      expect((await detail(proofOf(issued))).status).toBe(404);
      expect((await visibility("PRIVATE", 3)).status).toBe(200);
      expect((await detail(proofOf(issued))).status).toBe(404);
    });
    it("rolls back verifier/revision/encrypted replay on audit failure and fails closed on dependency errors", async () => {
      const { owner, event } = await fixture(),
        suffix = randomUUID().replaceAll("-", ""),
        fn = `v8_audit_${suffix}`,
        trigger = `v8_trigger_${suffix}`;
      await db.$executeRawUnsafe(
        `CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."correlationId" = 'v8-force-audit-failure' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END; $$`,
      );
      await db.$executeRawUnsafe(
        `CREATE TRIGGER "${trigger}" BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`,
      );
      try {
        expect(
          (
            await issue(owner, event.id).set(
              "X-Correlation-ID",
              "v8-force-audit-failure",
            )
          ).status,
        ).toBe(503);
        expect(
          await db.privateAccessLink.count({ where: { eventId: event.id } }),
        ).toBe(0);
        expect(
          await db.commandReplay.count({ where: { resourceKey: event.id } }),
        ).toBe(0);
        expect(
          (await db.event.findUniqueOrThrow({ where: { id: event.id } }))
            .revision,
        ).toBe(1);
      } finally {
        await db.$executeRawUnsafe(`DROP TRIGGER "${trigger}" ON "AuditEvent"`);
        await db.$executeRawUnsafe(`DROP FUNCTION "${fn}"()`);
      }
      const spy = vi
        .spyOn(db.privateAccessLink, "findFirst")
        .mockRejectedValueOnce(new Error("secret database failure"));
      try {
        const result = await detail(generatePrivateLinkProof());
        expect(result.status).toBe(503);
        expect(JSON.stringify(result.body)).not.toContain("secret");
      } finally {
        spy.mockRestore();
      }
    });
    it("never logs or audits the raw proof, access URL or bearer header", async () => {
      const { owner, event } = await fixture(),
        issued = await issue(owner, event.id),
        proof = proofOf(issued);
      await detail(proof);
      await detail(proof).query({ access: proof });
      const audit = await db.auditEvent.findMany({
        where: { eventId: event.id },
      });
      expect(JSON.stringify(audit)).not.toContain(proof);
      expect(logs.join("")).not.toContain(proof);
      expect(logs.join("")).not.toContain(issued.body.access_url);
    });
    it("requires CSRF on standalone revoke/reissue routes", async () => {
      const { owner, event } = await fixture();
      for (const suffix of ["revoke", "reissue"]) {
        expect(
          (
            await request(app)
              .post(`/api/v1/events/${event.id}/private-link/${suffix}`)
              .set("Cookie", owner.cookie)
              .send({})
          ).status,
        ).toBe(403);
      }
    });
  },
);
