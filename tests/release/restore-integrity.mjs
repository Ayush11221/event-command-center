import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createDatabase } from "../../backend/dist/config/database.js";
const name = process.env.SLICE12_RESTORE_DATABASE ?? "eoc_restore_verified";
assert.match(name, /^eoc_restore_[a-z0-9_]+$/);
const url = new URL((await readFile(".secrets/migration_url", "utf8")).trim());
url.hostname = "127.0.0.1";
url.port = "55432";
const source = createDatabase(url.href);
url.pathname = "/" + name;
const restored = createDatabase(url.href);
const started = performance.now();
try {
  const tables = [
    "User",
    "VerifiedContact",
    "Session",
    "Event",
    "EventRoleAssignment",
    "Gate",
    "Registration",
    "GuestIdentity",
    "QRCredential",
    "ScanDecision",
    "AttendanceTransition",
    "ForecastRun",
    "CertificateRecipientName",
    "Certificate",
    "CertificateIssueWork",
    "CertificateBatch",
    "CertificateBatchItem",
    "CertificateDelivery",
    "CertificateDeliveryAttempt",
    "AuditEvent",
    "CommandReplay",
    "VolunteerTask",
  ];
  const evidence = [];
  for (const table of tables) {
    // Table names are a closed source-code allowlist, never user input.
    const query = `SELECT count(*) AS count, md5(COALESCE(string_agg(to_jsonb(t)::text, ',' ORDER BY to_jsonb(t)::text),'')) AS hash FROM "${table}" t`;
    const [before] = await source.$queryRawUnsafe(query),
      [after] = await restored.$queryRawUnsafe(query);
    assert.deepEqual(
      after,
      before,
      `${table}: restore must match the quiescent source`,
    );
    evidence.push({ table, rows: Number(after.count), status: "PASS" });
  }
  const certs = await restored.certificate.findMany();
  assert.ok(certs.length > 0);
  for (const cert of certs)
    assert.equal(
      createHash("sha256").update(cert.pdfBytes).digest("hex"),
      cert.pdfSha256,
    );
  const [invalid] =
    await restored.$queryRaw`SELECT count(*) AS count FROM "AttendanceTransition" a LEFT JOIN "Registration" r ON r.id=a."registrationId" AND r."eventId"=a."eventId" WHERE r.id IS NULL OR r.state<>'REGISTERED'`;
  assert.equal(invalid.count, 0n);
  const [occupancy] =
    await restored.$queryRaw`SELECT count(*) AS inside FROM "AttendanceTransition" WHERE kind='CHECK_IN'`;
  const report = {
    status: "PASS",
    database: name,
    tables: evidence,
    pdf_hashes_verified: certs.length,
    reconciled_inside: Number(occupancy.inside),
    integrity_seconds: (performance.now() - started) / 1000,
    workers_started: false,
    smtp: "Offline restore only; no external effects resumed. Full application recovery after SMTP reconciliation is NOT MEASURED.",
  };
  await mkdir(".artifacts/release", { recursive: true });
  await writeFile(
    ".artifacts/release/restore-integrity.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await source.$disconnect();
  await restored.$disconnect();
}
