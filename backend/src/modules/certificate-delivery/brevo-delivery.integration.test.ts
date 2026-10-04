import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { testContext, selected } from "../../../../tests/fixtures/slice10.mjs";
import { CertificateDeliveries } from "./delivery.js";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "Brevo durable delivery integration",
  () => {
    const t = testContext({
      async send() {
        throw new Error("unexpected fixture sender");
      },
    });
    const key = `synthetic-${randomUUID()}`;
    const deliveries = new CertificateDeliveries({
      ...t.deps,
      config: {
        ...t.deps.config,
        emailTransport: "brevo_api",
        brevoApiUrl: "https://api.brevo.com/v3/smtp/email",
        brevoApiKey: key,
        smtpFrom: "platform@example.invalid",
      },
    });
    afterEach(() => vi.unstubAllGlobals());
    afterAll(() => t.db.$disconnect());
    it.each([
      {
        status: 201,
        body: '{"messageId":"<synthetic@brevo.invalid>"}',
        outcome: "SENT",
      },
      { status: 400, body: "synthetic rejection", outcome: "FAILED" },
      { status: 500, body: "synthetic outage", outcome: "UNKNOWN" },
      { status: 201, body: "invalid acknowledgement", outcome: "UNKNOWN" },
    ] as const)(
      "records $outcome for provider status $status without resubmission",
      async ({ status, body, outcome }) => {
        const fetchMock = vi
          .fn()
          .mockImplementation(async () => new Response(body, { status }));
        vi.stubGlobal("fetch", fetchMock);
        const f = await t.fixture();
        expect((await t.post(f.managed, f.staff, selected)).status).toBe(201);
        const intent = await t.db.certificateDelivery.findFirstOrThrow({
          where: { eventId: f.event.id },
        });
        await deliveries.process(intent.id);
        const delivery = await t.db.certificateDelivery.findUniqueOrThrow({
          where: { id: intent.id },
        });
        const attempts = await t.db.certificateDeliveryAttempt.findMany({
          where: { deliveryId: intent.id },
        });
        expect(delivery.status).toBe(outcome);
        expect(delivery.attemptCount).toBe(1);
        expect(attempts).toHaveLength(1);
        expect(attempts[0].status).toBe(outcome);
        expect(
          JSON.stringify({ delivery, attempts }, (_name, value) =>
            typeof value === "bigint" ? value.toString() : value,
          ).includes(key),
        ).toBe(false);
        await deliveries.process(intent.id);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        if (outcome !== "FAILED") {
          const retry = await t.post(
            f.managed + "/delivery/retry",
            f.staff,
            {},
          );
          expect(retry.status).toBe(409);
          expect(retry.body.code).toBe("DELIVERY_NOT_RETRYABLE");
        } else {
          const retry = await t.post(
            f.managed + "/delivery/retry",
            f.staff,
            {},
          );
          expect(retry.status).toBe(202);
          await deliveries.process(intent.id);
          expect(fetchMock).toHaveBeenCalledTimes(2);
          expect(
            await t.db.certificateDeliveryAttempt.count({
              where: { deliveryId: intent.id },
            }),
          ).toBe(2);
        }
      },
    );
  },
);
