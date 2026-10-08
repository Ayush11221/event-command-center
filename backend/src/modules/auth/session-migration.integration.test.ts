import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "renewable Session additive upgrade",
  () => {
    it("preserves legacy identity, session expiry and revocation without granting renewal or changing other tables", async () => {
      const target = new URL(process.env.TEST_DATABASE_URL!);
      const adminUrl = new URL(target);
      adminUrl.pathname = "/postgres";
      adminUrl.searchParams.delete("schema");
      const name = `p0_auth_upgrade_${randomUUID().replaceAll("-", "")}`;
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
        const current = "20261008000000_renewable_account_sessions";
        for (const migration of readdirSync(root)
          .filter((item) => item < current)
          .sort()) {
          await sql.query(
            readFileSync(resolve(root, migration, "migration.sql"), "utf8"),
          );
        }
        const user = randomUUID(),
          at = new Date(),
          expires = new Date(at.getTime() + 15 * 60_000);
        await sql.query(
          'INSERT INTO "User" (id, "organizerCapable") VALUES ($1, false)',
          [user],
        );
        await sql.query(
          'INSERT INTO "VerifiedContact" (id, "userId", type, "lookupHash", encrypted, "verifiedAt") VALUES ($1,$2,\'EMAIL\',$3,$4,$5)',
          [
            randomUUID(),
            user,
            "a".repeat(64),
            "synthetic-encrypted-contact",
            at,
          ],
        );
        await sql.query(
          'INSERT INTO "Session" (id,"userId","createdAt","expiresAt","revokedAt") VALUES ($1,$2,$3,$4,NULL),($5,$2,$3,$4,$3)',
          [randomUUID(), user, at, expires, randomUUID()],
        );
        const tables = (
          await sql.query(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
          )
        ).rows.map((row: { tablename: string }) => row.tablename);
        const before = new Map<string, unknown>(),
          columns = new Map<string, unknown>();
        for (const table of tables) {
          before.set(
            table,
            (
              await sql.query(
                `SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
              )
            ).rows,
          );
          columns.set(
            table,
            (
              await sql.query(
                "SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
                [table],
              )
            ).rows,
          );
        }
        await sql.query(
          readFileSync(resolve(root, current, "migration.sql"), "utf8"),
        );
        for (const table of tables) {
          if (table === "Session") continue;
          expect(
            (
              await sql.query(
                `SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
              )
            ).rows,
          ).toEqual(before.get(table));
          expect(
            (
              await sql.query(
                "SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
                [table],
              )
            ).rows,
          ).toEqual(columns.get(table));
        }
        const sessions = (
          await sql.query('SELECT to_jsonb(t) row FROM "Session" t ORDER BY id')
        ).rows as { row: Record<string, unknown> }[];
        for (const { row } of sessions) {
          expect(row).toMatchObject({
            renewalVersion: 0,
            renewalHash: null,
            absoluteExpiresAt: null,
            renewedAt: null,
          });
          const {
            renewalVersion,
            renewalHash,
            absoluteExpiresAt,
            renewedAt,
            ...legacy
          } = row;
          void renewalVersion;
          void renewalHash;
          void absoluteExpiresAt;
          void renewedAt;
          expect(before.get("Session")).toContainEqual({ row: legacy });
        }
        expect(sessions).toHaveLength(2);
        expect(
          sessions.filter(({ row }) => row.revokedAt !== null),
        ).toHaveLength(1);
      } finally {
        await sql.end();
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        await admin.end();
      }
    });
  },
);
