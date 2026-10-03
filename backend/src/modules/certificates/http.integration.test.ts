import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import request from "supertest";
import { SignJWT, decodeJwt } from "jose";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createDatabase } from "../../config/database.js";
import { createLogger } from "../../config/logger.js";
import { OtpService } from "../auth/otp.js";
import { signAccountToken, signGuestProof, csrfToken } from "../auth/tokens.js";
import { ApiError } from "../auth/errors.js";
import { issueCredential } from "../registrations/credential.js";
import { CertificateService } from "./service.js";
import { renderDocument } from "./pdf.js";
import { vi } from "vitest";
import type { Renderer } from "./renderer.js";
import {
  matchesSchema,
  openapi,
} from "../../../../tests/contract/slice9-schema.mjs";

const url = process.env.TEST_DATABASE_URL,
  origin = "http://127.0.0.1:5173";
const selected = {
  template_id: "classic",
  template_version: 1,
  font_id: "sans",
};
describe.skipIf(!url)(
  "Slice 9 certificate API / durability / isolation",
  () => {
    const db = createDatabase(url ?? ""),
      config = {
        databaseUrl: url ?? "",
        jwtSecret: Buffer.alloc(32, 9),
        contactKey: Buffer.alloc(32, 10),
        otpKey: Buffer.alloc(32, 11),
        cookieSecure: false,
      };
    const otp = new OtpService(db, config, {
      available: () => true,
      async send() {},
    });
    const deps = { db, config, otp, frontendOrigin: origin };
    const logger = createLogger(
      new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      }),
    );
    const service = new CertificateService(deps, renderDocument),
      app = createApp(
        { port: 3000, frontendOrigin: origin },
        logger,
        deps,
        service,
      );
    afterAll(() => db.$disconnect());
    async function actor(organizerCapable = false) {
      const user = await db.user.create({ data: { organizerCapable } });
      await db.verifiedContact.create({
        data: {
          userId: user.id,
          type: "EMAIL",
          lookupHash: randomUUID().replaceAll("-", "").repeat(2),
          encrypted: "synthetic",
          verifiedAt: new Date(),
        },
      });
      const session = await db.session.create({
        data: { userId: user.id, expiresAt: new Date(Date.now() + 600000) },
      });
      return {
        id: user.id,
        sessionId: session.id,
        cookie: `eoc_session=${await signAccountToken(user.id, session.id, config.jwtSecret)}`,
        csrf: csrfToken(session.id, config.jwtSecret),
        context: { userId: user.id, sessionId: session.id },
      };
    }
    type Actor = Awaited<ReturnType<typeof actor>>;
    type Proof = Pick<Actor, "cookie" | "csrf">;
    const get = (path: string, who: Proof, target = app) =>
      request(target).get(`/api/v1${path}`).set("Cookie", who.cookie);
    const post = (
      path: string,
      who: Proof,
      body: object,
      key = randomUUID(),
      target = app,
    ) =>
      request(target)
        .post(`/api/v1${path}`)
        .set("Cookie", who.cookie)
        .set("Origin", origin)
        .set("X-CSRF-Token", who.csrf)
        .set("Idempotency-Key", key)
        .send(body);
    async function fixture(accepted = true, guest = false) {
      const staff = await actor(true),
        participant = await actor();
      const event = await db.event.create({
        data: {
          ownerUserId: staff.id,
          name: "Certificate fixture",
          state: "LIVE",
          visibility: "PUBLIC",
          startAt: new Date(Date.now() + 3600000),
          endAt: new Date(Date.now() + 7200000),
          timeZone: "UTC",
          registrationCapacity: 1,
        },
      });
      const subject = randomUUID().replaceAll("-", "").repeat(2);
      const guestIdentity = guest
        ? await db.guestIdentity.create({ data: { lookupHash: subject } })
        : null;
      const row = await db.registration.create({
        data: {
          eventId: event.id,
          ...(guestIdentity
            ? { guestIdentityId: guestIdentity.id }
            : { userId: participant.id }),
        },
      });
      const token = await signGuestProof(
        subject,
        "guest_ownership",
        event.id,
        config.jwtSecret,
      );
      const owner: Proof = guest
        ? {
            cookie: `eoc_guest_proof=${token}`,
            csrf: csrfToken(token, config.jwtSecret),
          }
        : participant;
      if (accepted) {
        const gate = await db.gate.create({ data: { eventId: event.id } });
        const credential = await db.qRCredential.create({
          data: {
            registrationId: row.id,
            ...issueCredential(row.id, config.contactKey),
          },
        });
        const at = new Date();
        await db.$transaction(async (tx) => {
          const scan = await tx.scanDecision.create({
            data: {
              scanId: randomUUID(),
              eventId: event.id,
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
              eventId: event.id,
              gateId: gate.id,
              operatorUserId: staff.id,
              registrationId: row.id,
              scanDecisionId: scan.id,
              acceptedAt: at,
            },
          });
        });
      }
      const own = `/registrations/${row.id}/certificate`,
        managed = `/events/${event.id}/registrations/${row.id}/certificate`;
      return {
        staff,
        participant,
        owner,
        event,
        row,
        subject,
        token,
        own,
        managed,
      };
    }
    async function named(accepted = true) {
      const f = await fixture(accepted);
      expect(
        (
          await post(f.own + "/recipient-name", f.owner, {
            recipient_name: "Alice O’Neil",
          })
        ).status,
      ).toBe(200);
      return f;
    }
    function custom(renderer: Renderer) {
      const instance = new CertificateService(deps, renderer);
      return {
        instance,
        target: createApp(
          { port: 3000, frontendOrigin: origin },
          logger,
          deps,
          instance,
        ),
      };
    }
    async function expireLease(id: string) {
      await db.certificateIssueWork.update({
        where: { id },
        data: { leaseExpiresAt: new Date(Date.now() - 1000) },
      });
    }
    async function makeDue(id: string) {
      await db.certificateIssueWork.update({
        where: { id },
        data: { retryAt: new Date(Date.now() - 1000) },
      });
    }

    it("derives eligibility from accepted evidence, not registration alone; name is independent", async () => {
      const f = await named(false);
      expect((await get(f.own, f.owner)).body.state).toBe("NOT_ELIGIBLE");
      expect((await post(f.managed, f.staff, selected)).body.code).toBe(
        "NOT_ELIGIBLE",
      );
      expect(
        (await post(f.managed + "/preview", f.staff, selected)).status,
      ).toBe(200);
      const eligible = await fixture();
      expect((await get(eligible.own, eligible.owner)).body.state).toBe(
        "ELIGIBLE",
      );
      expect(
        (await post(eligible.managed, eligible.staff, selected)).body.code,
      ).toBe("NAME_MISSING");
      expect(
        await db.certificate.count({
          where: { registrationId: eligible.row.id },
        }),
      ).toBe(0);
    });
    it("captures owner name without changing Registration, redacts staff/audit/replay and serializes replacements", async () => {
      const f = await fixture(),
        before = await db.registration.findUnique({ where: { id: f.row.id } }),
        key = randomUUID();
      expect(
        (
          await post(
            f.own + "/recipient-name",
            f.owner,
            { recipient_name: "  Alice O’Neil " },
            key,
          )
        ).status,
      ).toBe(200);
      await Promise.all([
        post(f.own + "/recipient-name", f.owner, {
          recipient_name: "Alice Smith",
        }),
        post(f.own + "/recipient-name", f.owner, {
          recipient_name: "Alice Jones",
        }),
      ]);
      const name = await db.certificateRecipientName.findUniqueOrThrow({
        where: { registrationId: f.row.id },
      });
      expect(name.revision).toBe(3);
      await post(
        f.own + "/recipient-name",
        f.owner,
        { recipient_name: "  Alice O’Neil " },
        key,
      );
      expect(
        (
          await db.certificateRecipientName.findUniqueOrThrow({
            where: { registrationId: f.row.id },
          })
        ).name,
      ).toBe(name.name);
      expect(
        (
          await post(
            f.own + "/recipient-name",
            f.owner,
            { recipient_name: "Changed" },
            key,
          )
        ).body.code,
      ).toBe("IDEMPOTENCY_CONFLICT");
      expect(
        await db.registration.findUnique({ where: { id: f.row.id } }),
      ).toEqual(before);
      const staff = await get(f.managed, f.staff);
      expect(staff.body.recipient_name_set).toBe(true);
      expect(staff.body).not.toHaveProperty("recipient_name");
      expect(
        JSON.stringify(
          await db.auditEvent.findMany({ where: { eventId: f.event.id } }),
        ),
      ).not.toContain("Alice");
      expect(
        JSON.stringify(
          await db.commandReplay.findMany({
            where: { resourceKey: f.event.id },
          }),
        ),
      ).not.toContain("Alice");
    });
    it("enforces account/guest ownership, proof expiry/purpose/binding, precedence and CSRF", async () => {
      const f = await fixture(true, true),
        outsider = await actor();
      expect(
        (
          await post(f.own + "/recipient-name", f.owner, {
            recipient_name: "Guest Name",
          })
        ).status,
      ).toBe(200);
      expect((await get(f.own, f.owner)).body.recipient_name).toBe(
        "Guest Name",
      );
      expect((await get(f.own, outsider)).status).toBe(404);
      expect(
        (
          await post(f.own + "/recipient-name", f.staff, {
            recipient_name: "Staff Name",
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await get(f.own, {
            ...f.owner,
            cookie: `eoc_session=invalid; ${f.owner.cookie}`,
          })
        ).status,
      ).toBe(401);
      for (const token of [
        await signGuestProof(f.subject, "wrong", f.event.id, config.jwtSecret),
        await new SignJWT(decodeJwt(f.token))
          .setProtectedHeader({ alg: "HS256" })
          .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
          .sign(config.jwtSecret),
      ])
        expect(
          (await get(f.own, { ...f.owner, cookie: `eoc_guest_proof=${token}` }))
            .status,
        ).toBe(401);
      const wrong = await signGuestProof(
        f.subject,
        "guest_ownership",
        randomUUID(),
        config.jwtSecret,
      );
      expect(
        (await get(f.own, { ...f.owner, cookie: `eoc_guest_proof=${wrong}` }))
          .status,
      ).toBe(404);
      expect(
        (
          await post(
            f.own + "/recipient-name",
            { ...f.owner, csrf: "wrong" },
            { recipient_name: "Guest Name" },
          )
        ).status,
      ).toBe(403);
      expect((await post(f.managed, f.owner, selected)).status).toBe(401);
    });
    it("issues once atomically, protects staff bytes, replays after revoke, locks name forever", async () => {
      const f = await named(),
        key = randomUUID();
      const first = await post(f.managed, f.staff, selected, key);
      expect(first.status).toBe(201);
      expect(
        matchesSchema(openapi.components.schemas.CertificateResult, first.body),
      ).toBe(true);
      expect(
        matchesSchema(
          openapi.components.schemas.OwnerStatus,
          (await get(f.own, f.owner)).body,
        ),
      ).toBe(true);
      expect(
        matchesSchema(
          openapi.components.schemas.StaffStatus,
          (await get(f.managed, f.staff)).body,
        ),
      ).toBe(true);
      expect(JSON.stringify(first.body)).not.toContain("Alice");
      const id = first.body.certificate.certificate_id;
      expect(
        (await db.certificateIssueWork.findUniqueOrThrow({ where: { id } }))
          .status,
      ).toBe("COMPLETED");
      expect(
        (await get(f.own + "/artifact", f.owner)).headers["content-type"],
      ).toContain("application/pdf");
      expect((await get(f.own + "/artifact", f.staff)).status).toBe(404);
      expect((await post(f.managed, f.staff, selected)).body.code).toBe(
        "ALREADY_ISSUED",
      );
      expect(
        (await post(f.managed, f.staff, { ...selected, font_id: "serif" }, key))
          .body.code,
      ).toBe("IDEMPOTENCY_CONFLICT");
      const revokeKey = randomUUID();
      expect(
        (
          await post(
            f.managed + "/revoke",
            f.staff,
            { reason: "Invalidated" },
            revokeKey,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await post(
            f.managed + "/revoke",
            f.staff,
            { reason: "Invalidated" },
            revokeKey,
          )
        ).status,
      ).toBe(200);
      expect((await post(f.managed + "/revoke", f.staff, {})).body.code).toBe(
        "ALREADY_REVOKED",
      );
      expect((await get(f.own + "/artifact", f.owner)).body.code).toBe(
        "CERTIFICATE_NOT_FOUND",
      );
      expect(
        (
          await post(f.own + "/recipient-name", f.owner, {
            recipient_name: "Changed",
          })
        ).body.code,
      ).toBe("NAME_LOCKED");
      expect(
        (await post(f.managed, f.staff, selected, key)).body.certificate.status,
      ).toBe("ISSUED");
      expect(
        await db.certificate.count({ where: { registrationId: f.row.id } }),
      ).toBe(1);
      await db.session.update({
        where: { id: f.staff.sessionId },
        data: { revokedAt: new Date() },
      });
      expect((await post(f.managed, f.staff, selected, key)).status).toBe(401);
    });
    it("supports guest owner artifact while denying other guest identities", async () => {
      const f = await fixture(true, true);
      await post(f.own + "/recipient-name", f.owner, {
        recipient_name: "Guest Owner",
      });
      expect((await post(f.managed, f.staff, selected)).status).toBe(201);
      expect((await get(f.own + "/artifact", f.owner)).status).toBe(200);
      const stranger = await fixture(true, true);
      expect((await get(f.own + "/artifact", stranger.owner)).status).toBe(404);
    });
    it("keeps preview ephemeral, requires correct lifecycle/scope and rejects substituted names", async () => {
      const f = await named(false);
      const preview = await post(f.managed + "/preview", f.staff, {
        ...selected,
        template_id: "modern",
        font_id: "serif",
      });
      expect(preview.status).toBe(200);
      expect(preview.headers["cache-control"]).toContain("no-store");
      expect(
        await db.certificateIssueWork.count({
          where: { registrationId: f.row.id },
        }),
      ).toBe(0);
      expect(
        await db.certificate.count({ where: { registrationId: f.row.id } }),
      ).toBe(0);
      expect(
        (
          await post(f.managed + "/preview", f.staff, {
            ...selected,
            recipient_name: "Substitute",
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await get(
            `/events/${randomUUID()}/registrations/${f.row.id}/certificate`,
            f.staff,
          )
        ).status,
      ).toBe(404);
      await db.event.update({
        where: { id: f.event.id },
        data: { state: "CANCELLED" },
      });
      expect((await get(f.managed, f.staff)).status).toBe(200);
      expect(
        (await post(f.managed + "/preview", f.staff, selected)).body.code,
      ).toBe("EVENT_STATE_NOT_ALLOWED");
    });
    it("rejects preview/name races and refreshes issuance name snapshots before commit", async () => {
      const f = await named();
      let renders = 0;
      const alternate = custom(async (input) => {
        renders++;
        if (renders === 1)
          await post(f.own + "/recipient-name", f.owner, {
            recipient_name: "Latest Owner",
          });
        return renderDocument(input);
      });
      expect(
        (
          await post(
            f.managed + "/preview",
            f.staff,
            selected,
            randomUUID(),
            alternate.target,
          )
        ).body.code,
      ).toBe("VERSION_CONFLICT");
      renders = 0;
      await post(f.own + "/recipient-name", f.owner, {
        recipient_name: "Earlier Owner",
      });
      const first = await post(
        f.managed,
        f.staff,
        selected,
        randomUUID(),
        alternate.target,
      );
      expect(first.status).toBe(202);
      const work = await db.certificateIssueWork.findUniqueOrThrow({
        where: { registrationId: f.row.id },
      });
      await makeDue(work.id);
      await alternate.instance.process(work.id);
      expect(
        (
          await db.certificate.findUniqueOrThrow({
            where: { registrationId: f.row.id },
          })
        ).recipientName,
      ).toBe("Latest Owner");
    });
    it("persists retries, bounds exhaustion, keeps terminal replay and explicitly recovers failed work", async () => {
      const f = await named();
      let fail = true;
      const alternate = custom(async (input) => {
        if (fail)
          throw new ApiError(
            503,
            "DEPENDENCY_UNAVAILABLE",
            "Synthetic transient failure",
          );
        return renderDocument(input);
      });
      const key = randomUUID(),
        first = await post(f.managed, f.staff, selected, key, alternate.target);
      expect(first.status).toBe(202);
      const work = await db.certificateIssueWork.findUniqueOrThrow({
        where: { registrationId: f.row.id },
      });
      expect(
        (
          await post(
            f.managed,
            f.staff,
            selected,
            randomUUID(),
            alternate.target,
          )
        ).body.code,
      ).toBe("ISSUE_IN_PROGRESS");
      expect(
        (
          await post(
            f.managed + "/revoke",
            f.staff,
            {},
            randomUUID(),
            alternate.target,
          )
        ).body.code,
      ).toBe("NOT_ISSUED");
      for (let i = 0; i < 2; i++) {
        await makeDue(work.id);
        await alternate.instance.process(work.id);
      }
      const failed = await db.certificateIssueWork.findUniqueOrThrow({
        where: { id: work.id },
      });
      expect(failed.status).toBe("FAILED");
      expect(failed.attemptCount).toBe(3);
      expect(
        (await post(f.managed, f.staff, selected, key, alternate.target))
          .status,
      ).toBe(503);
      fail = false;
      expect(
        (
          await post(
            f.managed,
            f.staff,
            selected,
            randomUUID(),
            alternate.target,
          )
        ).status,
      ).toBe(201);
      expect(
        (
          await db.certificateIssueWork.findUniqueOrThrow({
            where: { id: work.id },
          })
        ).generationCycle,
      ).toBe(2);
      expect(
        (await post(f.managed, f.staff, selected, key, alternate.target))
          .status,
      ).toBe(503);
    });
    it("makes permanent render failure visible without automatic retry", async () => {
      const f = await named(),
        alternate = custom(async () => {
          throw new ApiError(422, "NAME_NOT_RENDERABLE", "Synthetic failure");
        });
      expect(
        (
          await post(
            f.managed,
            f.staff,
            selected,
            randomUUID(),
            alternate.target,
          )
        ).status,
      ).toBe(422);
      const before = await db.certificateIssueWork.findUniqueOrThrow({
        where: { registrationId: f.row.id },
      });
      await alternate.instance.recover();
      expect(
        (
          await db.certificateIssueWork.findUniqueOrThrow({
            where: { id: before.id },
          })
        ).attemptCount,
      ).toBe(1);
    });
    it("recovers crash/DB uncertainty after lease expiry without duplicating a logical certificate", async () => {
      const f = await named(),
        alternate = custom(async () => {
          throw new Error("Synthetic crash");
        });
      expect(
        (
          await post(
            f.managed,
            f.staff,
            selected,
            randomUUID(),
            alternate.target,
          )
        ).status,
      ).toBe(503);
      const work = await db.certificateIssueWork.findUniqueOrThrow({
        where: { registrationId: f.row.id },
      });
      expect(work.status).toBe("PENDING");
      expect(work.claimToken).not.toBeNull();
      await expireLease(work.id);
      await new CertificateService(deps, renderDocument).process(work.id);
      expect(
        (
          await db.certificateIssueWork.findUniqueOrThrow({
            where: { id: work.id },
          })
        ).fencingToken,
      ).toBe(2n);
      expect(
        await db.certificate.count({ where: { registrationId: f.row.id } }),
      ).toBe(1);
    });
    it("fences an expired renderer after another service recovers its work", async () => {
      const f = await named();
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>((resolve) => {
          entered = resolve;
        }),
        gate = new Promise<void>((resolve) => {
          release = resolve;
        });
      const alternate = custom(async (input) => {
        entered();
        await gate;
        return renderDocument(input);
      });
      const command = post(
        f.managed,
        f.staff,
        selected,
        randomUUID(),
        alternate.target,
      ).then((result) => result);
      await started;
      const work = await db.certificateIssueWork.findUniqueOrThrow({
        where: { registrationId: f.row.id },
      });
      await expireLease(work.id);
      await new CertificateService(deps, renderDocument).process(work.id);
      release();
      expect((await command).status).toBe(201);
      expect(
        await db.certificate.count({ where: { registrationId: f.row.id } }),
      ).toBe(1);
    });
    it("serializes concurrent issue commands and preserves registration/attendance/event revision", async () => {
      const f = await named(),
        before = await db.event.findUniqueOrThrow({
          where: { id: f.event.id },
        });
      const results = await Promise.all([
        post(f.managed, f.staff, selected),
        post(f.managed, f.staff, selected),
      ]);
      expect(results.some((result) => result.status === 201)).toBe(true);
      expect(
        results.every((result) => [201, 202, 409].includes(result.status)),
      ).toBe(true);
      expect(
        await db.certificate.count({ where: { registrationId: f.row.id } }),
      ).toBe(1);
      expect(
        await db.attendanceTransition.count({
          where: { registrationId: f.row.id },
        }),
      ).toBe(1);
      expect(
        (await db.event.findUniqueOrThrow({ where: { id: f.event.id } }))
          .revision,
      ).toBe(before.revision);
    });
    it("revalidates assignment/session and lifecycle after rendering", async () => {
      const f = await named(),
        admin = await actor();
      const assignment = await db.eventRoleAssignment.create({
        data: {
          eventId: f.event.id,
          userId: admin.id,
          role: "EVENT_ADMIN",
          scopeKey: "EVENT",
          grantedByUserId: f.staff.id,
        },
      });
      const alternate = custom(async (input) => {
        await db.eventRoleAssignment.update({
          where: { id: assignment.id },
          data: { revokedAt: new Date(), revokedByUserId: f.staff.id },
        });
        return renderDocument(input);
      });
      expect(
        (await post(f.managed, admin, selected, randomUUID(), alternate.target))
          .status,
      ).toBe(404);
      expect(
        await db.certificate.count({ where: { registrationId: f.row.id } }),
      ).toBe(0);
      expect(
        (
          await db.certificateIssueWork.findUniqueOrThrow({
            where: { registrationId: f.row.id },
          })
        ).status,
      ).toBe("FAILED");
      const other = await named(),
        logout = custom(async (input) => {
          await db.session.update({
            where: { id: other.staff.sessionId },
            data: { revokedAt: new Date() },
          });
          return renderDocument(input);
        });
      expect(
        (
          await post(
            other.managed,
            other.staff,
            selected,
            randomUUID(),
            logout.target,
          )
        ).status,
      ).toBe(401);
      expect(
        await db.certificate.count({ where: { registrationId: other.row.id } }),
      ).toBe(0);
    });
    it("rejects name capture after cancellation, issued deletion/update, wrong event and PDF hash corruption", async () => {
      const f = await named(false);
      expect(
        (await post(`/registrations/${f.row.id}/cancel`, f.owner, {})).status,
      ).toBe(200);
      expect(
        (
          await post(f.own + "/recipient-name", f.owner, {
            recipient_name: "Changed Name",
          })
        ).body.code,
      ).toBe("ALREADY_CANCELLED");
      await expect(
        db.certificateRecipientName.update({
          where: { registrationId: f.row.id },
          data: { eventId: randomUUID() },
        }),
      ).rejects.toThrow();
      const issued = await named();
      await post(issued.managed, issued.staff, selected);
      await expect(
        db.certificate.update({
          where: { registrationId: issued.row.id },
          data: { pdfSha256: "0".repeat(64) },
        }),
      ).rejects.toThrow();
      await expect(
        db.certificate.delete({ where: { registrationId: issued.row.id } }),
      ).rejects.toThrow();
      await expect(
        db.certificateRecipientName.update({
          where: { registrationId: issued.row.id },
          data: { name: "Changed Name", revision: { increment: 1 } },
        }),
      ).rejects.toThrow();
    });
    it("rolls back finalization on audit/DB failure while retaining accepted intent", async () => {
      const f = await named(),
        suffix = randomUUID().replaceAll("-", ""),
        name = `slice9_fault_${suffix}`;
      await db.$executeRawUnsafe(
        `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."eventId" = '${f.event.id}'::uuid AND NEW.action = 'CERTIFICATE_ISSUED' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$`,
      );
      await db.$executeRawUnsafe(
        `CREATE TRIGGER ${name} BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION ${name}()`,
      );
      try {
        expect((await post(f.managed, f.staff, selected)).status).toBe(503);
        expect(
          await db.certificate.count({ where: { registrationId: f.row.id } }),
        ).toBe(0);
        const work = await db.certificateIssueWork.findUniqueOrThrow({
          where: { registrationId: f.row.id },
        });
        expect(work.status).toBe("PENDING");
        expect(
          (
            await db.commandReplay.findUniqueOrThrow({
              where: { id: work.commandReplayId },
            })
          ).status,
        ).toBe("PENDING");
      } finally {
        await db.$executeRawUnsafe(`DROP TRIGGER ${name} ON "AuditEvent"`);
        await db.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
      }
      const work = await db.certificateIssueWork.findUniqueOrThrow({
        where: { registrationId: f.row.id },
      });
      await expireLease(work.id);
      await service.process(work.id);
      expect(
        await db.certificate.count({ where: { registrationId: f.row.id } }),
      ).toBe(1);
    });
    it("recovers an accepted intent after a crash before its first generation claim", async () => {
      const f = await named(),
        alternate = custom(renderDocument);
      const paused = vi
          .spyOn(alternate.instance, "process")
          .mockResolvedValue(undefined),
        key = randomUUID();
      expect(
        (await post(f.managed, f.staff, selected, key, alternate.target))
          .status,
      ).toBe(202);
      const work = await db.certificateIssueWork.findUniqueOrThrow({
        where: { registrationId: f.row.id },
      });
      expect(work.attemptCount).toBe(0);
      expect(work.claimToken).toBeNull();
      expect(
        (await post(f.managed, f.staff, selected, key, alternate.target))
          .status,
      ).toBe(202);
      expect(
        (
          await post(
            f.managed,
            f.staff,
            { ...selected, font_id: "serif" },
            key,
            alternate.target,
          )
        ).body.code,
      ).toBe("IDEMPOTENCY_CONFLICT");
      paused.mockRestore();
      await new CertificateService(deps, renderDocument).process(work.id);
      expect(
        (await post(f.managed, f.staff, selected, key, alternate.target))
          .status,
      ).toBe(201);
    });
    it("rolls back acceptance if its required audit cannot commit", async () => {
      const f = await named(),
        name = `slice9_accept_${randomUUID().replaceAll("-", "")}`;
      await db.$executeRawUnsafe(
        `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."eventId" = '${f.event.id}'::uuid AND NEW.action = 'CERTIFICATE_ISSUE_REQUESTED' THEN RAISE EXCEPTION 'Synthetic acceptance failure'; END IF; RETURN NEW; END $$`,
      );
      await db.$executeRawUnsafe(
        `CREATE TRIGGER ${name} BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION ${name}()`,
      );
      try {
        expect((await post(f.managed, f.staff, selected)).status).toBe(503);
        expect(
          await db.certificateIssueWork.count({
            where: { registrationId: f.row.id },
          }),
        ).toBe(0);
        expect(
          await db.commandReplay.count({
            where: { action: "CERTIFICATE_ISSUE", resourceKey: f.event.id },
          }),
        ).toBe(0);
      } finally {
        await db.$executeRawUnsafe(`DROP TRIGGER ${name} ON "AuditEvent"`);
        await db.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
      }
    });
    it("cancellation during render prevents issue; later event cancellation does not revoke an issued certificate", async () => {
      const f = await named(),
        alternate = custom(async (input) => {
          await db.event.update({
            where: { id: f.event.id },
            data: { state: "CANCELLED" },
          });
          return renderDocument(input);
        });
      expect(
        (
          await post(
            f.managed,
            f.staff,
            selected,
            randomUUID(),
            alternate.target,
          )
        ).body.code,
      ).toBe("EVENT_STATE_NOT_ALLOWED");
      expect(
        await db.certificate.count({ where: { registrationId: f.row.id } }),
      ).toBe(0);
      const issued = await named();
      expect((await post(issued.managed, issued.staff, selected)).status).toBe(
        201,
      );
      await db.event.update({
        where: { id: issued.event.id },
        data: { state: "CANCELLED" },
      });
      expect((await get(issued.own + "/artifact", issued.owner)).status).toBe(
        200,
      );
      expect(
        (await post(issued.managed + "/revoke", issued.staff, {})).status,
      ).toBe(200);
    });
  },
);
