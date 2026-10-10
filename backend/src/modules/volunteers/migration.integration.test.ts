import { randomUUID, createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../../config/database.js";
import { ensureDelivery } from "../certificate-delivery/intent.js";
import { eventResults } from "../event-results/service.js";
import { OtpService } from "../auth/otp.js";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "Slice 11 additive upgrade and task integrity",
  () => {
    it("preserves Slice 1-10 table data and columns, certificate bytes/delivery, and enforces task invariants", async () => {
      const target = new URL(process.env.TEST_DATABASE_URL!),
        adminUrl = new URL(target);
      adminUrl.pathname = "/postgres";
      adminUrl.searchParams.delete("schema");
      const name = `slice11_upgrade_${randomUUID().replaceAll("-", "")}`,
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
          current = "20261003050000_slice11_volunteer_results_audit";
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

        // The current Prisma client requires the independent additive Session
        // columns. Apply that migration before exercising current services;
        // the Slice 11 before/after preservation assertions remain unchanged.
        await sql.query(
          readFileSync(
            resolve(
              root,
              "20261008000000_renewable_account_sessions",
              "migration.sql",
            ),
            "utf8",
          ),
        );
        // Current results and profile-aware Prisma models also require these
        // independent additive columns. Snapshot them before the Slice 11
        // migration so preservation is still compared against the same data.
        for (const prerequisite of [
          "20261010000000_gate_checkout",
          "20261010010000_account_profile",
        ])
          await sql.query(
            readFileSync(resolve(root, prerequisite, "migration.sql"), "utf8"),
          );
        db = createDatabase(target.href);
        const config = {
          databaseUrl: target.href,
          jwtSecret: Buffer.alloc(32, 1),
          contactKey: Buffer.alloc(32, 2),
          otpKey: Buffer.alloc(32, 3),
          cookieSecure: false,
        };
        const deps = {
          db,
          config,
          frontendOrigin: "http://127.0.0.1:5173",
          otp: new OtpService(db, config, {
            available: () => false,
            async send() {},
          }),
        };
        const session = await db.session.create({
          data: { userId: user, expiresAt: new Date(Date.now() + 600000) },
        });
        await db.event.update({
          where: { id: event },
          data: { state: "COMPLETED" },
        });
        const actor = { userId: user, sessionId: session.id };
        const legacy = await eventResults(deps, actor, event, randomUUID());
        expect(legacy.certificate_issued_count).toBe(1);
        expect(Object.values(legacy.certificate_delivery_counts)).toEqual([
          0, 0, 0, 0, 0, 0,
        ]);
        expect(legacy.data_limitations).toContain(
          "DELIVERY_STATE_NOT_RECORDED",
        );
        const delivery = await db.$transaction((tx) =>
          ensureDelivery(tx, work, randomUUID()),
        );
        expect(delivery.delivery.status).toBe("NOT_REQUIRED");
        await insert("AuditEvent", {
          id: randomUUID(),
          actorKind: "ACCOUNT",
          actorUserId: user,
          eventId: event,
          action: "CERTIFICATE_ISSUED",
          outcome: "SUCCESS",
          correlationId: randomUUID(),
          metadata: { issue_work_id: work },
        });
        const tables = (
          await sql.query(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
          )
        ).rows.map((r: { tablename: string }) => r.tablename);
        const snapshots = new Map<string, unknown>(),
          columns = new Map<string, unknown>();
        for (const table of tables) {
          snapshots.set(
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
                "SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
                [table],
              )
            ).rows,
          );
        }
        await sql.query(
          readFileSync(resolve(root, current, "migration.sql"), "utf8"),
        );
        for (const table of tables) {
          expect(
            (
              await sql.query(
                `SELECT to_jsonb(t) row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
              )
            ).rows,
          ).toEqual(snapshots.get(table));
          expect(
            (
              await sql.query(
                "SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
                [table],
              )
            ).rows,
          ).toEqual(columns.get(table));
        }
        expect(
          (
            await sql.query(
              'SELECT "pdfBytes" FROM "Certificate" WHERE id=$1',
              [work],
            )
          ).rows[0].pdfBytes,
        ).toEqual(pdf);
        const results = await eventResults(deps, actor, event, randomUUID());
        expect(results.certificate_issued_count).toBe(1);
        expect(results.certificate_delivery_counts.NOT_REQUIRED).toBe(1);
        expect(results.data_limitations).not.toContain(
          "DELIVERY_STATE_NOT_RECORDED",
        );
        const grant = randomUUID();
        await insert("EventRoleAssignment", {
          id: grant,
          eventId: event,
          userId: user,
          role: "VOLUNTEER",
          scopeKey: "EVENT",
          grantedByUserId: user,
        });
        const client = db,
          base = {
            eventId: event,
            createdByUserId: user,
            creationKeyHash: "d".repeat(64),
            assignedVolunteerId: user,
            assignedRoleGrantId: grant,
            title: "Task",
            instructions: "Help arrivals",
          };
        for (const invalid of [
          { revision: 0 },
          { title: " " },
          { instructions: "x".repeat(4001) },
          { location: " \t" },
          { startsAt: at, endsAt: at },
          { status: "COMPLETED" as const },
          { cancellationReason: "Without cancellation" },
          { assignedVolunteerId: randomUUID() },
          { assignedRoleGrantId: randomUUID() },
        ])
          await expect(
            client.volunteerTask.create({ data: { ...base, ...invalid } }),
          ).rejects.toThrow();
        const task = await client.volunteerTask.create({ data: base });
        await expect(
          client.eventRoleAssignment.update({
            where: { id: grant },
            data: { role: "EVENT_ADMIN" },
          }),
        ).rejects.toThrow();
        for (const invalid of [
          { title: "Changed" },
          { revision: 2 },
          { eventId: randomUUID(), revision: 2 },
          { status: "COMPLETED" as const, revision: 2 },
          { status: "CANCELLED" as const, revision: 2 },
          { assignedRoleGrantId: randomUUID(), revision: 2 },
        ])
          await expect(
            client.volunteerTask.update({
              where: { id: task.id },
              data: invalid,
            }),
          ).rejects.toThrow();
        const cancelledAt = new Date();
        await client.volunteerTask.update({
          where: { id: task.id },
          data: {
            status: "CANCELLED",
            revision: 2,
            updatedAt: cancelledAt,
            cancelledAt,
            cancelledByUserId: user,
            cancellationReason: "Closed shift",
          },
        });
        for (const invalid of [
          { title: "Changed", revision: 3 },
          {
            status: "ASSIGNED" as const,
            revision: 3,
            cancelledAt: null,
            cancelledByUserId: null,
            cancellationReason: null,
          },
          { cancellationReason: "Changed evidence", revision: 3 },
        ])
          await expect(
            client.volunteerTask.update({
              where: { id: task.id },
              data: invalid,
            }),
          ).rejects.toThrow();
        await expect(
          client.volunteerTask.delete({ where: { id: task.id } }),
        ).rejects.toThrow();
        const second = await client.volunteerTask.create({
          data: { ...base, creationKeyHash: "e".repeat(64) },
        });
        await client.volunteerTask.update({
          where: { id: second.id },
          data: { status: "IN_PROGRESS", revision: 2 },
        });
        await expect(
          client.volunteerTask.update({
            where: { id: second.id },
            data: { assignedRoleGrantId: randomUUID(), revision: 3 },
          }),
        ).rejects.toThrow();
        await client.volunteerTask.update({
          where: { id: second.id },
          data: { status: "COMPLETED", revision: 3 },
        });
        await expect(
          client.volunteerTask.update({
            where: { id: second.id },
            data: { instructions: "Changed", revision: 4 },
          }),
        ).rejects.toThrow();
        await client.eventRoleAssignment.update({
          where: { id: grant },
          data: { revokedAt: new Date(), revokedByUserId: user },
        });
        await expect(
          client.volunteerTask.create({
            data: { ...base, creationKeyHash: "f".repeat(64) },
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
