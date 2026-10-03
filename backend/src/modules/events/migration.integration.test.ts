import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "../../config/database.js";
import {
  issueCredential,
  recoverCredential,
} from "../registrations/credential.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const prismaCli = resolve(repositoryRoot, "node_modules/prisma/build/index.js");
const foundationMigration = "20260930210710_slice2_foundation";
const securityMigration = "20261001000000_slice2_security_invariants";

function prisma(targetUrl: string, ...arguments_: string[]): void {
  // Use the installed workspace CLI: Windows cannot execute npx.cmd directly
  // without a shell, and verification must not download another Prisma version.
  execFileSync(process.execPath, [prismaCli, ...arguments_], {
    cwd: repositoryRoot,
    env: { ...process.env, DATABASE_URL: targetUrl },
    encoding: "utf8",
    stdio: "pipe",
    timeout: 90_000,
  });
}

describe.skipIf(!databaseUrl)("Migration preservation", () => {
  const sourceUrl = new URL(databaseUrl ?? "postgresql://invalid/invalid");
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = "/postgres";
  adminUrl.searchParams.delete("schema");
  const admin = createDatabase(adminUrl.toString());

  afterAll(async () => {
    await admin.$disconnect();
  });

  async function withTemporaryDatabase(
    label: string,
    test: (targetUrl: string) => Promise<void>,
  ): Promise<void> {
    const databaseName = `slice3_${label}_${randomUUID().replaceAll("-", "")}`;
    if (!/^slice3_[a-z]+_[0-9a-f]{32}$/.test(databaseName))
      throw new Error("Unsafe temporary database name");
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    const targetUrl = new URL(sourceUrl);
    targetUrl.pathname = `/${databaseName}`;
    targetUrl.searchParams.delete("schema");
    try {
      await test(targetUrl.toString());
    } finally {
      await admin.$executeRawUnsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`,
      );
      await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`);
    }
  }

  it("preserves populated Slice 4 account/guest registration history, QR bytes and command replay on Slice 5 upgrade", async () => {
    await withTemporaryDatabase("checkin", async (targetUrl) => {
      for (const migration of [
        foundationMigration,
        securityMigration,
        "20261002000000_slice3_persistence_safety",
        "20261003000000_slice4_registration",
      ]) {
        prisma(
          targetUrl,
          "db",
          "execute",
          "--file",
          resolve(
            repositoryRoot,
            "database/prisma/migrations",
            migration,
            "migration.sql",
          ),
          "--config",
          "database/prisma7.config.ts",
        );
        prisma(
          targetUrl,
          "migrate",
          "resolve",
          "--applied",
          migration,
          "--config",
          "database/prisma7.config.ts",
        );
      }
      const target = createDatabase(targetUrl),
        rootKey = Buffer.alloc(32, 10);
      try {
        const owner = await target.user.create({
          data: { organizerCapable: true },
        });
        const participant = await target.user.create({ data: {} });
        const guest = await target.guestIdentity.create({
          data: { lookupHash: "a".repeat(64) },
        });
        const event = await target.event.create({
          data: {
            ownerUserId: owner.id,
            name: "Preserved Slice 4",
            state: "PUBLISHED",
            visibility: "PUBLIC",
            publishedAt: new Date(),
            registrationCapacity: 3,
          },
        });
        const registrations = [
          await target.registration.create({
            data: { eventId: event.id, userId: participant.id },
          }),
          await target.registration.create({
            data: { eventId: event.id, guestIdentityId: guest.id },
          }),
          await target.registration.create({
            data: {
              eventId: event.id,
              userId: participant.id,
              state: "CANCELLED",
              cancelledAt: new Date(),
              cancelledByUserId: participant.id,
              cancelledActorKind: "ACCOUNT",
            },
          }),
        ];
        const credentials = [];
        for (const registration of registrations) {
          credentials.push(
            await target.qRCredential.create({
              data: {
                registrationId: registration.id,
                ...issueCredential(registration.id, rootKey),
                ...(registration.state === "CANCELLED"
                  ? { revokedAt: new Date(), protectedRepresentation: null }
                  : {}),
              },
            }),
          );
        }
        const replays = [
          await target.commandReplay.create({
            data: {
              actorUserId: participant.id,
              action: "REGISTRATION_CREATE",
              resourceKey: "event:" + event.id,
              idempotencyKeyHash: "b".repeat(64),
              requestFingerprint: "c".repeat(64),
              status: "COMPLETED",
              responseStatus: 201,
              responseBody: { registration_id: registrations[0].id },
              createdAt: new Date(Date.now() - 1000),
              completedAt: new Date(),
              expiresAt: new Date(Date.now() + 86400000),
            },
          }),
          await target.commandReplay.create({
            data: {
              actorGuestIdentityId: guest.id,
              action: "REGISTRATION_CREATE",
              resourceKey: "event:" + event.id,
              idempotencyKeyHash: "d".repeat(64),
              requestFingerprint: "e".repeat(64),
              status: "COMPLETED",
              responseStatus: 201,
              responseBody: { registration_id: registrations[1].id },
              createdAt: new Date(Date.now() - 1000),
              completedAt: new Date(),
              expiresAt: new Date(Date.now() + 86400000),
            },
          }),
        ];
        const tokens = credentials
          .slice(0, 2)
          .map((row) =>
            recoverCredential(
              row.registrationId,
              row.protectedRepresentation!,
              rootKey,
            ),
          );
        prisma(
          targetUrl,
          "migrate",
          "deploy",
          "--config",
          "database/prisma7.config.ts",
        );
        expect(
          await target.event.findUnique({ where: { id: event.id } }),
        ).toEqual(event);
        for (const before of registrations)
          expect(
            await target.registration.findUnique({
              where: { id: before.id },
            }),
          ).toEqual(before);
        for (const before of credentials)
          expect(
            await target.qRCredential.findUnique({
              where: { id: before.id },
            }),
          ).toEqual(before);
        for (const before of replays)
          expect(
            await target.commandReplay.findUnique({
              where: { id: before.id },
            }),
          ).toEqual(before);
        for (let index = 0; index < 2; index++) {
          const row = await target.qRCredential.findUniqueOrThrow({
            where: { id: credentials[index].id },
          });
          expect(
            recoverCredential(
              row.registrationId,
              row.protectedRepresentation!,
              rootKey,
            ),
          ).toBe(tokens[index]);
        }
        expect(await target.scanDecision.count()).toBe(0);
        expect(await target.attendanceTransition.count()).toBe(0);
      } finally {
        await target.$disconnect();
      }
    });
  }, 120_000);

  it("applies the complete migration history to a clean database", async () => {
    await withTemporaryDatabase("clean", async (targetUrl) => {
      prisma(
        targetUrl,
        "migrate",
        "deploy",
        "--config",
        "database/prisma7.config.ts",
      );
      const target = createDatabase(targetUrl);
      try {
        const tables = await target.$queryRaw<{ table_name: string }[]>`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = current_schema()
              AND table_name IN ('Event', 'PrivateAccessLink', 'CommandReplay', 'GuestIdentity', 'Registration', 'QRCredential', 'ScanDecision', 'AttendanceTransition')
            ORDER BY table_name
          `;
        expect(tables.map(({ table_name }) => table_name)).toEqual([
          "AttendanceTransition",
          "CommandReplay",
          "Event",
          "GuestIdentity",
          "PrivateAccessLink",
          "QRCredential",
          "Registration",
          "ScanDecision",
        ]);
      } finally {
        await target.$disconnect();
      }
    });
  }, 120_000);

  it("preserves populated Slice 3 event, link lineage and protected account replay on subsequent upgrades", async () => {
    await withTemporaryDatabase("registration", async (targetUrl) => {
      for (const migration of [
        foundationMigration,
        securityMigration,
        "20261002000000_slice3_persistence_safety",
      ]) {
        prisma(
          targetUrl,
          "db",
          "execute",
          "--file",
          resolve(
            repositoryRoot,
            "database/prisma/migrations",
            migration,
            "migration.sql",
          ),
          "--config",
          "database/prisma7.config.ts",
        );
        prisma(
          targetUrl,
          "migrate",
          "resolve",
          "--applied",
          migration,
          "--config",
          "database/prisma7.config.ts",
        );
      }
      const target = createDatabase(targetUrl);
      try {
        const owner = await target.user.create({
          data: { organizerCapable: true },
        });
        const event = await target.event.create({
          data: {
            ownerUserId: owner.id,
            name: "Preserved published private event",
            state: "PUBLISHED",
            visibility: "PRIVATE",
            publishedAt: new Date(),
            registrationCapacity: 50,
            startAt: new Date(Date.now() + 3600000),
            endAt: new Date(Date.now() + 7200000),
            timeZone: "UTC",
            revision: 7,
          },
        });
        const old = await target.privateAccessLink.create({
          data: {
            eventId: event.id,
            verifierHash: "a".repeat(64),
            issuedAt: new Date(Date.now() - 1000),
            revokedAt: new Date(),
          },
        });
        const active = await target.privateAccessLink.create({
          data: {
            eventId: event.id,
            verifierHash: "b".repeat(64),
            replacesLinkId: old.id,
          },
        });
        // The pre-Slice 4 table has no guest column; seed its existing account replay directly.
        const replayId = randomUUID(),
          bytes = Buffer.alloc(70, 9),
          expiresAt = new Date(Date.now() + 3600000);
        await target.$executeRaw`INSERT INTO "CommandReplay" (id, "actorUserId", action, "resourceKey", "idempotencyKeyHash", "requestFingerprint", status, "responseStatus", "protectedResponse", "protectedResponseKeyVersion", "protectedReplayExpiresAt", "completedAt", "expiresAt") VALUES (${replayId}::uuid, ${owner.id}::uuid, 'PRIVATE_LINK_REISSUE', ${`event:${event.id}`}, ${"c".repeat(64)}, ${"d".repeat(64)}, 'COMPLETED', 201, ${bytes}, 1, ${expiresAt}, NOW(), ${expiresAt})`;
        const before = { event, links: [old, active] };
        prisma(
          targetUrl,
          "migrate",
          "deploy",
          "--config",
          "database/prisma7.config.ts",
        );
        expect(
          await target.event.findUnique({ where: { id: event.id } }),
        ).toEqual(before.event);
        expect(
          await target.privateAccessLink.findUnique({
            where: { id: old.id },
          }),
        ).toEqual(old);
        expect(
          await target.privateAccessLink.findUnique({
            where: { id: active.id },
          }),
        ).toEqual(active);
        const replay = await target.commandReplay.findUniqueOrThrow({
          where: { id: replayId },
        });
        expect(replay.actorUserId).toBe(owner.id);
        expect(replay.actorGuestIdentityId).toBeNull();
        expect(Buffer.from(replay.protectedResponse!)).toEqual(bytes);
        expect(replay.protectedReplayExpiresAt).toEqual(expiresAt);
        expect(await target.registration.count()).toBe(0);
      } finally {
        await target.$disconnect();
      }
    });
  }, 120_000);

  it("upgrades and preserves a populated Slice 2 database", async () => {
    await withTemporaryDatabase("upgrade", async (targetUrl) => {
      const foundationPath = resolve(
        repositoryRoot,
        "database/prisma/migrations",
        foundationMigration,
        "migration.sql",
      );
      const securityPath = resolve(
        repositoryRoot,
        "database/prisma/migrations",
        securityMigration,
        "migration.sql",
      );
      prisma(
        targetUrl,
        "db",
        "execute",
        "--file",
        foundationPath,
        "--config",
        "database/prisma7.config.ts",
      );
      prisma(
        targetUrl,
        "migrate",
        "resolve",
        "--applied",
        foundationMigration,
        "--config",
        "database/prisma7.config.ts",
      );
      prisma(
        targetUrl,
        "db",
        "execute",
        "--file",
        securityPath,
        "--config",
        "database/prisma7.config.ts",
      );
      prisma(
        targetUrl,
        "migrate",
        "resolve",
        "--applied",
        securityMigration,
        "--config",
        "database/prisma7.config.ts",
      );

      const legacy = createDatabase(targetUrl);
      const ownerId = randomUUID();
      const targetUserId = randomUUID();
      const eventId = randomUUID();
      const gateId = randomUUID();
      const assignmentId = randomUUID();
      const sessionId = randomUUID();
      const challengeId = randomUUID();
      const auditId = randomUUID();
      const now = new Date("2026-10-01T00:00:00Z");
      try {
        await legacy.$executeRawUnsafe(
          `INSERT INTO "User" ("id", "organizerCapable") VALUES ('${ownerId}', true), ('${targetUserId}', false)`,
        );
        await legacy.$executeRawUnsafe(
          `INSERT INTO "Event" ("id", "ownerUserId") VALUES ('${eventId}', '${ownerId}')`,
        );
        await legacy.$executeRawUnsafe(
          `INSERT INTO "Gate" ("id", "eventId") VALUES ('${gateId}', '${eventId}')`,
        );
        await legacy.$executeRawUnsafe(
          `INSERT INTO "EventRoleAssignment" ("id", "eventId", "userId", "role", "scopeKey", "grantedByUserId") VALUES ('${assignmentId}', '${eventId}', '${targetUserId}', 'EVENT_ADMIN', 'EVENT', '${ownerId}')`,
        );
        await legacy.$executeRawUnsafe(
          `INSERT INTO "Session" ("id", "userId", "createdAt", "expiresAt") VALUES ('${sessionId}', '${ownerId}', '${now.toISOString()}', '2026-10-02T00:00:00.000Z')`,
        );
        await legacy.$executeRawUnsafe(
          `INSERT INTO "OtpChallenge" ("id", "contactType", "contactLookupHash", "purpose", "codeHash", "attempts", "createdAt", "expiresAt", "lastSentAt", "deliveredAt") VALUES ('${challengeId}', 'EMAIL', '${"a".repeat(64)}', 'ACCOUNT', '${"b".repeat(64)}', 0, '${now.toISOString()}', '2026-10-01T00:10:00.000Z', '${now.toISOString()}', '${now.toISOString()}')`,
        );
        await legacy.$executeRawUnsafe(
          `INSERT INTO "AuditEvent" ("id", "actorKind", "actorUserId", "eventId", "action", "outcome", "correlationId") VALUES ('${auditId}', 'ACCOUNT', '${ownerId}', '${eventId}', 'SLICE2_FIXTURE', 'SUCCEEDED', 'migration-fixture')`,
        );
      } finally {
        await legacy.$disconnect();
      }

      prisma(
        targetUrl,
        "migrate",
        "deploy",
        "--config",
        "database/prisma7.config.ts",
      );

      const upgraded = createDatabase(targetUrl);
      try {
        const event = await upgraded.event.findUniqueOrThrow({
          where: { id: eventId },
        });
        expect(event).toMatchObject({
          ownerUserId: ownerId,
          state: "DRAFT",
          name: "Untitled event",
          visibility: null,
          startAt: null,
          endAt: null,
          registrationCapacity: null,
          registrationManuallyClosed: false,
          checkoutEnabled: false,
          revision: 1,
          publishedAt: null,
        });
        expect(await upgraded.gate.count({ where: { id: gateId } })).toBe(1);
        expect(
          await upgraded.eventRoleAssignment.count({
            where: { id: assignmentId },
          }),
        ).toBe(1);
        expect(await upgraded.session.count({ where: { id: sessionId } })).toBe(
          1,
        );
        expect(
          await upgraded.otpChallenge.count({ where: { id: challengeId } }),
        ).toBe(1);
        expect(
          await upgraded.auditEvent.count({ where: { id: auditId } }),
        ).toBe(1);

        await expect(
          upgraded.event.update({
            where: { id: eventId },
            data: { ownerUserId: targetUserId },
          }),
        ).rejects.toThrow();
        await expect(
          upgraded.auditEvent.delete({ where: { id: auditId } }),
        ).rejects.toThrow();
      } finally {
        await upgraded.$disconnect();
      }
    });
  }, 120_000);
});
