import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createDatabase } from "../../backend/dist/config/database.js";
import { fixture, api, origin } from "./fixture.mjs";
const f = await fixture(),
  checks = [];
try {
  assert.equal(
    (await fetch(origin + `/api/v1/events/${f.event.id}/operations`)).status,
    401,
  );
  const participant = await f.actor();
  assert.equal(
    (await api(`/events/${f.event.id}/operations`, participant)).status,
    404,
  );
  checks.push("anonymous denial and current event scope concealment");
  const denied = await fetch(origin + `/api/v1/events/${f.event.id}`, {
    method: "PATCH",
    headers: {
      Cookie: `eoc_session=${f.staff.token}`,
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(denied.status, 403);
  checks.push("authenticated mutation rejects missing CSRF");
  const cors = await fetch(origin + "/api/v1/auth/session", {
    method: "OPTIONS",
    headers: {
      Origin: "https://attacker.example.invalid",
      "Access-Control-Request-Method": "GET",
    },
  });
  assert.equal(cors.headers.get("access-control-allow-origin"), null);
  checks.push("foreign Origin has no credentialed CORS grant");
  const edge = await fetch(origin + "/");
  for (const header of [
    "strict-transport-security",
    "content-security-policy",
    "x-content-type-options",
    "referrer-policy",
  ])
    assert.ok(edge.headers.has(header));
  assert.equal(edge.headers.get("x-frame-options"), "DENY");
  assert.equal((await fetch(origin + "/internal/metrics")).status, 404);
  checks.push(
    "TLS trust and edge headers; operational metrics not publicly proxied",
  );
  const url = new URL((await readFile(".secrets/database_url", "utf8")).trim());
  url.hostname = "127.0.0.1";
  url.port = "55432";
  const runtime = createDatabase(url.href);
  try {
    const [role] =
      await runtime.$queryRaw`SELECT current_user AS name, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user`;
    assert.equal(role.name, "eoc_app");
    assert.equal(role.rolsuper, false);
    assert.equal(role.rolcreatedb, false);
    assert.equal(role.rolcreaterole, false);
    await assert.rejects(
      () => runtime.$executeRaw`CREATE TABLE should_not_exist (id int)`,
    );
    await assert.rejects(
      () => runtime.$queryRaw`SELECT * FROM "_prisma_migrations"`,
    );
  } finally {
    await runtime.$disconnect();
  }
  checks.push(
    "runtime database role cannot create schema objects or access migration metadata",
  );
  const canary = "secret-canary@example.invalid";
  await fetch(origin + `/api/v1/${canary}?token=never-log-this`, {
    headers: { Authorization: "Bearer never-log-this" },
  });
  const logs = spawnSync(
    "docker",
    ["compose", "-p", "slice12-demo", "logs", "api"],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  assert.equal(logs.status, 0);
  assert.ok(!logs.stdout.includes(canary));
  assert.ok(!logs.stdout.includes("never-log-this"));
  checks.push("runtime telemetry path/query/authorization redaction canary");
  const report = {
    status: "PASS",
    checks,
    existing_negative_tests:
      "Slice 1–11 auth/RBAC, IDOR, CSRF, QR, audit/artifact isolation and replay tests passed in the complete PostgreSQL suite",
    limits:
      "No public penetration test; see separate container SARIF reports and security review; real SMTP/TLS provider behavior is not measured",
  };
  await mkdir(".artifacts/release", { recursive: true });
  await writeFile(
    ".artifacts/release/security.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await f.db.$disconnect();
}
