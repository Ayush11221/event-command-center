// Test-only fixture data; all writes require verified disposable database isolation.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DATABASE, PROVENANCE, EVENT_NAME } from "./isolation.mjs";
import {
  normalizeContact,
  encryptContact,
} from "../../backend/dist/modules/auth/contact.js";
import {
  signAccountToken,
  csrfToken,
} from "../../backend/dist/modules/auth/tokens.js";
import { issueCredential } from "../../backend/dist/modules/registrations/credential.js";
export const minute = 60000;
async function actor(tx, contactKey, organizerCapable = false) {
  const user = await tx.user.create({ data: { organizerCapable } });
  const contact = normalizeContact(
    "EMAIL",
    `${user.id}@example.invalid`,
    contactKey,
  );
  await tx.verifiedContact.create({
    data: {
      userId: user.id,
      type: "EMAIL",
      lookupHash: contact.lookupHash,
      encrypted: encryptContact(contact.value, contactKey),
      verifiedAt: new Date(),
    },
  });
  return user.id;
}
async function session(db, userId, jwt) {
  assert(await db.user.findUnique({ where: { id: userId } }));
  const row = await db.session.create({
    data: { userId, expiresAt: new Date(Date.now() + 3600000) },
  });
  return {
    id: userId,
    token: await signAccountToken(userId, row.id, jwt),
    csrf: csrfToken(row.id, jwt),
  };
}
export async function historicalEvent(
  tx,
  owner,
  scanner,
  name,
  firstAt,
  arrivals,
  contactKey,
) {
  const event = await tx.event.create({
    data: {
      ownerUserId: owner,
      name,
      state: "PUBLISHED",
      publishedAt: new Date(),
      visibility: "PUBLIC",
      timeZone: "UTC",
      startAt: new Date(Date.now() + 3600000),
      endAt: new Date(Date.now() + 7200000),
      registrationCapacity: 100,
    },
  });
  const gate = await tx.gate.create({ data: { eventId: event.id } });
  await tx.eventRoleAssignment.create({
    data: {
      eventId: event.id,
      gateId: gate.id,
      scopeKey: gate.id,
      userId: scanner,
      role: "GATE_SECURITY",
      grantedByUserId: owner,
    },
  });
  for (let i = 0; i < arrivals; i++) {
    const userId = await actor(tx, contactKey);
    const registration = await tx.registration.create({
      data: { eventId: event.id, userId },
    });
    const credential = await tx.qRCredential.create({
      data: {
        registrationId: registration.id,
        ...issueCredential(registration.id, contactKey),
      },
    });
    const acceptedAt = new Date(firstAt + i * 18 * minute);
    const decision = await tx.scanDecision.create({
      data: {
        eventId: event.id,
        gateId: gate.id,
        operatorUserId: scanner,
        registrationId: registration.id,
        credentialId: credential.id,
        scanId: randomUUID(),
        decision: "ACCEPTED",
        reason: "ACCEPTED",
        decidedAt: acceptedAt,
        correlationId: randomUUID(),
      },
    });
    await tx.attendanceTransition.create({
      data: {
        eventId: event.id,
        gateId: gate.id,
        operatorUserId: scanner,
        registrationId: registration.id,
        scanDecisionId: decision.id,
        acceptedAt,
      },
    });
  }
  return { event_id: event.id, gate_id: gate.id };
}

export async function seed(db, instance, contactKey) {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('local_forecast_demo_seed'))`;
      await isolation(tx, instance, true);
      const owner = await actor(tx, contactKey, true),
        scanner = await actor(tx, contactKey);
      const [{ now }] = await tx.$queryRaw`SELECT statement_timestamp() AS now`;
      const firstAt =
        Math.floor(now.getTime() / minute) * minute - 299 * minute;
      const primary = await historicalEvent(
        tx,
        owner,
        scanner,
        EVENT_NAME,
        firstAt,
        16,
        contactKey,
      );
      const fixture = {
        ...primary,
        owner,
        scanner,
        participant: await actor(tx, contactKey),
        arrival: await actor(tx, contactKey),
        scan_id: randomUUID(),
        duplicate_scan_id: randomUUID(),
      };
      // Only this verified empty local database is marked. Never update an attendance timestamp.
      await tx.$executeRawUnsafe(
        `COMMENT ON DATABASE "${DATABASE}" IS '${PROVENANCE}:${instance}'`,
      );
      return fixture;
    },
    { timeout: 30000 },
  );
}

export async function fixtureSessions(db, fixture, jwt) {
  const sessions = {};
  for (const role of ["owner", "scanner", "participant", "arrival"])
    sessions[role] = await session(db, fixture[role], jwt);
  return sessions;
}
export async function validateFixture(db, fixture) {
  assert.deepEqual(Object.keys(fixture).sort(), [
    "arrival",
    "duplicate_scan_id",
    "event_id",
    "gate_id",
    "owner",
    "participant",
    "scan_id",
    "scanner",
  ]);
  const event = await db.event.findUniqueOrThrow({
    where: { id: fixture.event_id },
  });
  assert.equal(event.name, EVENT_NAME);
  assert.equal(event.ownerUserId, fixture.owner);
  assert.equal(
    (await db.gate.findUniqueOrThrow({ where: { id: fixture.gate_id } }))
      .eventId,
    event.id,
  );
  assert(
    await db.eventRoleAssignment.findFirst({
      where: {
        eventId: event.id,
        gateId: fixture.gate_id,
        userId: fixture.scanner,
        role: "GATE_SECURITY",
        revokedAt: null,
      },
    }),
  );
  return event;
}
export async function isolation(db, instance, empty) {
  const [context] =
    await db.$queryRaw`SELECT current_database()::text AS database, current_user::text AS role, current_setting('session_replication_role') AS replication_role, shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()`;
  assert.equal(context.database, DATABASE);
  assert.equal(context.role, "eoc_migrator");
  assert.equal(context.replication_role, "origin");
  assert(
    context.marker === null || context.marker === `${PROVENANCE}:${instance}`,
  );
  const triggers =
    await db.$queryRaw`SELECT tgname::text AS tgname, tgenabled::text AS tgenabled FROM pg_trigger WHERE tgname IN ('AttendanceTransition_guard','ScanDecision_requires_attendance','ScanDecision_immutable','AttendanceTransition_immutable','Registration_preserve_checkin')`;
  assert.equal(triggers.length, 5);
  assert(triggers.every((t) => t.tgenabled === "O"));
  const counts = {
    events: await db.event.count(),
    users: await db.user.count(),
    attendance: await db.attendanceTransition.count(),
    scans: await db.scanDecision.count(),
    forecasts: await db.forecastRun.count(),
    registrations: await db.registration.count(),
  };
  if (empty)
    assert(
      Object.values(counts).every((n) => n === 0),
      "Seeding refuses any existing application data.",
    );
  else assert.equal(context.marker, `${PROVENANCE}:${instance}`);
  return {
    database: DATABASE,
    provenance: PROVENANCE,
    triggers_enabled: true,
    counts,
  };
}
