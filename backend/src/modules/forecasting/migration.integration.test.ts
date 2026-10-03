import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../../config/database.js";
import { issueCredential } from "../registrations/credential.js";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("Slice 8 upgrade migration preservation", () => {
  it("adds only ForecastRun and preserves all populated prior tables byte-for-byte", async () => {
    const target = new URL(url ?? "postgresql://invalid/invalid"),
      adminUrl = new URL(target);
    adminUrl.pathname = "/postgres";
    adminUrl.searchParams.delete("schema");
    const name = `slice8_upgrade_${randomUUID().replaceAll("-", "")}`;
    if (!/^slice8_upgrade_[0-9a-f]{32}$/.test(name))
      throw new Error("Unsafe temporary database name");
    const admin = new Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    target.pathname = `/${name}`;
    target.searchParams.delete("schema");
    const sql = new Client({ connectionString: target.toString() }),
      db = createDatabase(target.toString());
    try {
      await sql.connect();
      const migrations = resolve(
          import.meta.dirname,
          "../../../../database/prisma/migrations",
        ),
        slice8 = "20261003020000_slice8_forecasts";
      const previous = readdirSync(migrations)
        .filter((name) => name < slice8)
        .sort();
      expect(previous).toHaveLength(5);
      for (const migration of previous)
        await sql.query(
          readFileSync(resolve(migrations, migration, "migration.sql"), "utf8"),
        );
      const owner = await db.user.create({ data: { organizerCapable: true } }),
        participant = await db.user.create({ data: {} });
      const event = await db.event.create({
          data: {
            ownerUserId: owner.id,
            name: "Preserved accepted attendance",
            state: "LIVE",
            registrationCapacity: 1,
            revision: 57,
          },
        }),
        gate = await db.gate.create({ data: { eventId: event.id } });
      const registration = await db.registration.create({
        data: { eventId: event.id, userId: participant.id },
      });
      const credential = await db.qRCredential.create({
        data: {
          registrationId: registration.id,
          ...issueCredential(registration.id, Buffer.alloc(32, 10)),
        },
      });
      const at = new Date();
      await db.$transaction(async (tx) => {
        const decision = await tx.scanDecision.create({
          data: {
            scanId: randomUUID(),
            eventId: event.id,
            gateId: gate.id,
            operatorUserId: owner.id,
            registrationId: registration.id,
            credentialId: credential.id,
            decision: "ACCEPTED",
            reason: "ACCEPTED",
            decidedAt: at,
            correlationId: randomUUID(),
          },
        });
        await tx.attendanceTransition.create({
          data: {
            eventId: event.id,
            gateId: gate.id,
            operatorUserId: owner.id,
            registrationId: registration.id,
            scanDecisionId: decision.id,
            acceptedAt: at,
          },
        });
        await tx.auditEvent.create({
          data: {
            actorKind: "ACCOUNT",
            actorUserId: owner.id,
            eventId: event.id,
            action: "SCAN_DECISION",
            outcome: "ACCEPTED",
            correlationId: randomUUID(),
            metadata: { decision: "ACCEPTED" },
          },
        });
      });
      const tableRows = await sql.query<{ name: string }>(
        "SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
      );
      const tables = tableRows.rows.map((row) => row.name);
      const digest = async (table: string) => {
        if (!/^[A-Za-z0-9_]+$/.test(table)) throw new Error("Invalid table");
        return (
          await sql.query<{ digest: string }>(
            `SELECT md5(COALESCE(string_agg(to_jsonb(t)::text, '' ORDER BY to_jsonb(t)::text), '')) AS digest FROM "${table}" t`,
          )
        ).rows[0].digest;
      };
      const before: string[] = [];
      for (const table of tables) before.push(await digest(table));
      await sql.query(
        readFileSync(resolve(migrations, slice8, "migration.sql"), "utf8"),
      );
      const preserved: string[] = [];
      for (const table of tables) preserved.push(await digest(table));
      expect(preserved).toEqual(before);
      const after = await sql.query<{ name: string }>(
        "SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
      );
      expect(after.rows.map((row) => row.name)).toEqual(
        [...tables, "ForecastRun"].sort(),
      );
      expect(await db.forecastRun.count()).toBe(0);
      expect(
        (await db.event.findUniqueOrThrow({ where: { id: event.id } }))
          .revision,
      ).toBe(57);
    } finally {
      await db.$disconnect();
      await sql.end();
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.end();
    }
  }, 30000);
});
