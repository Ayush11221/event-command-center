import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../../config/database.js";
import { issueCredential } from "../registrations/credential.js";
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("entry ledger and account profile upgrade", () => {
  it("preserves existing accepted entry, first-arrival evidence and contacts", async () => {
    const target = new URL(url ?? "postgresql://invalid/invalid"),
      adminUrl = new URL(target);
    adminUrl.pathname = "/postgres";
    const name = `checkout_upgrade_${randomUUID().replaceAll("-", "")}`;
    if (!/^checkout_upgrade_[0-9a-f]{32}$/.test(name))
      throw new Error("Unsafe temporary database");
    const admin = new Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    target.pathname = `/${name}`;
    const sql = new Client({ connectionString: target.toString() }),
      db = createDatabase(target.toString());
    try {
      await sql.connect();
      const migrations = resolve(
        import.meta.dirname,
        "../../../../database/prisma/migrations",
      );
      const upgrade = "20261010000000_gate_checkout";
      for (const previous of readdirSync(migrations)
        .filter((v) => v < upgrade)
        .sort())
        await sql.query(
          readFileSync(resolve(migrations, previous, "migration.sql"), "utf8"),
        );
      const user = await db.user.create({
        data: { organizerCapable: true },
        select: { id: true },
      });
      await db.verifiedContact.create({
        data: {
          userId: user.id,
          type: "EMAIL",
          lookupHash: "a".repeat(64),
          encrypted: "preserved-protected-contact",
          verifiedAt: new Date(),
        },
      });
      const event = await db.event.create({
        data: {
          ownerUserId: user.id,
          name: "Existing live event",
          state: "LIVE",
          checkoutEnabled: true,
        },
      });
      const gate = await db.gate.create({ data: { eventId: event.id } });
      const registration = await db.registration.create({
        data: { eventId: event.id, userId: user.id },
      });
      const credential = await db.qRCredential.create({
        data: {
          registrationId: registration.id,
          ...issueCredential(registration.id, Buffer.alloc(32, 1)),
        },
      });
      const decision = randomUUID(),
        at = new Date();
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO "ScanDecision" (id,"scanId","eventId","gateId","operatorUserId","registrationId","credentialId",decision,reason,"decidedAt","correlationId") VALUES (${decision}::uuid,${randomUUID()}::uuid,${event.id}::uuid,${gate.id}::uuid,${user.id}::uuid,${registration.id}::uuid,${credential.id}::uuid,'ACCEPTED','ACCEPTED',${at},${randomUUID()})`;
        await tx.$executeRaw`INSERT INTO "AttendanceTransition" (id,"eventId","gateId","operatorUserId","registrationId","scanDecisionId","acceptedAt") VALUES (${randomUUID()}::uuid,${event.id}::uuid,${gate.id}::uuid,${user.id}::uuid,${registration.id}::uuid,${decision}::uuid,${at})`;
      });
      const beforeScan = (
        await sql.query('SELECT to_jsonb(t) AS value FROM "ScanDecision" t')
      ).rows;
      const beforeLedger = (
        await sql.query(
          'SELECT to_jsonb(t) AS value FROM "AttendanceTransition" t',
        )
      ).rows;
      const beforeContact = (
        await sql.query('SELECT to_jsonb(t) AS value FROM "VerifiedContact" t')
      ).rows;
      const firstArrival = (
        await db.registration.findUniqueOrThrow({
          where: { id: registration.id },
        })
      ).firstAcceptedCheckInAt;
      for (const migration of [upgrade, "20261010010000_account_profile"])
        await sql.query(
          readFileSync(resolve(migrations, migration, "migration.sql"), "utf8"),
        );
      expect(
        (
          await sql.query(
            `SELECT to_jsonb(t) - 'direction' AS value FROM "ScanDecision" t`,
          )
        ).rows,
      ).toEqual(beforeScan);
      expect(
        (
          await sql.query(
            `SELECT to_jsonb(t) - 'sequence' AS value FROM "AttendanceTransition" t`,
          )
        ).rows,
      ).toEqual(beforeLedger);
      expect(
        (
          await sql.query(
            'SELECT to_jsonb(t) AS value FROM "VerifiedContact" t',
          )
        ).rows,
      ).toEqual(beforeContact);
      expect(
        (await db.scanDecision.findUniqueOrThrow({ where: { id: decision } }))
          .direction,
      ).toBe("CHECK_IN");
      expect((await db.attendanceTransition.findFirstOrThrow()).sequence).toBe(
        1,
      );
      expect(
        (
          await db.registration.findUniqueOrThrow({
            where: { id: registration.id },
          })
        ).firstAcceptedCheckInAt,
      ).toEqual(firstArrival);
      expect(
        await db.user.findUniqueOrThrow({ where: { id: user.id } }),
      ).toMatchObject({
        displayName: null,
        profilePhone: null,
        organization: null,
        affiliationId: null,
        organizerCapable: true,
      });
    } finally {
      await db.$disconnect();
      await sql.end();
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.end();
    }
  }, 30000);
});
