// Synthetic local stacks only: fixture enforces eoc_demo on loopback 55432.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";
import { fixture, api, origin } from "../release/fixture.mjs";

const f = await fixture();
let socket;
try {
  for (const path of ["/", "/events/example", "/health/live", "/health/ready"])
    assert.equal((await fetch(origin + path)).status, 200);
  const edge = await fetch(origin + "/");
  assert.equal(
    edge.headers.get("strict-transport-security"),
    "max-age=31536000",
  );
  assert.equal(edge.headers.get("x-content-type-options"), "nosniff");
  assert.equal(edge.headers.get("x-frame-options"), "DENY");
  assert.equal(edge.headers.get("referrer-policy"), "no-referrer");
  assert.equal(
    edge.headers.get("content-security-policy"),
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  assert.equal((await fetch(origin + "/internal/metrics")).status, 404);
  assert.equal(
    (await fetch(origin + `/api/v1/events/${f.event.id}/operations`)).status,
    401,
  );
  const participant = await f.actor();
  assert.equal(
    (await api(`/events/${f.event.id}/operations`, participant)).status,
    404,
  );
  const missingCsrf = await fetch(origin + `/api/v1/events/${f.event.id}`, {
    method: "PATCH",
    headers: {
      Cookie: `eoc_session=${f.staff.token}`,
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(missingCsrf.status, 403);
  const foreign = await fetch(origin + "/api/v1/auth/session", {
    method: "OPTIONS",
    headers: {
      Origin: "https://attacker.example.invalid",
      "Access-Control-Request-Method": "GET",
    },
  });
  assert.equal(foreign.headers.get("access-control-allow-origin"), null);
  socket = io(origin, {
    path: "/api/v1/realtime/socket.io",
    transports: ["websocket"],
    reconnection: false,
    extraHeaders: { Cookie: `eoc_session=${f.staff.token}`, Origin: origin },
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Socket connect timeout")),
      10000,
    );
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  await new Promise((resolve, reject) =>
    socket
      .timeout(10000)
      .emit(
        "operations.subscribe",
        { event_id: f.event.id },
        (error, result) => {
          if (error || !result.ok) reject(error ?? new Error(result.code));
          else resolve();
        },
      ),
  );
  const registered = await api(
    `/events/${f.event.id}/registrations`,
    participant,
    { method: "POST", body: "{}" },
  );
  assert.equal(registered.status, 201);
  assert.equal(
    (
      await api(`/events/${f.event.id}/transitions`, f.staff, {
        method: "POST",
        headers: { "If-Match": '"1"' },
        body: JSON.stringify({ target_state: "LIVE" }),
      })
    ).status,
    200,
  );
  const row = await f.db.registration.findFirstOrThrow({
    where: { eventId: f.event.id },
  });
  const scan = {
    scan_id: randomUUID(),
    event_id: f.event.id,
    gate_id: f.gate.id,
    credential: await f.credential(row.id),
  };
  const updated = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Attendance notification timeout")),
      10000,
    );
    socket.on("occupancy.updated", (message) => {
      if (message.revision >= 1) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  const options = {
    method: "POST",
    headers: { "Idempotency-Key": scan.scan_id },
    body: JSON.stringify(scan),
  };
  assert.equal((await api("/scan-decisions", f.scanner, options)).status, 200);
  await updated;
  assert.equal((await api("/scan-decisions", f.scanner, options)).status, 200);
  assert.equal(
    (await api(`/events/${f.event.id}/operations`, f.staff)).body.revision,
    1,
  );
  console.log(
    "PASS: SPA, health, exact headers, internal denial, auth/RBAC/CSRF/Origin, WebSocket notification + REST reconciliation, accepted scan replay",
  );
} finally {
  socket?.disconnect();
  await f.db.$disconnect();
}
