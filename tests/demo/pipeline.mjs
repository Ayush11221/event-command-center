// Real API-to-Python verification in the isolated local demo; no service mocks.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ORIGIN, EVENT_NAME } from "./isolation.mjs";
import { recoverCredential } from "../../backend/dist/modules/registrations/credential.js";
import {
  minute,
  historicalEvent,
  fixtureSessions,
  validateFixture,
  isolation,
} from "./ledger.mjs";
async function api(path, who, options = {}) {
  const response = await fetch(`http://api:3000/api/v1${path}`, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: {
      ...(who
        ? { Cookie: `eoc_session=${who.token}`, "X-CSRF-Token": who.csrf }
        : {}),
      Origin: ORIGIN,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
      ...options.headers,
    },
  });
  return { status: response.status, body: await response.json() };
}
async function forecastRead(eventId, owner) {
  const correlation = randomUUID();
  const result = await api(`/events/${eventId}/forecasts/current`, owner, {
    headers: { "X-Correlation-Id": correlation },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.correlation_id, correlation);
  return { response: result.body, correlation };
}
async function assertPersisted(db, response) {
  const run = response.forecast;
  assert(/^[a-f0-9-]{36}$/.test(run.run_id));
  const stored = await db.forecastRun.findUniqueOrThrow({
    where: { id: run.run_id },
  });
  assert.equal(stored.eventId, response.event_id);
  const { run_id, persisted_at, freshness, ...computed } = run;
  assert.deepEqual(stored.result, computed);
  assert.equal(run.input.occupied, run.input.revision);
  assert.equal(run.input.occupied, response.observed.occupied);
  assert.equal(run.input.revision, response.observed.revision);
  return {
    run_id: run.run_id,
    status: run.status,
    observation_count: run.input.observation_count,
    regular_observations:
      run.input.observation_count -
      (Date.parse(run.input.end_at) % minute === 0 ? 0 : 1),
    occupied: run.input.occupied,
    revision: run.input.revision,
  };
}
async function boundary(db, fixture, owner, contactKey, size) {
  // Avoid creating fixtures just before rollover; never change the system clock.
  let [{ now }] = await db.$queryRaw`SELECT statement_timestamp() AS now`;
  if (now.getUTCSeconds() > 50 || now.getUTCSeconds() < 2) {
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        now.getUTCSeconds() > 50 ? (62 - now.getUTCSeconds()) * 1000 : 2200,
      ),
    );
    [{ now }] = await db.$queryRaw`SELECT statement_timestamp() AS now`;
  }
  const event = await db.$transaction((tx) =>
    historicalEvent(
      tx,
      fixture.owner,
      fixture.scanner,
      `Synthetic threshold verification (${size})`,
      Math.floor(now.getTime() / minute) * minute - (size - 1) * minute,
      1,
      contactKey,
    ),
  );
  const { response, correlation } = await forecastRead(event.event_id, owner);
  const evidence = await assertPersisted(db, response);
  assert.equal(evidence.regular_observations, size);
  assert.equal(
    evidence.observation_count,
    size + 1,
    "Off-minute endpoint must be separate.",
  );
  assert.equal(
    evidence.status,
    size === 269 ? "INSUFFICIENT_DATA" : "AVAILABLE",
  );
  return { evidence, correlation };
}

export async function verify(db, instance, fixture, jwt, contactKey) {
  await isolation(db, instance, false);
  const event = await validateFixture(db, fixture);
  const sessions = await fixtureSessions(db, fixture, jwt);
  const registrations = {};
  for (const role of ["participant", "arrival"]) {
    const registered = await api(
      `/events/${event.id}/registrations`,
      sessions[role],
      {
        method: "POST",
        body: "{}",
        headers: { "Idempotency-Key": fixture[role] },
      },
    );
    assert.equal(registered.status, 201);
    registrations[role] = registered.body.registration.registration_id;
  }
  const primaryCredential = await api(
    `/registrations/${registrations.participant}/credential`,
    sessions.participant,
  );
  assert.equal(primaryCredential.status, 200);
  assert(primaryCredential.body.qr_svg.startsWith("<svg"));
  const row = await db.qRCredential.findUniqueOrThrow({
    where: { id: primaryCredential.body.credential_id },
  });
  const credential = recoverCredential(
    registrations.participant,
    row.protectedRepresentation,
    contactKey,
  );
  const live = await api(`/events/${event.id}/transitions`, sessions.owner, {
    method: "POST",
    body: '{"target_state":"LIVE"}',
    headers: { "If-Match": '"1"', "Idempotency-Key": event.id },
  });
  assert.equal(live.status, 200);
  const submit = (scan_id) =>
    api("/scan-decisions", sessions.scanner, {
      method: "POST",
      body: JSON.stringify({
        scan_id,
        event_id: event.id,
        gate_id: fixture.gate_id,
        credential,
      }),
      headers: { "Idempotency-Key": scan_id },
    });
  const accepted = await submit(fixture.scan_id);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.decision, "ACCEPTED");
  const duplicate = await submit(fixture.duplicate_scan_id);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.reason, "ALREADY_CHECKED_IN");
  assert.equal(duplicate.body.decision, "REJECTED");
  assert.equal(
    await db.attendanceTransition.count({
      where: { registrationId: registrations.participant },
    }),
    1,
  );
  const scanCount = await db.scanDecision.count({
    where: { eventId: event.id },
  });
  const decisionData = {
    eventId: event.id,
    gateId: fixture.gate_id,
    operatorUserId: fixture.scanner,
    registrationId: registrations.participant,
    credentialId: row.id,
    scanId: randomUUID(),
    decision: "ACCEPTED",
    reason: "ACCEPTED",
    decidedAt: new Date(),
    correlationId: randomUUID(),
  };
  // Negative integrity probes roll back completely; constraints remain enabled.
  await assert.rejects(
    db.$transaction((tx) => tx.scanDecision.create({ data: decisionData })),
  );
  await assert.rejects(
    db.$transaction(async (tx) => {
      const decision = await tx.scanDecision.create({
        data: { ...decisionData, scanId: randomUUID() },
      });
      await tx.attendanceTransition.create({
        data: {
          eventId: event.id,
          gateId: fixture.gate_id,
          operatorUserId: fixture.scanner,
          registrationId: registrations.participant,
          scanDecisionId: decision.id,
          acceptedAt: new Date(decisionData.decidedAt.getTime() + 1),
        },
      });
    }),
  );
  assert.equal(
    await db.scanDecision.count({ where: { eventId: event.id } }),
    scanCount,
  );
  assert.equal(
    await db.attendanceTransition.count({
      where: { registrationId: registrations.participant },
    }),
    1,
  );
  const badCsrf = await api("/scan-decisions", sessions.scanner, {
    method: "POST",
    body: JSON.stringify({
      scan_id: randomUUID(),
      event_id: event.id,
      gate_id: fixture.gate_id,
      credential,
    }),
    headers: { "X-CSRF-Token": "invalid" },
  });
  assert.equal(badCsrf.status, 403);
  assert.equal(
    (await api(`/events/${event.id}/forecasts/current`, null)).status,
    401,
  );
  assert.equal(
    (await api(`/events/${event.id}/forecasts/current`, sessions.participant))
      .status,
    404,
  );
  const { response, correlation } = await forecastRead(
    event.id,
    sessions.owner,
  );
  const primary = await assertPersisted(db, response);
  assert.equal(primary.status, "AVAILABLE");
  assert(primary.regular_observations >= 270);
  const ledgerCount = await db.attendanceTransition.count({
    where: { eventId: event.id },
  });
  assert.equal(primary.occupied, ledgerCount);
  assert.equal(response.forecast.points.length, 2);
  assert(
    response.forecast.points.every(
      (point) => point.predicted_occupancy === ledgerCount,
    ),
  );
  const insufficient = await boundary(
    db,
    fixture,
    sessions.owner,
    contactKey,
    269,
  );
  const sufficient = await boundary(
    db,
    fixture,
    sessions.owner,
    contactKey,
    270,
  );
  return {
    ok: true,
    sessions: { ...sessions, registrations },
    evidence: {
      event_name: EVENT_NAME,
      event_id: event.id,
      primary,
      threshold_269: insufficient.evidence,
      threshold_270: sufficient.evidence,
      normal_registration: true,
      qr_retrieval: true,
      accepted_check_in: true,
      duplicate_rejected: true,
      integrity_probes_rolled_back: true,
      csrf_rejected: true,
      unauthenticated_rejected: true,
      participant_forecast_denied: true,
      correlations: [
        correlation,
        insufficient.correlation,
        sufficient.correlation,
      ],
    },
  };
}
