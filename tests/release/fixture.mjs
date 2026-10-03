import assert from "node:assert/strict";
import { setDefaultResultOrder } from "node:dns";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createDatabase } from "../../backend/dist/config/database.js";
import {
  signAccountToken,
  csrfToken,
} from "../../backend/dist/modules/auth/tokens.js";
import {
  encryptContact,
  normalizeContact,
} from "../../backend/dist/modules/auth/contact.js";
import { recoverCredential } from "../../backend/dist/modules/registrations/credential.js";

export const origin = process.env.SLICE12_ORIGIN ?? "https://127.0.0.1:8443";
setDefaultResultOrder("ipv4first");
assert.equal(new URL(origin).protocol, "https:");
export async function fixture() {
  const secret = async (name) =>
    (
      await readFile(new URL(`../../.secrets/${name}`, import.meta.url), "utf8")
    ).trim();
  const url = new URL(await secret("migration_url"));
  assert.equal(url.pathname, "/eoc_demo");
  url.hostname = "127.0.0.1";
  url.port = "55432";
  const db = createDatabase(url.href);
  const jwt = Buffer.from(await secret("jwt_secret"), "hex"),
    contactKey = Buffer.from(await secret("contact_key"), "hex");
  async function actor(organizerCapable = false) {
    const user = await db.user.create({ data: { organizerCapable } });
    const email = normalizeContact(
      "EMAIL",
      `${randomUUID()}@example.invalid`,
      contactKey,
    );
    await db.verifiedContact.create({
      data: {
        userId: user.id,
        type: "EMAIL",
        lookupHash: email.lookupHash,
        encrypted: encryptContact(email.value, contactKey),
        verifiedAt: new Date(),
      },
    });
    const session = await db.session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 3600000) },
    });
    return {
      id: user.id,
      sessionId: session.id,
      token: await signAccountToken(user.id, session.id, jwt),
      csrf: csrfToken(session.id, jwt),
    };
  }
  const staff = await actor(true);
  const event = await db.event.create({
    data: {
      ownerUserId: staff.id,
      name: "Synthetic Slice 12 release",
      state: "PUBLISHED",
      publishedAt: new Date(),
      visibility: "PUBLIC",
      startAt: new Date(Date.now() + 3600000),
      endAt: new Date(Date.now() + 7200000),
      timeZone: "UTC",
      registrationCapacity: 500,
    },
  });
  const gate = await db.gate.create({ data: { eventId: event.id } });
  const scanner = await actor();
  await db.eventRoleAssignment.create({
    data: {
      eventId: event.id,
      gateId: gate.id,
      scopeKey: gate.id,
      userId: scanner.id,
      role: "GATE_SECURITY",
      grantedByUserId: staff.id,
    },
  });
  async function credential(registrationId) {
    const row = await db.qRCredential.findFirstOrThrow({
      where: { registrationId, revokedAt: null },
    });
    return recoverCredential(
      registrationId,
      row.protectedRepresentation,
      contactKey,
    );
  }
  return {
    db,
    staff,
    event,
    gate,
    scanner,
    actor,
    credential,
    jwt,
    contactKey,
  };
}
export async function api(path, actor, options = {}) {
  const response = await fetch(origin + "/api/v1" + path, {
    ...options,
    signal: AbortSignal.timeout(20000),
    headers: {
      Cookie: `eoc_session=${actor.token}`,
      Origin: origin,
      "X-CSRF-Token": actor.csrf,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
      ...options.headers,
    },
  });
  return {
    status: response.status,
    body: await response.json(),
    headers: response.headers,
  };
}
