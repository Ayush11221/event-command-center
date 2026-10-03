import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import request from "supertest";
import { createDatabase } from "../../backend/src/config/database.js";
import { createLogger } from "../../backend/src/config/logger.js";
import { createApp } from "../../backend/src/app.js";
import { OtpService } from "../../backend/src/modules/auth/otp.js";
import {
  encryptContact,
  normalizeContact,
} from "../../backend/src/modules/auth/contact.js";
import {
  signAccountToken,
  signGuestProof,
  csrfToken,
} from "../../backend/src/modules/auth/tokens.js";
import { issueCredential } from "../../backend/src/modules/registrations/credential.js";
import { CertificateService } from "../../backend/src/modules/certificates/service.js";
import { renderDocument } from "../../backend/src/modules/certificates/pdf.js";
import { CertificateBatches } from "../../backend/src/modules/certificate-delivery/batches.js";
import { CertificateDeliveries } from "../../backend/src/modules/certificate-delivery/delivery.js";
import type { CertificateSender } from "../../backend/src/modules/certificate-delivery/sender.js";
import type { Renderer } from "../../backend/src/modules/certificates/renderer.js";
export const selected = {
  template_id: "classic",
  template_version: 1 as const,
  font_id: "sans",
} as const;
export function testContext(
  sender: CertificateSender,
  render: Renderer = renderDocument,
) {
  const db = createDatabase(process.env.TEST_DATABASE_URL ?? ""),
    config = {
      databaseUrl: process.env.TEST_DATABASE_URL ?? "",
      jwtSecret: Buffer.alloc(32, 21),
      contactKey: Buffer.alloc(32, 22),
      otpKey: Buffer.alloc(32, 23),
      cookieSecure: false,
    };
  const deps = {
    db,
    config,
    otp: new OtpService(db, config, { available: () => true, async send() {} }),
    frontendOrigin: "http://127.0.0.1:5173",
  };
  const issuer = new CertificateService(deps, render),
    batches = new CertificateBatches(deps),
    deliveries = new CertificateDeliveries(deps, sender);
  const app = createApp(
    { port: 3000, frontendOrigin: deps.frontendOrigin },
    createLogger(
      new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      }),
    ),
    deps,
    issuer,
    deliveries,
  );
  async function actor(organizerCapable = false, email = true) {
    const user = await db.user.create({ data: { organizerCapable } }),
      session = await db.session.create({
        data: { userId: user.id, expiresAt: new Date(Date.now() + 600000) },
      });
    const address = `${randomUUID()}@example.invalid`;
    const contact = normalizeContact(
      email ? "EMAIL" : "PHONE",
      email
        ? address
        : "+1" + Math.floor(1000000000 + Math.random() * 9000000000),
      config.contactKey,
    );
    await db.verifiedContact.create({
      data: {
        userId: user.id,
        type: contact.type,
        lookupHash: contact.lookupHash,
        encrypted: encryptContact(contact.value, config.contactKey),
        verifiedAt: new Date(),
      },
    });
    return {
      context: { userId: user.id, sessionId: session.id },
      id: user.id,
      sessionId: session.id,
      cookie: `eoc_session=${await signAccountToken(user.id, session.id, config.jwtSecret)}`,
      csrf: csrfToken(session.id, config.jwtSecret),
      address,
    };
  }
  type Actor = Awaited<ReturnType<typeof actor>>;
  async function registration(
    staff: Actor,
    eventId: string,
    options: {
      accepted?: boolean;
      name?: boolean;
      guest?: boolean;
      email?: boolean;
    } = {},
  ) {
    const participant = await actor(false, options.email !== false),
      subject = randomUUID().replaceAll("-", "").repeat(2);
    const guest = options.guest
      ? await db.guestIdentity.create({ data: { lookupHash: subject } })
      : null;
    const row = await db.registration.create({
      data: {
        eventId,
        ...(guest ? { guestIdentityId: guest.id } : { userId: participant.id }),
      },
    });
    if (options.accepted !== false) {
      const gate = await db.gate.create({ data: { eventId } }),
        credential = await db.qRCredential.create({
          data: {
            registrationId: row.id,
            ...issueCredential(row.id, config.contactKey),
          },
        });
      await db.$transaction(async (tx) => {
        const at = new Date();
        const scan = await tx.scanDecision.create({
          data: {
            scanId: randomUUID(),
            eventId,
            gateId: gate.id,
            operatorUserId: staff.id,
            registrationId: row.id,
            credentialId: credential.id,
            decision: "ACCEPTED",
            reason: "ACCEPTED",
            decidedAt: at,
            correlationId: randomUUID(),
          },
        });
        await tx.attendanceTransition.create({
          data: {
            eventId,
            gateId: gate.id,
            operatorUserId: staff.id,
            registrationId: row.id,
            scanDecisionId: scan.id,
            acceptedAt: at,
          },
        });
      });
    }
    if (options.name !== false)
      await db.certificateRecipientName.create({
        data: { registrationId: row.id, eventId, name: "Test Recipient" },
      });
    const proof = await signGuestProof(
      subject,
      "guest_ownership",
      eventId,
      config.jwtSecret,
    );
    return {
      row,
      participant,
      owner: guest
        ? {
            cookie: `eoc_guest_proof=${proof}`,
            csrf: csrfToken(proof, config.jwtSecret),
          }
        : participant,
      managed: `/events/${eventId}/registrations/${row.id}/certificate`,
    };
  }
  async function fixture(options: Parameters<typeof registration>[2] = {}) {
    const staff = await actor(true);
    const event = await db.event.create({
      data: {
        ownerUserId: staff.id,
        name: "Batch fixture",
        state: "LIVE",
        visibility: "PUBLIC",
        startAt: new Date(Date.now() + 3600000),
        endAt: new Date(Date.now() + 7200000),
        timeZone: "UTC",
        registrationCapacity: 100,
      },
    });
    return {
      staff,
      event,
      ...(await registration(staff, event.id, options)),
      path: `/events/${event.id}/certificate-batches`,
    };
  }
  const post = (
    path: string,
    who: { cookie: string; csrf: string },
    body: object = {},
    key = randomUUID(),
  ) =>
    request(app)
      .post(`/api/v1${path}`)
      .set("Cookie", who.cookie)
      .set("Origin", deps.frontendOrigin)
      .set("X-CSRF-Token", who.csrf)
      .set("Idempotency-Key", key)
      .send(body);
  const get = (path: string, who: { cookie: string }) =>
    request(app).get(`/api/v1${path}`).set("Cookie", who.cookie);
  async function settle(batchId: string) {
    for (let i = 0; i < 105; i++) {
      await batches.recover();
      await issuer.recover();
      const batch = await db.certificateBatch.findUniqueOrThrow({
        where: { id: batchId },
      });
      if (!["PENDING", "RUNNING"].includes(batch.status)) return batch;
    }
    throw new Error("Batch did not settle");
  }
  return {
    db,
    deps,
    issuer,
    batches,
    deliveries,
    app,
    actor,
    registration,
    fixture,
    post,
    get,
    settle,
  };
}
