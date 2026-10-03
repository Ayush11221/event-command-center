import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { encryptContact, normalizeContact } from "../auth/contact.js";
import { renderDocument } from "../certificates/pdf.js";
import { CertificateService } from "../certificates/service.js";
import { CertificateDeliveries } from "./delivery.js";
import { testContext, selected } from "../../../../tests/fixtures/slice10.mjs";
import {
  matchesSchema,
  openapi,
} from "../../../../tests/contract/slice10-schema.mjs";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "Slice 10 API and durable processing",
  () => {
    const send = vi.fn().mockResolvedValue("SENT"),
      t = testContext({ send });
    afterAll(() => t.db.$disconnect());
    async function accept(
      f: Awaited<ReturnType<typeof t.fixture>>,
      ids = [f.row.id],
      key = randomUUID(),
    ) {
      const response = await t.post(
        f.path,
        f.staff,
        { ...selected, registration_ids: ids },
        key,
      );
      expect(response.status).toBe(202);
      expect(
        matchesSchema(openapi.components.schemas.BatchResponse, response.body),
      ).toBe(true);
      return response.body.batch.batch_id as string;
    }
    async function issued(options: Parameters<typeof t.fixture>[0] = {}) {
      const f = await t.fixture(options);
      expect((await t.post(f.managed, f.staff, selected)).status).toBe(201);
      const d = await t.db.certificateDelivery.findFirstOrThrow({
        where: { eventId: f.event.id },
      });
      return { ...f, d };
    }
    it("rejects empty/duplicate/oversized selection without creating a batch", async () => {
      const f = await t.fixture();
      for (const ids of [
        [],
        [f.row.id, f.row.id],
        Array.from({ length: 101 }, () => randomUUID()),
      ]) {
        const response = await t.post(f.path, f.staff, {
          ...selected,
          registration_ids: ids,
        });
        expect(response.status).toBe(422);
        expect(response.body.code).toBe("VALIDATION");
      }
      expect(
        await t.db.certificateBatch.count({ where: { eventId: f.event.id } }),
      ).toBe(0);
    });
    it("replays acceptance, detects conflict and retains operation identity after expiry", async () => {
      const f = await t.fixture(),
        key = randomUUID(),
        id = await accept(f, [f.row.id], key);
      expect(
        (
          await t.post(
            f.path,
            f.staff,
            { ...selected, registration_ids: [f.row.id] },
            key,
          )
        ).body.batch.batch_id,
      ).toBe(id);
      expect(
        (
          await t.post(
            f.path,
            f.staff,
            { ...selected, registration_ids: [randomUUID()] },
            key,
          )
        ).status,
      ).toBe(409);
      const batch = await t.db.certificateBatch.findUniqueOrThrow({
        where: { id },
      });
      await t.db.commandReplay.update({
        where: { id: batch.commandReplayId },
        data: {
          createdAt: new Date(Date.now() - 2000),
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      expect(
        (
          await t.post(
            f.path,
            f.staff,
            { ...selected, registration_ids: [f.row.id] },
            key,
          )
        ).body.code,
      ).toBe("BATCH_REPLAY_EXPIRED");
      expect(
        await t.db.certificateBatch.count({ where: { eventId: f.event.id } }),
      ).toBe(1);
    });
    it("settles partial outcomes, missing/wrong-event/ineligible/missing-name and paginates closed items", async () => {
      const f = await t.fixture(),
        wrong = await t.fixture(),
        ineligible = await t.registration(f.staff, f.event.id, {
          accepted: false,
        }),
        nameless = await t.registration(f.staff, f.event.id, { name: false });
      const ids = [
          f.row.id,
          randomUUID(),
          wrong.row.id,
          ineligible.row.id,
          nameless.row.id,
        ],
        id = await accept(f, ids);
      expect((await t.settle(id)).status).toBe("PARTIAL_FAILED");
      const status = await t.get(f.path + `/${id}`, f.staff);
      expect(status.body.batch).toMatchObject({
        successful_count: 1,
        failed_count: 4,
        pending_count: 0,
        generated_count: 1,
      });
      expect(
        matchesSchema(openapi.components.schemas.BatchResponse, status.body),
      ).toBe(true);
      const first = await t.get(f.path + `/${id}/items?limit=2`, f.staff),
        second = await t.get(
          f.path + `/${id}/items?limit=2&cursor=${first.body.next_cursor}`,
          f.staff,
        );
      expect(
        matchesSchema(openapi.components.schemas.ItemsResponse, first.body),
      ).toBe(true);
      expect(first.body.items).toHaveLength(2);
      expect(
        new Set(
          [...first.body.items, ...second.body.items].map(
            (i: { registration_id: string }) => i.registration_id,
          ),
        ).size,
      ).toBe(4);
      const all = await t.get(f.path + `/${id}/items?limit=100`, f.staff);
      expect(
        all.body.items.map((i: { result_code: string }) => i.result_code),
      ).toEqual(
        expect.arrayContaining([
          "GENERATED",
          "REGISTRATION_NOT_FOUND",
          "NOT_ELIGIBLE",
          "NAME_MISSING",
        ]),
      );
    });
    it("completes successful batches and reuses issued certificates without replacing PDFs", async () => {
      const f = await issued(),
        cert = await t.db.certificate.findUniqueOrThrow({
          where: { registrationId: f.row.id },
        }),
        id = await accept(f);
      expect((await t.settle(id)).status).toBe("COMPLETED");
      const view = await t.get(f.path + `/${id}`, f.staff);
      expect(view.body.batch).toMatchObject({
        already_satisfied_count: 1,
        generated_count: 0,
      });
      expect(
        (await t.db.certificate.findUniqueOrThrow({ where: { id: cert.id } }))
          .pdfSha256,
      ).toBe(cert.pdfSha256);
      expect(
        await t.db.certificate.count({ where: { registrationId: f.row.id } }),
      ).toBe(1);
    });
    it("revoked and entirely ineligible selections fail without reissue", async () => {
      const f = await issued();
      await t.post(f.managed + "/revoke", f.staff, {});
      const id = await accept(f);
      expect((await t.settle(id)).status).toBe("FAILED");
      expect(
        (await t.get(f.path + `/${id}/items`, f.staff)).body.items[0]
          .result_code,
      ).toBe("CERTIFICATE_REVOKED");
    });
    it("continues accepted batch work after session expiry; rejects reads and replay without current session", async () => {
      const f = await t.fixture(),
        id = await accept(f);
      await t.batches.recover();
      await t.db.session.update({
        where: { id: f.staff.sessionId },
        data: {
          createdAt: new Date(Date.now() - 2000),
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      expect((await t.settle(id)).status).toBe("COMPLETED");
      expect((await t.get(f.path + `/${id}`, f.staff)).status).toBe(401);
    });
    it("stops newly accepted work when actual organizer capability is revoked", async () => {
      const f = await t.fixture(),
        id = await accept(f);
      await t.batches.recover();
      await t.db.user.update({
        where: { id: f.staff.id },
        data: { organizerCapable: false },
      });
      expect((await t.settle(id)).status).toBe("FAILED");
      expect(
        await t.db.certificate.count({ where: { registrationId: f.row.id } }),
      ).toBe(0);
    });
    it("reconciles existing pending single work and overlapping batches without duplicate logical issuance", async () => {
      const f = await t.fixture(),
        id = await accept(f);
      await t.batches.recover();
      const work = await t.db.certificateIssueWork.findUniqueOrThrow({
        where: { registrationId: f.row.id },
      });
      expect((await t.post(f.managed, f.staff, selected)).body.code).toBe(
        "ISSUE_IN_PROGRESS",
      );
      const other = await accept(f);
      await t.batches.recover();
      const reused = await t.db.certificateIssueWork.findUniqueOrThrow({
        where: { registrationId: f.row.id },
      });
      expect(reused.commandReplayId).toBe(work.commandReplayId);
      await t.issuer.process(work.id);
      expect((await t.settle(id)).status).toBe("COMPLETED");
      expect((await t.settle(other)).status).toBe("COMPLETED");
      expect(
        await t.db.certificate.count({ where: { registrationId: f.row.id } }),
      ).toBe(1);
    });
    it("binds worker claims to current role even when authority changes during rendering", async () => {
      const f = await t.fixture();
      await accept(f);
      await t.batches.recover();
      const work = await t.db.certificateIssueWork.findUniqueOrThrow({
        where: { registrationId: f.row.id },
      });
      const issuer = new CertificateService(t.deps, async (input) => {
        await t.db.user.update({
          where: { id: f.staff.id },
          data: { organizerCapable: false },
        });
        return renderDocument(input);
      });
      await issuer.process(work.id);
      expect(
        (
          await t.db.certificateIssueWork.findUniqueOrThrow({
            where: { id: work.id },
          })
        ).lastErrorCode,
      ).toBe("AUTHORITY_REVOKED");
      expect(await t.db.certificate.count({ where: { id: work.id } })).toBe(0);
    });
    it("preserves committed success when authority is lost before batch reconciliation", async () => {
      const f = await t.fixture(),
        id = await accept(f);
      await t.batches.recover();
      const work = await t.db.certificateIssueWork.findUniqueOrThrow({
        where: { registrationId: f.row.id },
      });
      await t.issuer.process(work.id);
      await t.db.user.update({
        where: { id: f.staff.id },
        data: { organizerCapable: false },
      });
      expect((await t.settle(id)).status).toBe("COMPLETED");
      expect(
        await t.db.certificateBatchItem.findFirstOrThrow({
          where: { batchId: id },
        }),
      ).toMatchObject({ status: "SUCCEEDED", resultCode: "GENERATED" });
    });
    it("canonicalizes UUID case without duplicating an accepted operation", async () => {
      const f = await t.fixture(),
        key = randomUUID();
      const first = await t.post(
        f.path
          .toUpperCase()
          .replace("/EVENTS/", "/events/")
          .replace("/CERTIFICATE-BATCHES", "/certificate-batches"),
        f.staff,
        { ...selected, registration_ids: [f.row.id.toUpperCase()] },
        key,
      );
      expect(first.status).toBe(202);
      const again = await t.post(
        f.path,
        f.staff,
        { ...selected, registration_ids: [f.row.id] },
        key,
      );
      expect(again.body.batch.batch_id).toBe(first.body.batch.batch_id);
    });
    it("recovers a crashed batch renderer from its lease with a new fence", async () => {
      const f = await t.fixture();
      const id = await accept(f);
      await t.batches.recover();
      const work = await t.db.certificateIssueWork.findUniqueOrThrow({
        where: { registrationId: f.row.id },
      });
      const crashed = new CertificateService(t.deps, async () => {
        throw new Error("Synthetic process crash");
      });
      await expect(crashed.process(work.id)).rejects.toThrow();
      const claimed = await t.db.certificateIssueWork.findUniqueOrThrow({
        where: { id: work.id },
      });
      expect(claimed).toMatchObject({ status: "PENDING", attemptCount: 1 });
      await t.db.certificateIssueWork.update({
        where: { id: work.id },
        data: { leaseExpiresAt: new Date(0) },
      });
      await t.issuer.process(work.id);
      expect((await t.settle(id)).status).toBe("COMPLETED");
      expect(
        await t.db.certificateIssueWork.findUniqueOrThrow({
          where: { id: work.id },
        }),
      ).toMatchObject({
        status: "COMPLETED",
        attemptCount: 2,
        fencingToken: claimed.fencingToken + 1n,
      });
    });
    it("reuses a pending single command without replacing its replay or session policy", async () => {
      const f = await t.fixture();
      let release!: () => void;
      let started!: () => void;
      const begun = new Promise<void>((r) => {
        started = r;
      });
      const issuer = new CertificateService(t.deps, async (input) => {
        started();
        await new Promise<void>((r) => {
          release = r;
        });
        return renderDocument(input);
      });
      const command = issuer.issue(
        f.staff.context,
        f.event.id,
        f.row.id,
        selected,
        randomUUID(),
        randomUUID(),
      );
      await begun;
      const work = await t.db.certificateIssueWork.findUniqueOrThrow({
        where: { registrationId: f.row.id },
      });
      const id = await accept(f);
      await t.batches.recover();
      expect(
        await t.db.certificateIssueWork.findUniqueOrThrow({
          where: { id: work.id },
        }),
      ).toMatchObject({
        commandReplayId: work.commandReplayId,
        executionBatchId: null,
        generationCycle: 1,
      });
      release();
      expect((await command).status).toBe(201);
      expect((await t.settle(id)).status).toBe("COMPLETED");
      expect(
        (await t.get(f.path + `/${id}`, f.staff)).body.batch
          .already_satisfied_count,
      ).toBe(1);
    });
    it("accepts current Event Admin authority and detects assignment revocation without relying on sessions", async () => {
      const f = await t.fixture(),
        admin = await t.actor();
      const role = await t.db.eventRoleAssignment.create({
        data: {
          eventId: f.event.id,
          userId: admin.id,
          role: "EVENT_ADMIN",
          scopeKey: "EVENT",
          grantedByUserId: f.staff.id,
        },
      });
      const first = await t.post(f.path, admin, {
        ...selected,
        registration_ids: [f.row.id],
      });
      expect(first.status).toBe(202);
      await t.db.session.update({
        where: { id: admin.sessionId },
        data: { revokedAt: new Date() },
      });
      expect((await t.settle(first.body.batch.batch_id)).status).toBe(
        "COMPLETED",
      );
      const next = await t.registration(f.staff, f.event.id);
      const other = await t.actor();
      await t.db.eventRoleAssignment.update({
        where: { id: role.id },
        data: { revokedAt: new Date(), revokedByUserId: f.staff.id },
      });
      const otherRole = await t.db.eventRoleAssignment.create({
        data: {
          eventId: f.event.id,
          userId: other.id,
          role: "EVENT_ADMIN",
          scopeKey: "EVENT",
          grantedByUserId: f.staff.id,
        },
      });
      const second = await t.post(f.path, other, {
        ...selected,
        registration_ids: [next.row.id],
      });
      expect(second.status).toBe(202);
      await t.batches.recover();
      await t.db.eventRoleAssignment.update({
        where: { id: otherRole.id },
        data: { revokedAt: new Date(), revokedByUserId: f.staff.id },
      });
      expect((await t.settle(second.body.batch.batch_id)).status).toBe(
        "FAILED",
      );
      expect(
        (
          await t.post(f.path, other, {
            ...selected,
            registration_ids: [next.row.id],
          })
        ).status,
      ).toBe(404);
    });
    it("selects latest verified account email and isolates one exact stored PDF", async () => {
      const f = await issued(),
        contact = normalizeContact(
          "EMAIL",
          `${randomUUID()}@example.invalid`,
          t.deps.config.contactKey,
        );
      await t.db.verifiedContact.create({
        data: {
          userId: f.participant.id,
          type: "EMAIL",
          lookupHash: contact.lookupHash,
          encrypted: encryptContact(contact.value, t.deps.config.contactKey),
          verifiedAt: new Date(Date.now() + 1000),
        },
      });
      send.mockClear();
      await t.deliveries.process(f.d.id);
      const input = send.mock.calls[0][0];
      expect(input.recipient).toBe(contact.value);
      const cert = await t.db.certificate.findUniqueOrThrow({
        where: { registrationId: f.row.id },
      });
      expect(Buffer.from(input.pdf)).toEqual(Buffer.from(cert.pdfBytes));
      const staff = await t.get(f.managed + "/delivery", f.staff),
        owner = await t.get(
          `/registrations/${f.row.id}/certificate/delivery`,
          f.owner,
        );
      expect(staff.body.delivery.status).toBe("SENT");
      expect(
        matchesSchema(openapi.components.schemas.DeliveryResponse, staff.body),
      ).toBe(true);
      expect(owner.body.delivery).toEqual(staff.body.delivery);
      expect(JSON.stringify(staff.body)).not.toContain(contact.value);
    });
    it.each([{ guest: true }, { email: false }])(
      "keeps unavailable email recipients NOT_REQUIRED %j",
      async (options) => {
        const f = await issued(options);
        expect(f.d).toMatchObject({
          status: "NOT_REQUIRED",
          reasonCode: "NOT_DELIVERABLE",
          attemptCount: 0,
        });
        const count = send.mock.calls.length;
        await t.deliveries.process(f.d.id);
        expect(send).toHaveBeenCalledTimes(count);
      },
    );
    it("enrolls previously issued certificates idempotently and reads missing intent as null", async () => {
      // Existing intent is reused even across fresh enrollment keys.
      const f = await issued(),
        key = randomUUID();
      const a = await t.post(f.managed + "/delivery", f.staff, {}, key),
        b = await t.post(f.managed + "/delivery", f.staff, {}, key);
      expect(a.status).toBe(200);
      expect(b.body.delivery.delivery_id).toBe(f.d.id);
      expect(
        await t.db.certificateDelivery.count({
          where: { certificateId: f.d.certificateId },
        }),
      ).toBe(1);
      const fresh = await t.fixture();
      expect(
        (await t.get(fresh.managed + "/delivery", fresh.staff)).body.delivery,
      ).toBeNull();
    });
    it("retries definite failures with fresh durable attempts, preserving PDF and limiting attempts to three", async () => {
      const f = await issued(),
        worker = new CertificateDeliveries(t.deps, {
          send: async () => "FAILED",
        });
      const hash = (
        await t.db.certificate.findUniqueOrThrow({
          where: { id: f.d.certificateId },
        })
      ).pdfSha256;
      for (let attempt = 1; attempt <= 3; attempt++) {
        await worker.process(f.d.id);
        expect(
          (await t.get(f.managed + "/delivery", f.staff)).body.delivery,
        ).toMatchObject({ status: "FAILED", attempt_count: attempt });
        const retry = await t.post(f.managed + "/delivery/retry", f.staff, {});
        expect(retry.status).toBe(attempt === 3 ? 409 : 202);
        if (attempt === 3)
          expect(retry.body.code).toBe("ATTEMPT_LIMIT_REACHED");
      }
      expect(
        await t.db.certificateDeliveryAttempt.count({
          where: { deliveryId: f.d.id },
        }),
      ).toBe(3);
      expect(
        (
          await t.db.certificate.findUniqueOrThrow({
            where: { id: f.d.certificateId },
          })
        ).pdfSha256,
      ).toBe(hash);
    });
    it("holds ambiguous outcomes and never blindly resends UNKNOWN", async () => {
      const f = await issued(),
        sendUnknown = vi.fn().mockResolvedValue("UNKNOWN"),
        worker = new CertificateDeliveries(t.deps, { send: sendUnknown });
      await worker.process(f.d.id);
      await worker.recover();
      await worker.process(f.d.id);
      expect(
        sendUnknown.mock.calls.filter(
          ([input]) => input.certificateNumber === f.d.certificateId,
        ),
      ).toHaveLength(1);
      expect(
        (await t.post(f.managed + "/delivery/retry", f.staff, {})).body.code,
      ).toBe("DELIVERY_NOT_RETRYABLE");
    });
    it("blocks revoked-before-SENDING but preserves an authorized result when revoked during SENDING", async () => {
      const before = await issued();
      await t.post(before.managed + "/revoke", before.staff, {});
      const calls = send.mock.calls.length;
      await t.deliveries.process(before.d.id);
      expect(send).toHaveBeenCalledTimes(calls);
      expect(
        (await t.get(before.managed + "/delivery", before.staff)).body.delivery,
      ).toMatchObject({
        status: "NOT_REQUIRED",
        reason_code: "CERTIFICATE_REVOKED",
      });
      const during = await issued(),
        worker = new CertificateDeliveries(t.deps, {
          send: async () => {
            expect(
              (await t.post(during.managed + "/revoke", during.staff, {}))
                .status,
            ).toBe(200);
            return "FAILED";
          },
        });
      await worker.process(during.d.id);
      expect(
        (await t.get(during.managed + "/delivery", during.staff)).body.delivery
          .status,
      ).toBe("FAILED");
      expect(
        (await t.post(during.managed + "/delivery/retry", during.staff, {}))
          .body.code,
      ).toBe("DELIVERY_NOT_RETRYABLE");
      expect(
        await t.db.certificateDeliveryAttempt.count({
          where: { deliveryId: during.d.id },
        }),
      ).toBe(1);
    });
    it("recovers expired SENDING as UNKNOWN without sending again, fencing late completion", async () => {
      const f = await issued();
      let release!: (result: "SENT") => void;
      let started!: () => void;
      const begun = new Promise<void>((r) => {
        started = r;
      });
      const worker = new CertificateDeliveries(t.deps, {
        send: () => {
          started();
          return new Promise((r) => {
            release = r;
          });
        },
      });
      const pending = worker.process(f.d.id);
      await begun;
      const attempt = await t.db.certificateDeliveryAttempt.findFirstOrThrow({
        where: { deliveryId: f.d.id },
      });
      await t.db.certificateDeliveryAttempt.update({
        where: { id: attempt.id },
        data: { leaseExpiresAt: new Date(0) },
      });
      const recovery = new CertificateDeliveries(t.deps, {
        send: async () => {
          throw new Error("Must not resend");
        },
      });
      await recovery.process(f.d.id);
      release("SENT");
      await pending;
      expect(
        (
          await t.db.certificateDelivery.findUniqueOrThrow({
            where: { id: f.d.id },
          })
        ).status,
      ).toBe("UNKNOWN");
    });
    it("serializes concurrent send claims and delivery retry replay", async () => {
      const f = await issued(),
        submit = vi.fn().mockResolvedValue("FAILED"),
        a = new CertificateDeliveries(t.deps, { send: submit }),
        b = new CertificateDeliveries(t.deps, { send: submit });
      await Promise.all([a.process(f.d.id), b.process(f.d.id)]);
      expect(submit).toHaveBeenCalledTimes(1);
      const key = randomUUID(),
        responses = await Promise.all([
          t.post(f.managed + "/delivery/retry", f.staff, {}, key),
          t.post(f.managed + "/delivery/retry", f.staff, {}, key),
        ]);
      expect(responses.map((r) => r.status)).toEqual([202, 202]);
      expect(
        await t.db.certificateDeliveryAttempt.count({
          where: { deliveryId: f.d.id },
        }),
      ).toBe(2);
    });
    it.each(["SENT", "UNKNOWN"] as const)(
      "preserves %s after revocation crosses the authorized SENDING boundary",
      async (outcome) => {
        const f = await issued();
        const worker = new CertificateDeliveries(t.deps, {
          send: async () => {
            await t.post(f.managed + "/revoke", f.staff, {});
            return outcome;
          },
        });
        await worker.process(f.d.id);
        expect(
          (
            await t.db.certificateDelivery.findUniqueOrThrow({
              where: { id: f.d.id },
            })
          ).status,
        ).toBe(outcome);
        expect(
          (await t.post(f.managed + "/delivery/retry", f.staff, {})).body.code,
        ).toBe("DELIVERY_NOT_RETRYABLE");
      },
    );
    it("enforces event and owner isolation, CSRF, closed bodies and query restrictions", async () => {
      const f = await issued(),
        stranger = await t.actor(true),
        id = await accept(f);
      expect((await t.get(f.path + `/${id}`, stranger)).status).toBe(404);
      expect(
        (
          await t.get(
            `/registrations/${f.row.id}/certificate/delivery`,
            stranger,
          )
        ).status,
      ).toBe(404);
      expect(
        (await t.post(f.managed + "/delivery/retry", f.participant, {})).status,
      ).toBe(404);
      expect(
        (
          await t.post(
            f.path,
            { ...f.staff, csrf: "wrong" },
            { ...selected, registration_ids: [f.row.id] },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await t.post(f.managed + "/delivery", f.staff, {
            email: "forbidden@example.invalid",
          })
        ).status,
      ).toBe(400);
      expect(
        (await t.get(f.managed + "/delivery?email=x", f.staff)).status,
      ).toBe(400);
      expect(
        (await t.get(f.path + `/${id}/items?cursor=${randomUUID()}`, f.staff))
          .status,
      ).toBe(400);
    });
    it("rolls back a failed acceptance audit and holds ambiguous submission when outcome audit fails", async () => {
      const f = await t.fixture();
      const audit = vi.spyOn(t.db, "$transaction");
      audit.mockRejectedValueOnce(
        new Error("Synthetic audit transaction outage"),
      );
      expect(
        (
          await t.post(f.path, f.staff, {
            ...selected,
            registration_ids: [f.row.id],
          })
        ).status,
      ).toBe(503);
      audit.mockRestore();
      expect(
        await t.db.certificateBatch.count({ where: { eventId: f.event.id } }),
      ).toBe(0);
      const issuedF = await issued(),
        worker = new CertificateDeliveries(t.deps, {
          send: async () => {
            await t.db.$executeRawUnsafe(
              `CREATE FUNCTION slice10_test_fail_audit_${issuedF.event.id.replaceAll("-", "")}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='CERTIFICATE_DELIVERY_OUTCOME' AND NEW."eventId"='${issuedF.event.id}'::uuid THEN RAISE EXCEPTION 'Synthetic outage'; END IF; RETURN NEW; END $$`,
            );
            await t.db.$executeRawUnsafe(
              `CREATE TRIGGER slice10_test_audit_${issuedF.event.id.replaceAll("-", "")} BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION slice10_test_fail_audit_${issuedF.event.id.replaceAll("-", "")}()`,
            );
            return "SENT";
          },
        });
      try {
        await expect(worker.process(issuedF.d.id)).rejects.toThrow();
        expect(
          (
            await t.db.certificateDelivery.findUniqueOrThrow({
              where: { id: issuedF.d.id },
            })
          ).status,
        ).toBe("SENDING");
      } finally {
        await t.db.$executeRawUnsafe(
          `DROP TRIGGER slice10_test_audit_${issuedF.event.id.replaceAll("-", "")} ON "AuditEvent"`,
        );
        await t.db.$executeRawUnsafe(
          `DROP FUNCTION slice10_test_fail_audit_${issuedF.event.id.replaceAll("-", "")}()`,
        );
      }
      const attempt = await t.db.certificateDeliveryAttempt.findFirstOrThrow({
        where: { deliveryId: issuedF.d.id },
      });
      await t.db.certificateDeliveryAttempt.update({
        where: { id: attempt.id },
        data: { leaseExpiresAt: new Date(0) },
      });
      await t.deliveries.process(issuedF.d.id);
      expect(
        (
          await t.db.certificateDelivery.findUniqueOrThrow({
            where: { id: issuedF.d.id },
          })
        ).status,
      ).toBe("UNKNOWN");
    });
  },
);
