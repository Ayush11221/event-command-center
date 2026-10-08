import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { ContactType, Prisma, ProofPurpose } from "@prisma/client";
import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { createDatabase } from "../../config/database.js";
import { createLogger } from "../../config/logger.js";
import type { FoundationConfig } from "../../config/foundation.js";
import { OtpService } from "./otp.js";
import { normalizeContact } from "./contact.js";
import { ABSOLUTE_MS, IDLE_MS, renewalHash } from "./sessions.js";
import { csrfToken, signAccountToken, verifyAccountToken } from "./tokens.js";
import { provisionAccount } from "./provision.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const origin = "https://event-command-center.vercel.app";
const config: FoundationConfig = {
  databaseUrl: databaseUrl ?? "",
  jwtSecret: Buffer.alloc(32, 11),
  contactKey: Buffer.alloc(32, 12),
  otpKey: Buffer.alloc(32, 13),
  cookieSecure: true,
};

describe.skipIf(!databaseUrl)(
  "renewable sessions and public verified-email accounts",
  () => {
    const db = createDatabase(databaseUrl ?? "");
    const codes = new Map<string, string>();
    const otp = new OtpService(db, config, {
      available: () => true,
      async send(_type, email, code) {
        codes.set(email, code);
      },
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
    const email = () => `p0-${randomUUID()}@example.test`;
    const lookup = (contact: string) =>
      normalizeContact(ContactType.EMAIL, contact, config.contactKey)
        .lookupHash;
    const cookies = (headers: Record<string, unknown>) =>
      (headers["set-cookie"] as string[]).map((value) => value.split(";")[0]);
    const cookieValue = (values: string[], name: string) =>
      values
        .find((value) => value.startsWith(`${name}=`))!
        .slice(name.length + 1);

    async function challenge(contact: string) {
      const response = await request(app)
        .post("/api/v1/auth/account/challenge")
        .set("Origin", origin)
        .send({ type: "EMAIL", contact });
      expect(response.status).toBe(202);
      await vi.waitFor(async () => {
        const row = await db.otpChallenge.findFirst({
          where: { contactLookupHash: lookup(contact) },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
        expect(row?.deliveredAt).toBeTruthy();
      });
      return response;
    }
    function verify(contact: string, extra: Record<string, unknown> = {}) {
      return request(app)
        .post("/api/v1/auth/account/verify")
        .set("Origin", origin)
        .send({
          type: "EMAIL",
          contact,
          code: codes.get(contact.trim().toLowerCase()),
          ...extra,
        });
    }
    async function login(contact = email()) {
      await challenge(contact);
      const response = await verify(contact);
      expect(response.status).toBe(200);
      const jar = cookies(response.headers);
      const claims = await verifyAccountToken(
        cookieValue(jar, "eoc_session"),
        config.jwtSecret,
      );
      return {
        ...claims,
        jar,
        renewal: cookieValue(jar, "eoc_renewal"),
        csrf: csrfToken(claims.sessionId, config.jwtSecret),
        response,
        contact,
      };
    }
    function refresh(jar: string[], csrf: string) {
      return request(app)
        .post("/api/v1/auth/account/refresh")
        .set("Origin", origin)
        .set("Cookie", jar)
        .set("X-CSRF-Token", csrf);
    }
    afterAll(() => db.$disconnect());

    it("does not create an account before verified ownership, then atomically creates ordinary identity and renewable authority", async () => {
      const contact = email();
      await challenge(contact);
      expect(
        await db.verifiedContact.findUnique({
          where: {
            type_lookupHash: { type: "EMAIL", lookupHash: lookup(contact) },
          },
        }),
      ).toBeNull();
      const wrong = await request(app)
        .post("/api/v1/auth/account/verify")
        .set("Origin", origin)
        .send({
          type: "EMAIL",
          contact,
          code: codes.get(contact) === "000000" ? "111111" : "000000",
        });
      expect(wrong.status).toBe(401);
      expect(
        await db.verifiedContact.count({
          where: { lookupHash: lookup(contact) },
        }),
      ).toBe(0);
      const result = await verify(contact);
      expect(result.status).toBe(200);
      const linked = await db.verifiedContact.findUniqueOrThrow({
        where: {
          type_lookupHash: { type: "EMAIL", lookupHash: lookup(contact) },
        },
        include: { user: { include: { sessions: true, assignments: true } } },
      });
      expect(linked.user.organizerCapable).toBe(false);
      expect(linked.user.assignments).toEqual([]);
      expect(linked.encrypted).not.toContain(contact);
      const session = linked.user.sessions[0];
      expect(
        session.absoluteExpiresAt!.getTime() - session.createdAt.getTime(),
      ).toBe(ABSOLUTE_MS);
      expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBe(
        IDLE_MS,
      );
      const renewal = cookieValue(cookies(result.headers), "eoc_renewal");
      expect(session.renewalHash).toBe(renewalHash(renewal, config.jwtSecret));
      expect(session.renewalHash).not.toContain(renewal);
      expect((await verify(contact)).status).toBe(401);
      expect(await db.session.count({ where: { userId: linked.userId } })).toBe(
        1,
      );
    });

    it("normalizes identity and logs an existing account into the same session model without duplicates", async () => {
      const contact = email();
      const userId = await provisionAccount(
        db,
        config,
        "EMAIL",
        contact,
        true,
        randomUUID(),
      );
      const auth = await login(` ${contact.toUpperCase()} `);
      expect(auth.userId).toBe(userId);
      expect(
        await db.verifiedContact.count({
          where: { lookupHash: lookup(contact) },
        }),
      ).toBe(1);
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: userId } }))
          .organizerCapable,
      ).toBe(true);
      expect(
        (await db.session.findUniqueOrThrow({ where: { id: auth.sessionId } }))
          .renewalHash,
      ).toBeTruthy();
    });

    it.each([
      "organizerCapable",
      "isAdmin",
      "role",
      "permissions",
      "eventAssignments",
      "gateAssignments",
      "volunteerAssignments",
    ])(
      "rejects privileged public input %s on challenge and verification",
      async (field) => {
        const contact = email();
        expect(
          (
            await request(app)
              .post("/api/v1/auth/account/challenge")
              .set("Origin", origin)
              .send({ type: "EMAIL", contact, [field]: true })
          ).status,
        ).toBe(400);
        await challenge(contact);
        expect((await verify(contact, { [field]: true })).status).toBe(400);
        expect(
          await db.verifiedContact.count({
            where: { lookupHash: lookup(contact) },
          }),
        ).toBe(0);
      },
    );

    it("settles simultaneous signup verification without duplicate users or sessions", async () => {
      const contact = email();
      await challenge(contact);
      const results = await Promise.all([verify(contact), verify(contact)]);
      expect(results.map((response) => response.status).sort()).toEqual([
        200, 401,
      ]);
      const linked = await db.verifiedContact.findUniqueOrThrow({
        where: {
          type_lookupHash: { type: "EMAIL", lookupHash: lookup(contact) },
        },
      });
      expect(await db.session.count({ where: { userId: linked.userId } })).toBe(
        1,
      );
    });

    it("recovers expired access using separate renewal and rotates atomically", async () => {
      const auth = await login();
      const expired = await signAccountToken(
        auth.userId,
        auth.sessionId,
        config.jwtSecret,
        new Date(Date.now() - 16 * 60_000),
      );
      expect(
        (
          await request(app)
            .get("/api/v1/auth/me")
            .set("Cookie", `eoc_session=${expired}`)
        ).status,
      ).toBe(401);
      const bootstrap = await request(app)
        .get("/api/v1/auth/account/session")
        .set("Cookie", `eoc_renewal=${auth.renewal}`);
      expect(bootstrap.status).toBe(200);
      expect(Object.keys(bootstrap.body)).toEqual(["csrf_token"]);
      const result = await refresh(
        [`eoc_renewal=${auth.renewal}`],
        bootstrap.body.csrf_token,
      );
      expect(result.status).toBe(200);
      const next = cookieValue(cookies(result.headers), "eoc_renewal");
      expect(next).not.toBe(auth.renewal);
      expect(
        (await db.session.findUniqueOrThrow({ where: { id: auth.sessionId } }))
          .renewalVersion,
      ).toBe(1);
      expect(
        (
          await request(app)
            .get("/api/v1/auth/me")
            .set("Cookie", cookies(result.headers))
        ).status,
      ).toBe(200);
      const old = await refresh(auth.jar, auth.csrf);
      expect(old.status).toBe(409);
      expect(old.headers["set-cookie"]).toBeUndefined();
    });

    it("allows one concurrent rotation, refuses the racing credential without issuing authority, and accepts the shared replacement", async () => {
      const auth = await login();
      const results = await Promise.all([
        refresh(auth.jar, auth.csrf),
        refresh(auth.jar, auth.csrf),
      ]);
      expect(results.map((response) => response.status).sort()).toEqual([
        200, 409,
      ]);
      const session = await db.session.findUniqueOrThrow({
        where: { id: auth.sessionId },
      });
      expect(session.revokedAt).toBeNull();
      expect(session.renewalVersion).toBe(1);
      expect(
        (
          await refresh(
            cookies(results.find((result) => result.status === 200)!.headers),
            auth.csrf,
          )
        ).status,
      ).toBe(200);
    });

    it("revokes on stale replay outside the bounded race window and cannot revive that session", async () => {
      const auth = await login();
      const result = await refresh(auth.jar, auth.csrf);
      await db.session.update({
        where: { id: auth.sessionId },
        data: { renewedAt: new Date(Date.now() - 6_000) },
      });
      expect((await refresh(auth.jar, auth.csrf)).status).toBe(401);
      expect(
        (await db.session.findUniqueOrThrow({ where: { id: auth.sessionId } }))
          .revokedAt,
      ).not.toBeNull();
      expect((await refresh(cookies(result.headers), auth.csrf)).status).toBe(
        401,
      );
      expect(
        (
          await request(app)
            .get("/api/v1/auth/me")
            .set("Cookie", cookies(result.headers))
        ).status,
      ).toBe(401);
      expect(
        await db.auditEvent.count({
          where: { actorUserId: auth.userId, action: "SESSION_RENEWAL_REPLAY" },
        }),
      ).toBe(1);
    });

    it("does not let forged credentials revoke a known session", async () => {
      const auth = await login();
      const forged =
        auth.renewal.slice(0, -1) + (auth.renewal.endsWith("a") ? "b" : "a");
      expect((await refresh([`eoc_renewal=${forged}`], auth.csrf)).status).toBe(
        401,
      );
      expect(
        (await db.session.findUniqueOrThrow({ where: { id: auth.sessionId } }))
          .revokedAt,
      ).toBeNull();
    });

    it.each(["idle", "absolute", "revoked"])(
      "enforces %s authority on both access and renewal",
      async (state) => {
        const auth = await login();
        const past = new Date(Date.now() - 1_000);
        const createdAt = new Date(Date.now() - 60_000);
        await db.session.update({
          where: { id: auth.sessionId },
          data:
            state === "revoked"
              ? { revokedAt: past }
              : state === "absolute"
                ? { createdAt, expiresAt: past, absoluteExpiresAt: past }
                : {
                    createdAt,
                    expiresAt: past,
                    absoluteExpiresAt: new Date(Date.now() + 60_000),
                  },
        });
        expect((await refresh(auth.jar, auth.csrf)).status).toBe(401);
        expect(
          (await request(app).get("/api/v1/auth/me").set("Cookie", auth.jar))
            .status,
        ).toBe(401);
      },
    );

    it("renews idle authority during activity while preserving its absolute bound", async () => {
      const auth = await login();
      const before = await db.session.findUniqueOrThrow({
        where: { id: auth.sessionId },
      });
      await db.session.update({
        where: { id: auth.sessionId },
        data: { expiresAt: new Date(Date.now() + 60_000) },
      });
      expect(
        (await request(app).get("/api/v1/auth/me").set("Cookie", auth.jar))
          .status,
      ).toBe(200);
      const after = await db.session.findUniqueOrThrow({
        where: { id: auth.sessionId },
      });
      expect(after.expiresAt.getTime()).toBeGreaterThan(
        Date.now() + IDLE_MS - 5_000,
      );
      expect(after.absoluteExpiresAt).toEqual(before.absoluteExpiresAt);
    });

    it("logout after access expiry revokes renewal and clears both cookies", async () => {
      const auth = await login();
      const result = await request(app)
        .post("/api/v1/auth/logout")
        .set("Origin", origin)
        .set("X-CSRF-Token", auth.csrf)
        .set("Cookie", `eoc_renewal=${auth.renewal}`);
      expect(result.status).toBe(200);
      expect(cookies(result.headers)).toEqual(["eoc_session=", "eoc_renewal="]);
      expect(
        (await db.session.findUniqueOrThrow({ where: { id: auth.sessionId } }))
          .renewalHash,
      ).toBeNull();
      expect((await refresh(auth.jar, auth.csrf)).status).toBe(401);
    });

    it("preserves cross-site cookies, CSRF/Origin, CORS and no-store", async () => {
      const auth = await login();
      for (const value of auth.response.headers[
        "set-cookie"
      ] as unknown as string[]) {
        expect(value).toContain("SameSite=None");
        expect(value).toContain("HttpOnly");
        expect(value).toContain("Secure");
      }
      expect(auth.response.headers["cache-control"]).toBe("private, no-store");
      expect(
        (
          await request(app)
            .post("/api/v1/auth/account/refresh")
            .set("Origin", origin)
            .set("Cookie", auth.jar)
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .post("/api/v1/auth/account/refresh")
            .set("Origin", "https://evil.test")
            .set("Cookie", auth.jar)
            .set("X-CSRF-Token", auth.csrf)
        ).status,
      ).toBe(403);
      const cors = await request(app)
        .options("/api/v1/auth/account/refresh")
        .set("Origin", origin)
        .set("Access-Control-Request-Method", "POST")
        .set("Access-Control-Request-Headers", "X-CSRF-Token");
      expect(cors.headers["access-control-allow-origin"]).toBe(origin);
      expect(cors.headers["access-control-allow-credentials"]).toBe("true");
      expect(cors.headers["access-control-allow-headers"]).toContain(
        "X-CSRF-Token",
      );
    });

    it("ordinary signup cannot create events, assign staff, scan gates or read another event's operations", async () => {
      const auth = await login();
      const owner = await provisionAccount(
        db,
        config,
        "EMAIL",
        email(),
        true,
        randomUUID(),
      );
      const event = await db.event.create({
        data: { ownerUserId: owner, name: "Privilege boundary" },
      });
      const gate = await db.gate.create({ data: { eventId: event.id } });
      expect(
        (
          await request(app)
            .post("/api/v1/events")
            .set("Origin", origin)
            .set("Cookie", auth.jar)
            .set("X-CSRF-Token", auth.csrf)
            .set("Idempotency-Key", randomUUID())
            .send({ name: "Unauthorized" })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .post(`/api/v1/events/${event.id}/assignments`)
            .set("Origin", origin)
            .set("Cookie", auth.jar)
            .set("X-CSRF-Token", auth.csrf)
            .send({ user_id: auth.userId, role: "VOLUNTEER" })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .get(`/api/v1/events/${event.id}/gates/${gate.id}/scope`)
            .set("Cookie", auth.jar)
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .get(`/api/v1/events/${event.id}/operations`)
            .set("Cookie", auth.jar)
        ).status,
      ).toBe(404);
      expect(
        (await request(app).get("/api/v1/auth/me").set("Cookie", auth.jar))
          .body,
      ).toMatchObject({ organizer_capable: false, assignments: [] });
    });

    it("rolls back account creation, consumption and session creation on required audit failure", async () => {
      const contact = email();
      await challenge(contact);
      const transact = db.$transaction.bind(db);
      const failingAudit = vi
        .spyOn(db, "$transaction")
        .mockImplementationOnce((async (callback: unknown) =>
          transact(async (tx) => {
            const fail = vi
              .spyOn(tx.auditEvent, "create")
              .mockRejectedValue(new Error("audit store unavailable"));
            try {
              return await (
                callback as (
                  client: Prisma.TransactionClient,
                ) => Promise<unknown>
              )(tx);
            } finally {
              fail.mockRestore();
            }
          })) as typeof db.$transaction);
      try {
        await expect(
          otp.verify(
            ProofPurpose.ACCOUNT,
            "EMAIL",
            contact,
            codes.get(contact)!,
            randomUUID(),
          ),
        ).rejects.toMatchObject({ status: 503 });
      } finally {
        failingAudit.mockRestore();
      }
      expect(
        await db.verifiedContact.count({
          where: { lookupHash: lookup(contact) },
        }),
      ).toBe(0);
      expect(
        (
          await db.otpChallenge.findFirstOrThrow({
            where: { contactLookupHash: lookup(contact) },
          })
        ).consumedAt,
      ).toBeNull();
    });

    it("rolls back rotation when its required audit cannot commit", async () => {
      const auth = await login();
      const transact = db.$transaction.bind(db);
      const failingAudit = vi
        .spyOn(db, "$transaction")
        .mockImplementationOnce((async (callback: unknown) =>
          transact(async (tx) => {
            const fail = vi
              .spyOn(tx.auditEvent, "create")
              .mockRejectedValue(new Error("audit store unavailable"));
            try {
              return await (
                callback as (
                  client: Prisma.TransactionClient,
                ) => Promise<unknown>
              )(tx);
            } finally {
              fail.mockRestore();
            }
          })) as typeof db.$transaction);
      try {
        expect((await refresh(auth.jar, auth.csrf)).status).toBe(503);
      } finally {
        failingAudit.mockRestore();
      }
      const session = await db.session.findUniqueOrThrow({
        where: { id: auth.sessionId },
      });
      expect(session.renewalVersion).toBe(0);
      expect(session.renewalHash).toBe(
        renewalHash(auth.renewal, config.jwtSecret),
      );
      expect((await refresh(auth.jar, auth.csrf)).status).toBe(200);
    });

    it("fails closed with an unavailable session store instead of treating the account as anonymous", async () => {
      const auth = await login();
      const unavailable = vi
        .spyOn(db, "$transaction")
        .mockRejectedValueOnce(new Error("store unavailable"));
      try {
        expect((await refresh(auth.jar, auth.csrf)).status).toBe(503);
      } finally {
        unavailable.mockRestore();
      }
      const readUnavailable = vi
        .spyOn(db.session, "findUnique")
        .mockRejectedValueOnce(new Error("store unavailable"));
      try {
        expect(
          (await request(app).get("/api/v1/auth/me").set("Cookie", auth.jar))
            .status,
        ).toBe(503);
      } finally {
        readUnavailable.mockRestore();
      }
    });
  },
);
