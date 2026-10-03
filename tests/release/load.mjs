import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { io } from "socket.io-client";
import { spawn } from "node:child_process";
import { fixture, api, origin } from "./fixture.mjs";

const f = await fixture(),
  sockets = [],
  timings = {},
  errors = {},
  windows = {},
  resources = [];
const record = (kind, ms) => (timings[kind] ??= []).push(ms);
async function timed(kind, run, expected = [200]) {
  const started = performance.now();
  windows[kind] ??= { start: started, end: started };
  try {
    const result = await run();
    record(kind, performance.now() - started);
    if (!expected.includes(result.status))
      errors[kind] = (errors[kind] ?? 0) + 1;
    return result;
  } catch (error) {
    record(kind, performance.now() - started);
    errors[kind] = (errors[kind] ?? 0) + 1;
    throw error;
  } finally {
    windows[kind].end = performance.now();
  }
}
let sampling;
function sampleResources() {
  if (sampling) return;
  sampling = new Promise((resolve) => {
    const child = spawn("docker", [
      "stats",
      "--no-stream",
      "--format",
      "{{json .}}",
    ]);
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", resolve);
    child.on("close", () => {
      for (const line of output.trim().split("\n")) {
        try {
          const row = JSON.parse(line);
          if (row.Name.startsWith("slice12-demo-"))
            resources.push({
              name: row.Name,
              cpu_percent: parseFloat(row.CPUPerc),
              memory: row.MemUsage,
            });
        } catch {}
      }
      resolve();
    });
  }).finally(() => {
    sampling = null;
  });
}
const resourceTimer = setInterval(sampleResources, 2000);
sampleResources();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const started = performance.now();
try {
  const users = await Promise.all(Array.from({ length: 100 }, () => f.actor()));
  for (const user of users.slice(0, 20))
    await f.db.eventRoleAssignment.create({
      data: {
        eventId: f.event.id,
        scopeKey: "EVENT",
        userId: user.id,
        role: "EVENT_ADMIN",
        grantedByUserId: f.staff.id,
      },
    });
  const baseline = await api(`/events/${f.event.id}/operations`, f.staff);
  assert.equal(baseline.status, 200);
  const clients = await Promise.all(
    users.slice(0, 20).map(async (actor) => {
      const socket = io(origin, {
        path: "/api/v1/realtime/socket.io",
        transports: ["websocket"],
        extraHeaders: { Cookie: `eoc_session=${actor.token}`, Origin: origin },
        reconnection: false,
      });
      sockets.push(socket);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Socket connection timeout")),
          15000,
        );
        socket.once("connect", () => {
          clearTimeout(timer);
          resolve();
        });
        socket.once("connect_error", reject);
      });
      await new Promise((resolve, reject) =>
        socket
          .timeout(15000)
          .emit(
            "operations.subscribe",
            { event_id: f.event.id },
            (error, result) => {
              if (error || !result.ok) reject(error ?? new Error(result.code));
              else resolve();
            },
          ),
      );
      let requiredRevision = 0;
      const client = {
        socket,
        actor,
        confirmed: baseline.body.revision,
        confirmedAt: new Map(),
        inFlight: null,
      };
      socket.on("occupancy.updated", (message) => {
        requiredRevision = Math.max(requiredRevision, message.revision);
        if (client.inFlight) return;
        client.inFlight = (async () => {
          while (client.confirmed < requiredRevision) {
            const response = await api(
              `/events/${f.event.id}/operations`,
              actor,
            );
            assert.equal(response.status, 200);
            client.confirmed = response.body.revision;
            client.confirmedAt.set(client.confirmed, performance.now());
          }
        })()
          .catch(() => {
            errors.reconciliation = (errors.reconciliation ?? 0) + 1;
          })
          .finally(() => {
            client.inFlight = null;
          });
      });
      return client;
    }),
  );
  // Opening burst uses real registration commands and distinct verified accounts.
  await Promise.all(
    users.map((actor) =>
      timed(
        "registration_burst",
        () =>
          api(`/events/${f.event.id}/registrations`, actor, {
            method: "POST",
            body: "{}",
          }),
        [201],
      ),
    ),
  );
  assert.equal(
    await f.db.registration.count({ where: { eventId: f.event.id } }),
    100,
  );
  const live = await api(`/events/${f.event.id}/transitions`, f.staff, {
    method: "POST",
    headers: { "If-Match": '"1"' },
    body: JSON.stringify({ target_state: "LIVE" }),
  });
  assert.equal(live.status, 200);
  const registrations = await f.db.registration.findMany({
    where: { eventId: f.event.id },
    orderBy: { id: "asc" },
  });
  const scans = await Promise.all(
    registrations.slice(0, 20).map(async (row) => ({
      scan_id: randomUUID(),
      event_id: f.event.id,
      gate_id: f.gate.id,
      credential: await f.credential(row.id),
    })),
  );
  // 100 concurrent virtual users: 20 dashboard consumers plus 80 paced API users.
  const background = Promise.all(
    users.slice(20).map(async (actor, index) => {
      for (let round = 0; round < 10; round++) {
        const begin = performance.now();
        await timed("normal_api", () =>
          api(`/events/${f.event.id}/registrations`, actor),
        );
        if (index % 20 === 0)
          await timed("forecast", () =>
            api(`/events/${f.event.id}/forecasts/current`, f.staff),
          );
        await sleep(Math.max(0, 1000 - (performance.now() - begin)));
      }
    }),
  );
  const propagationStart = performance.now(),
    wallStart = Date.now();
  const accepted = await Promise.all(
    scans.map((scan) =>
      timed("check_in", () =>
        api("/scan-decisions", f.scanner, {
          method: "POST",
          headers: { "Idempotency-Key": scan.scan_id },
          body: JSON.stringify(scan),
        }),
      ),
    ),
  );
  // Conservative upper bound: start of concurrent scan submission through client
  // notification AND successful REST confirmation. Not socket connectivity alone.
  const deadline = performance.now() + 20000;
  while (
    clients.some((client) => client.confirmed < 20) &&
    performance.now() < deadline
  )
    await sleep(25);
  for (const client of clients) {
    const confirmedAt = [...client.confirmedAt].find(
      ([revision]) => revision >= 20,
    )?.[1];
    if (confirmedAt === undefined)
      errors.propagation = (errors.propagation ?? 0) + 1;
    else {
      // All clocks run on the same demo host. Confirming the final revision
      // proves all 20 accepted transitions reached this client via REST.
      for (const response of accepted)
        record(
          "realtime_propagation",
          Math.max(
            0,
            wallStart +
              confirmedAt -
              propagationStart -
              Date.parse(response.body.decided_at),
          ),
        );
    }
  }
  const replay = await api("/scan-decisions", f.scanner, {
    method: "POST",
    headers: { "Idempotency-Key": scans[0].scan_id },
    body: JSON.stringify(scans[0]),
  });
  assert.equal(replay.status, 200);
  assert.equal(
    await f.db.attendanceTransition.count({ where: { eventId: f.event.id } }),
    20,
  );
  await background;
  clearInterval(resourceTimer);
  await sampling;
  const elapsed = (performance.now() - started) / 1000;
  const report = {
    environment:
      "single-instance Docker Desktop, HTTPS; synthetic distinct accounts; local generator",
    workload: {
      concurrent_users: 100,
      concurrent_scans: 20,
      dashboard_clients: 20,
      paced_api_users: 80,
      rounds: 10,
    },
    duration_seconds: elapsed,
    errors,
    metrics: Object.fromEntries(
      Object.entries(timings).map(([kind, values]) => {
        values.sort((a, b) => a - b);
        const percentile = (p) =>
          values[Math.max(0, Math.ceil(p * values.length) - 1)];
        return [
          kind,
          {
            samples: values.length,
            p50_ms: percentile(0.5),
            p95_ms: percentile(0.95),
            p99_ms: percentile(0.99),
            throughput_per_second_over_entire_run: values.length / elapsed,
            error_rate: (errors[kind] ?? 0) / values.length,
          },
        ];
      }),
    ),
    integrity: "20 accepted transitions; same-key replay preserved",
    saturation: "Use concurrent docker stats; no production hardware claim",
  };
  for (const [kind, window] of Object.entries(windows)) {
    report.metrics[kind].workload_window_seconds =
      (window.end - window.start) / 1000;
    report.metrics[kind].throughput_per_second =
      report.metrics[kind].samples /
      report.metrics[kind].workload_window_seconds;
  }
  report.resource_samples = resources;
  report.propagation_measurement =
    "Server decided_at through final client REST confirmation after socket notification; coalesced final revision provides conservative upper bounds for all 20 transitions × 20 clients; same-host wall clocks.";
  report.acceptance = {
    check_in:
      report.metrics.check_in.p95_ms <= 2000 && !errors.check_in
        ? "PASS"
        : "NOT MET",
    propagation:
      report.metrics.realtime_propagation?.p95_ms <= 5000 && !errors.propagation
        ? "PASS"
        : "NOT MET",
  };
  await mkdir(".artifacts/release", { recursive: true });
  await writeFile(
    ".artifacts/release/load.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  clearInterval(resourceTimer);
  await sampling;
  sockets.forEach((socket) => socket.disconnect());
  await f.db.$disconnect();
}
