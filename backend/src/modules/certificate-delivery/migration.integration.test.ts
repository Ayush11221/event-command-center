import { randomUUID, createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../../config/database.js";
import { ensureDelivery } from "./intent.js";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "Slice 10 additive upgrade and integrity",
  () => {
    it("preserves issued Slice 9 bytes/data and Registration schema; enrolls legacy issuance and enforces durable bindings", async () => {
      const target = new URL(process.env.TEST_DATABASE_URL!),
        adminUrl = new URL(target);
      adminUrl.pathname = "/postgres";
      adminUrl.searchParams.delete("schema");
      const name = `slice10_upgrade_${randomUUID().replaceAll("-", "")}`,
        admin = new Client({ connectionString: adminUrl.href });
      await admin.connect();
      await admin.query(`CREATE DATABASE "${name}"`);
      target.pathname = `/${name}`;
      target.searchParams.delete("schema");
      const sql = new Client({ connectionString: target.href });
      let db: ReturnType<typeof createDatabase> | undefined;
      try {
        await sql.connect();
        const root = resolve(
            import.meta.dirname,
            "../../../../database/prisma/migrations",
          ),
          current = "20261003040000_slice10_certificate_delivery";
        for (const migration of readdirSync(root)
          .filter((item) => item < current)
          .sort())
          await sql.query(
            readFileSync(resolve(root, migration, "migration.sql"), "utf8"),
          );
        async function insert(table: string, data: Record<string, unknown>) {
          const columns = Object.keys(data);
          await sql.query(
            `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(",")})`,
            Object.values(data),
          );
        }
        const user = randomUUID(),
          event = randomUUID(),
          reg = randomUUID(),
          gate = randomUUID(),
          credential = randomUUID(),
          scan = randomUUID(),
          attendance = randomUUID(),
          replay = randomUUID(),
          work = randomUUID(),
          at = new Date(),
          pdf = Buffer.from("%PDF-1.4 legacy fixture");
        await insert("User", { id: user, organizerCapable: true });
        await insert("Event", {
          id: event,
          ownerUserId: user,
          name: "Preserved event",
          state: "LIVE",
          visibility: "PUBLIC",
          startAt: at,
          endAt: new Date(at.getTime() + 3600000),
          timeZone: "UTC",
        });
        await insert("Registration", { id: reg, eventId: event, userId: user });
        await insert("Gate", { id: gate, eventId: event });
        await insert("QRCredential", {
          id: credential,
          registrationId: reg,
          verifierHash: "a".repeat(64),
          protectedRepresentation: Buffer.from("protected-synthetic"),
        });
        await sql.query("BEGIN");
        await insert("ScanDecision", {
          id: scan,
          scanId: randomUUID(),
          eventId: event,
          gateId: gate,
          operatorUserId: user,
          registrationId: reg,
          credentialId: credential,
          decision: "ACCEPTED",
          reason: "ACCEPTED",
          decidedAt: at,
          correlationId: randomUUID(),
        });
        await insert("AttendanceTransition", {
          id: attendance,
          eventId: event,
          gateId: gate,
          operatorUserId: user,
          registrationId: reg,
          scanDecisionId: scan,
          acceptedAt: at,
        });
        await sql.query("COMMIT");
        await insert("CertificateRecipientName", {
          registrationId: reg,
          eventId: event,
          name: "Legacy Recipient",
        });
        const facts = {
          registrationId: reg,
          eventId: event,
          recipientName: "Legacy Recipient",
          templateId: "classic",
          templateVersion: 1,
          fontId: "sans",
          eligibilityRuleVersion: "CERT_ELIGIBILITY_V1",
          attendanceTransitionId: attendance,
          firstAcceptedCheckInAt: at,
        };
        await sql.query("BEGIN");
        await insert("CommandReplay", {
          id: replay,
          actorUserId: user,
          action: "CERTIFICATE_ISSUE",
          resourceKey: event,
          idempotencyKeyHash: "b".repeat(64),
          requestFingerprint: "c".repeat(64),
          createdAt: at,
          expiresAt: new Date(Date.now() + 604800000),
        });
        await insert("CertificateIssueWork", {
          id: work,
          ...facts,
          commandReplayId: replay,
          requestedByUserId: user,
          executionByUserId: user,
          executionSessionId: randomUUID(),
          correlationId: randomUUID(),
          recipientNameRevision: 1,
          eventName: "Preserved event",
          eventStartAt: at,
          eventTimeZone: "UTC",
        });
        await insert("Certificate", {
          id: work,
          ...facts,
          certificateNumber: work,
          pdfBytes: pdf,
          pdfSha256: createHash("sha256").update(pdf).digest("hex"),
          issuedByUserId: user,
          issuedAt: at,
        });
        await sql.query(
          'UPDATE "CertificateIssueWork" SET status=\'COMPLETED\',"completedCertificateId"=id,"completedAt"=$1,"retryAt"=NULL WHERE id=$2',
          [at, work],
        );
        await sql.query(
          'UPDATE "CommandReplay" SET status=\'COMPLETED\',"responseStatus"=201,"responseBody"=$1,"completedAt"=$2 WHERE id=$3',
          [
            JSON.stringify({ certificate: { certificate_id: work } }),
            at,
            replay,
          ],
        );
        await sql.query("COMMIT");
        const columns = (
          await sql.query(
            "SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='Registration' ORDER BY ordinal_position",
          )
        ).rows;
        const tables = (
            await sql.query(
              "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
            )
          ).rows.map((r: { tablename: string }) => r.tablename),
          snapshots = new Map<string, unknown>();
        for (const table of tables)
          snapshots.set(
            table,
            (
              await sql.query(
                `SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
              )
            ).rows,
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
        ).toEqual(columns);
        for (const table of tables)
          expect(
            (
              await sql.query(
                `SELECT to_jsonb(t) ${table === "CertificateIssueWork" ? "- 'executionBatchId'" : ""} row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
              )
            ).rows,
          ).toEqual(snapshots.get(table));
        expect(
          (
            await sql.query(
              'SELECT "pdfBytes" FROM "Certificate" WHERE id=$1',
              [work],
            )
          ).rows[0].pdfBytes,
        ).toEqual(pdf);
        db = createDatabase(target.href);
        const client = db;
        const delivery = await client.$transaction((tx) =>
          ensureDelivery(tx, work, randomUUID()),
        );
        expect(delivery.created).toBe(true);
        expect(delivery.delivery).toMatchObject({
          status: "NOT_REQUIRED",
          reasonCode: "NOT_DELIVERABLE",
        });
        expect(
          (
            await client.$transaction((tx) =>
              ensureDelivery(tx, work, randomUUID()),
            )
          ).delivery.id,
        ).toBe(delivery.delivery.id);
        await expect(
          client.certificateDelivery.create({
            data: {
              certificateId: work,
              eventId: event,
              status: "NOT_REQUIRED",
              reasonCode: "NOT_DELIVERABLE",
            },
          }),
        ).rejects.toThrow();
        await expect(
          client.certificateDeliveryAttempt.create({
            data: { deliveryId: delivery.delivery.id, attemptNumber: 1 },
          }),
        ).rejects.toThrow();
        await expect(
          client.certificateDelivery.update({
            where: { id: delivery.delivery.id },
            data: { status: "SENT", sentAt: new Date() },
          }),
        ).rejects.toThrow();
        await expect(
          client.certificateBatchItem.create({
            data: {
              batchId: randomUUID(),
              eventId: event,
              registrationId: randomUUID(),
              eligibleAtCreation: false,
            },
          }),
        ).rejects.toThrow();
      } finally {
        await db?.$disconnect();
        await sql.end();
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        await admin.end();
      }
    }, 15000);
  },
);
