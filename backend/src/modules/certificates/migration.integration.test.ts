import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("Slice 9 additive migration", () => {
  it("preserves prior data/schema while enforcing name scope and new work invariants", async () => {
    const target = new URL(url!),
      adminUrl = new URL(target);
    adminUrl.pathname = "/postgres";
    adminUrl.searchParams.delete("schema");
    const name = `slice9_upgrade_${randomUUID().replaceAll("-", "")}`;
    const admin = new Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
    target.pathname = `/${name}`;
    target.searchParams.delete("schema");
    const sql = new Client({ connectionString: target.toString() });
    try {
      await sql.connect();
      const root = resolve(
          import.meta.dirname,
          "../../../../database/prisma/migrations",
        ),
        current = "20261003030000_slice9_certificates";
      for (const migration of readdirSync(root)
        .filter((item) => item < current)
        .sort())
        await sql.query(
          readFileSync(resolve(root, migration, "migration.sql"), "utf8"),
        );
      const user = randomUUID(),
        event = randomUUID(),
        registration = randomUUID();
      await sql.query('INSERT INTO "User" (id) VALUES ($1)', [user]);
      await sql.query(
        'INSERT INTO "Event" (id,"ownerUserId",name) VALUES ($1,$2,$3)',
        [event, user, "Preserved event"],
      );
      await sql.query(
        'INSERT INTO "Registration" (id,"eventId","userId") VALUES ($1,$2,$3)',
        [registration, event, user],
      );
      const tables = (
        await sql.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
        )
      ).rows.map((row: { tablename: string }) => row.tablename);
      const snapshots = new Map<string, string>();
      for (const table of tables)
        snapshots.set(
          table,
          JSON.stringify(
            (
              await sql.query(
                `SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY id`,
              )
            ).rows,
          ),
        );
      const columns = await sql.query(
        "SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='Registration' ORDER BY ordinal_position",
      );
      await sql.query(
        readFileSync(resolve(root, current, "migration.sql"), "utf8"),
      );
      expect(
        (
          await sql.query(
            "SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='Registration' ORDER BY ordinal_position",
          )
        ).rows,
      ).toEqual(columns.rows);
      for (const table of tables)
        expect(
          JSON.stringify(
            (
              await sql.query(
                `SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY id`,
              )
            ).rows,
          ),
        ).toBe(snapshots.get(table));
      await sql.query(
        'INSERT INTO "CertificateRecipientName" ("registrationId","eventId",name) VALUES ($1,$2,$3)',
        [registration, event, "Owner Name"],
      );
      await expect(
        sql.query(
          'UPDATE "CertificateRecipientName" SET name=$1 WHERE "registrationId"=$2',
          ["Changed Name", registration],
        ),
      ).rejects.toThrow();
      await expect(
        sql.query(
          'UPDATE "CertificateRecipientName" SET "eventId"=$1 WHERE "registrationId"=$2',
          [randomUUID(), registration],
        ),
      ).rejects.toThrow();
      await expect(
        sql.query(
          'DELETE FROM "CertificateRecipientName" WHERE "registrationId"=$1',
          [registration],
        ),
      ).rejects.toThrow();
      expect(
        (
          await sql.query(
            "SELECT indexdef FROM pg_indexes WHERE tablename='CertificateIssueWork'",
          )
        ).rows.some((row: { indexdef: string }) =>
          row.indexdef.includes("WHERE (status = 'PENDING'"),
        ),
      ).toBe(true);
    } finally {
      await sql.end();
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.end();
    }
  }, 30000);
});
