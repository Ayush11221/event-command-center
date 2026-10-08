import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "OTP bucket additive upgrade",
  () => {
    it("preserves every existing table and enforces bucket constraints on PostgreSQL", async () => {
      const target = new URL(process.env.TEST_DATABASE_URL!);
      const adminUrl = new URL(target);
      adminUrl.pathname = "/postgres";
      adminUrl.searchParams.delete("schema");
      const name = `p0e_upgrade_${randomUUID().replaceAll("-", "")}`;
      const admin = new Client({ connectionString: adminUrl.href });
      await admin.connect();
      await admin.query(`CREATE DATABASE "${name}"`);
      target.pathname = `/${name}`;
      target.searchParams.delete("schema");
      const sql = new Client({ connectionString: target.href });
      try {
        await sql.connect();
        const root = resolve(
          import.meta.dirname,
          "../../../../database/prisma/migrations",
        );
        const current = "20261008010000_otp_abuse_budgets";
        for (const migration of readdirSync(root)
          .filter((item) => item < current)
          .sort())
          await sql.query(
            readFileSync(resolve(root, migration, "migration.sql"), "utf8"),
          );
        const userId = randomUUID();
        await sql.query(
          'INSERT INTO "User" (id, "organizerCapable") VALUES ($1, false)',
          [userId],
        );
        await sql.query(
          'INSERT INTO "OtpChallenge" (id, "contactType", "contactLookupHash", purpose, "codeHash", "expiresAt", "lastSentAt") VALUES ($1, \'EMAIL\', $2, \'ACCOUNT\', $3, now()+interval \'5 minutes\', now())',
          [randomUUID(), "a".repeat(64), "b".repeat(64)],
        );
        const tables = (
          await sql.query(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
          )
        ).rows.map((row: { tablename: string }) => row.tablename);
        const snapshot = async (table: string) => ({
          rows: (
            await sql.query(
              `SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
            )
          ).rows,
          columns: (
            await sql.query(
              "SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
              [table],
            )
          ).rows,
        });
        const before = new Map<string, unknown>();
        for (const table of tables) before.set(table, await snapshot(table));
        await sql.query(
          readFileSync(resolve(root, current, "migration.sql"), "utf8"),
        );
        for (const table of tables)
          expect(await snapshot(table)).toEqual(before.get(table));
        expect(
          (
            await sql.query(
              "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
            )
          ).rows.map((row: { tablename: string }) => row.tablename),
        ).toEqual([...tables, "OtpRateLimitBucket"].sort());
        expect(
          (
            await sql.query(
              'SELECT count(*)::int AS count FROM "OtpRateLimitBucket"',
            )
          ).rows[0].count,
        ).toBe(0);
        const insert =
          'INSERT INTO "OtpRateLimitBucket" (category,key,"windowStart","expiresAt",count) VALUES ($1,$2,$3,$4,$5)';
        const start = new Date(),
          expiry = new Date(start.getTime() + 60_000),
          key = "c".repeat(64);
        await sql.query(insert, ["CONTACT", key, start, expiry, 1]);
        await expect(
          sql.query(insert, ["CONTACT", key, start, expiry, 1]),
        ).rejects.toMatchObject({ code: "23505" });
        for (const args of [
          ["INVALID", "d".repeat(64), start, expiry, 1],
          ["SOURCE", "d".repeat(64), start, expiry, 0],
          ["PROVIDER", "d".repeat(64), start, start, 1],
        ])
          await expect(sql.query(insert, args)).rejects.toMatchObject({
            code: "23514",
          });
      } finally {
        await sql.end();
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        await admin.end();
      }
    });
  },
);
