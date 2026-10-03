import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { io } from "socket.io-client";
import { fixture, api, origin } from "./fixture.mjs";
const f = await fixture(),
  evidence = [];
function compose(...args) {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-p",
      "slice12-demo",
      "-f",
      "docker-compose.yml",
      "-f",
      "docker/verification.yml",
      ...args,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function ready() {
  for (let i = 0; i < 60; i++) {
    try {
      if (
        (
          await fetch(origin + "/health/ready", {
            signal: AbortSignal.timeout(2000),
          })
        ).ok
      )
        return;
    } catch {}
    await sleep(500);
  }
  throw new Error("Readiness did not recover");
}
try {
  const owner = await f.actor();
  assert.equal(
    (
      await api(`/events/${f.event.id}/registrations`, owner, {
        method: "POST",
        body: "{}",
      })
    ).status,
    201,
  );
  const row = await f.db.registration.findFirstOrThrow({
    where: { eventId: f.event.id, userId: owner.id },
  });
  const participants = [{ owner, row }];
  for (let i = 0; i < 5; i++) {
    const actor = await f.actor();
    assert.equal(
      (
        await api(`/events/${f.event.id}/registrations`, actor, {
          method: "POST",
          body: "{}",
        })
      ).status,
      201,
    );
    participants.push({
      owner: actor,
      row: await f.db.registration.findFirstOrThrow({
        where: { eventId: f.event.id, userId: actor.id },
      }),
    });
  }
  assert.equal(
    (
      await api(`/events/${f.event.id}/transitions`, f.staff, {
        method: "POST",
        headers: { "If-Match": '"1"' },
        body: '{"target_state":"LIVE"}',
      })
    ).status,
    200,
  );
  const scan = {
    scan_id: randomUUID(),
    event_id: f.event.id,
    gate_id: f.gate.id,
    credential: await f.credential(row.id),
  };
  const submit = () =>
    api("/scan-decisions", f.scanner, {
      method: "POST",
      headers: { "Idempotency-Key": scan.scan_id },
      body: JSON.stringify(scan),
    });
  assert.equal((await submit()).status, 200);
  compose("restart", "api");
  await ready();
  assert.equal((await submit()).body.replayed, true);
  assert.equal(
    await f.db.attendanceTransition.count({ where: { eventId: f.event.id } }),
    1,
  );
  evidence.push({
    scenario: "API restart; accepted check-in replay and durable ledger",
    status: "PASS",
  });
  compose("restart", "frontend");
  await ready();
  assert.equal((await fetch(origin + "/operations/" + f.event.id)).status, 200);
  evidence.push({
    scenario: "frontend restart; protected deep-link shell",
    status: "PASS",
  });
  compose("stop", "postgres");
  try {
    assert.equal(
      (
        await fetch(origin + "/health/ready", {
          signal: AbortSignal.timeout(10000),
        })
      ).status,
      503,
    );
    const result = await submit();
    assert.equal(result.status, 503);
  } finally {
    compose("start", "postgres");
    await ready();
  }
  assert.equal((await submit()).body.replayed, true);
  evidence.push({
    scenario:
      "PostgreSQL interruption/recovery; no false ready or duplicate transition",
    status: "PASS",
  });
  compose("stop", "forecast");
  try {
    const forecast = await api(
      `/events/${f.event.id}/forecasts/current`,
      f.staff,
    );
    assert.equal(forecast.status, 200);
    assert.equal(forecast.body.forecast.status, "MODEL_UNAVAILABLE");
    assert.equal((await submit()).status, 200);
  } finally {
    compose("start", "forecast");
  }
  evidence.push({
    scenario:
      "FastAPI outage isolates attendance; persisted explicit unavailable forecast",
    status: "PASS",
  });
  compose("pause", "forecast");
  try {
    const [forecast, scan] = await Promise.all([
      api(`/events/${f.event.id}/forecasts/current`, f.staff),
      submit(),
    ]);
    assert.equal(forecast.status, 200);
    assert.equal(forecast.body.forecast.status, "MODEL_UNAVAILABLE");
    assert.equal(scan.status, 200);
  } finally {
    compose("unpause", "forecast");
  }
  evidence.push({
    scenario:
      "Paused FastAPI transport timeout concurrent with successful core attendance replay",
    status: "PASS",
  });
  const socket = io(origin, {
    path: "/api/v1/realtime/socket.io",
    transports: ["websocket"],
    extraHeaders: { Cookie: `eoc_session=${f.staff.token}`, Origin: origin },
    reconnection: false,
  });
  try {
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    await new Promise((resolve, reject) =>
      socket
        .timeout(10000)
        .emit(
          "operations.subscribe",
          { event_id: f.event.id },
          (error, result) =>
            error || !result.ok
              ? reject(error ?? new Error(result.code))
              : resolve(),
        ),
    );
    socket.disconnect();
    const missed = {
      scan_id: randomUUID(),
      event_id: f.event.id,
      gate_id: f.gate.id,
      credential: await f.credential(participants[1].row.id),
    };
    assert.equal(
      (
        await api("/scan-decisions", f.scanner, {
          method: "POST",
          headers: { "Idempotency-Key": missed.scan_id },
          body: JSON.stringify(missed),
        })
      ).status,
      200,
    );
    const snapshot = await api(`/events/${f.event.id}/operations`, f.staff);
    assert.equal(snapshot.body.revision, 2);
    socket.connect();
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    const restored = await new Promise((resolve, reject) =>
      socket
        .timeout(10000)
        .emit(
          "operations.subscribe",
          { event_id: f.event.id },
          (error, result) =>
            error || !result.ok
              ? reject(error ?? new Error(result.code))
              : resolve(result),
        ),
    );
    assert.equal(restored.revision, snapshot.body.revision);
    evidence.push({
      scenario:
        "Missed accepted update while disconnected; reconnect and authoritative REST reconciliation",
      status: "PASS",
    });
  } finally {
    socket.disconnect();
  }
  for (let i = 0; i < participants.length; i++) {
    const participant = participants[i];
    if (i >= 2) {
      const input = {
        scan_id: randomUUID(),
        event_id: f.event.id,
        gate_id: f.gate.id,
        credential: await f.credential(participant.row.id),
      };
      assert.equal(
        (
          await api("/scan-decisions", f.scanner, {
            method: "POST",
            headers: { "Idempotency-Key": input.scan_id },
            body: JSON.stringify(input),
          })
        ).status,
        200,
      );
    }
    assert.equal(
      (
        await api(
          `/registrations/${participant.row.id}/certificate/recipient-name`,
          participant.owner,
          { method: "POST", body: '{"recipient_name":"Synthetic Recipient"}' },
        )
      ).status,
      200,
    );
  }
  const batchBody = {
      registration_ids: participants.map((p) => p.row.id),
      template_id: "classic",
      template_version: 1,
      font_id: "sans",
    },
    batchKey = randomUUID();
  const accepted = await api(
    `/events/${f.event.id}/certificate-batches`,
    f.staff,
    {
      method: "POST",
      headers: { "Idempotency-Key": batchKey },
      body: JSON.stringify(batchBody),
    },
  );
  assert.equal(accepted.status, 202);
  compose("kill", "-s", "SIGKILL", "api");
  const interrupted = await f.db.certificateBatch.findUniqueOrThrow({
    where: { id: accepted.body.batch.batch_id },
  });
  assert.ok(
    ["PENDING", "RUNNING"].includes(interrupted.status),
    "Batch must still be unfinished at process interruption",
  );
  compose("start", "api");
  await ready();
  let batch;
  for (let i = 0; i < 90; i++) {
    batch = await f.db.certificateBatch.findUniqueOrThrow({
      where: { id: interrupted.id },
    });
    if (batch.status === "COMPLETED") break;
    await sleep(500);
  }
  assert.equal(batch.status, "COMPLETED");
  const certificates = await f.db.certificate.findMany({
    where: { eventId: f.event.id },
  });
  assert.equal(certificates.length, 6);
  for (const cert of certificates)
    assert.equal(
      createHash("sha256").update(cert.pdfBytes).digest("hex"),
      cert.pdfSha256,
    );
  const replay = await api(
    `/events/${f.event.id}/certificate-batches`,
    f.staff,
    {
      method: "POST",
      headers: { "Idempotency-Key": batchKey },
      body: JSON.stringify(batchBody),
    },
  );
  assert.equal(replay.body.batch.batch_id, interrupted.id);
  assert.equal(
    await f.db.certificate.count({ where: { eventId: f.event.id } }),
    6,
  );
  evidence.push({
    scenario:
      "SIGKILL during unfinished durable batch; worker resume, acceptance replay, six unique certificates and PDF hashes",
    status: "PASS",
  });
  const report = {
    status: "PASS",
    evidence,
    additional_contract_evidence:
      "Complete Slice 9/10 PostgreSQL tests cover renderer fencing, durable acceptance, batch claims, retry limits, UNKNOWN and revocation/SENDING; real TCP SMTP fixtures exercise SENT/FAILED/UNKNOWN.",
  };
  await mkdir(".artifacts/release", { recursive: true });
  await writeFile(
    ".artifacts/release/failure.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  compose("start", "postgres", "forecast");
  await f.db.$disconnect();
}
