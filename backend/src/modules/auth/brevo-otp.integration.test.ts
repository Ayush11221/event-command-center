import { randomUUID } from "node:crypto";
import { ContactType, ProofPurpose } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../../config/database.js";
import { normalizeContact } from "./contact.js";
import { OtpService } from "./otp.js";
import { provisionAccount } from "./provision.js";
import { createOtpSender } from "./sender.js";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "Brevo OTP delivery and verification",
  () => {
    const config = {
      databaseUrl: process.env.TEST_DATABASE_URL ?? "",
      jwtSecret: Buffer.alloc(32, 61),
      contactKey: Buffer.alloc(32, 62),
      otpKey: Buffer.alloc(32, 63),
      cookieSecure: false,
      emailTransport: "brevo_api" as const,
      brevoApiUrl: "https://api.brevo.com/v3/smtp/email",
      brevoApiKey: `synthetic-${randomUUID()}`,
      smtpFrom: "platform@example.invalid",
    };
    const db = createDatabase(config.databaseUrl);
    afterEach(() => vi.unstubAllGlobals());
    afterAll(() => db.$disconnect());
    async function account() {
      const contact = `${randomUUID()}@example.invalid`;
      const userId = await provisionAccount(
        db,
        config,
        ContactType.EMAIL,
        contact,
        false,
        randomUUID(),
      );
      const lookupHash = normalizeContact(
        ContactType.EMAIL,
        contact,
        config.contactKey,
      ).lookupHash;
      return { contact, userId, lookupHash };
    }
    function provider(
      status = 201,
      body = '{"messageId":"<synthetic@brevo.invalid>"}',
      disconnect = false,
    ) {
      let code = "";
      const fetchMock = vi.fn(async (_url, request: RequestInit) => {
        const text = JSON.parse(request.body as string).textContent as string;
        code = text.match(/code is (\d{6})\./)![1];
        if (disconnect) throw new Error(`synthetic ${config.brevoApiKey}`);
        return new Response(body, { status });
      });
      vi.stubGlobal("fetch", fetchMock);
      return { fetchMock, code: () => code };
    }
    it("preserves generated codes, hashing, expiry, cooldown, successful account verification and one-time use", async () => {
      const a = await account(),
        p = provider();
      const otp = new OtpService(db, config, createOtpSender(config));
      const deliver = await otp.request(
        ProofPurpose.ACCOUNT,
        ContactType.EMAIL,
        a.contact,
        randomUUID(),
      );
      expect(deliver).toBeTypeOf("function");
      await deliver!();
      const row = await db.otpChallenge.findFirstOrThrow({
        where: { contactLookupHash: a.lookupHash },
      });
      expect(p.code()).toMatch(/^\d{6}$/);
      expect(row.codeHash).toMatch(/^[a-f0-9]{64}$/);
      expect(row.codeHash === p.code()).toBe(false);
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(300000);
      expect(row.deliveredAt).not.toBeNull();
      expect(row.consumedAt).toBeNull();
      expect(JSON.stringify(row).includes(config.brevoApiKey)).toBe(false);
      expect(
        await otp.request(
          ProofPurpose.ACCOUNT,
          ContactType.EMAIL,
          a.contact,
          randomUUID(),
        ),
      ).toBeNull();
      const result = await otp.verify(
        ProofPurpose.ACCOUNT,
        ContactType.EMAIL,
        a.contact,
        p.code(),
        randomUUID(),
      );
      expect(result).toMatchObject({ kind: "account", userId: a.userId });
      expect(await db.session.count({ where: { userId: a.userId } })).toBe(1);
      await expect(
        otp.verify(
          ProofPurpose.ACCOUNT,
          ContactType.EMAIL,
          a.contact,
          p.code(),
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: "INVALID_PROOF" });
      expect(p.fetchMock).toHaveBeenCalledTimes(1);
    });
    it.each([
      { status: 400, body: "synthetic rejection", disconnect: false },
      { status: 408, body: "synthetic timeout", disconnect: false },
      { status: 500, body: "synthetic outage", disconnect: false },
      { status: 201, body: "malformed", disconnect: false },
      { status: 201, body: "", disconnect: true },
    ])(
      "preserves failure cleanup and generic reporting for status $status (disconnect $disconnect)",
      async ({ status, body, disconnect }) => {
        const a = await account(),
          p = provider(status, body, disconnect),
          report = vi.fn();
        const otp = new OtpService(db, config, createOtpSender(config), report);
        const deliver = await otp.request(
          ProofPurpose.ACCOUNT,
          ContactType.EMAIL,
          a.contact,
          randomUUID(),
        );
        await deliver!();
        const row = await db.otpChallenge.findFirstOrThrow({
          where: { contactLookupHash: a.lookupHash },
        });
        expect(row.deliveredAt).toBeNull();
        expect(row.consumedAt).not.toBeNull();
        expect(report).toHaveBeenCalledExactlyOnceWith("OTP delivery failed");
        await expect(
          otp.verify(
            ProofPurpose.ACCOUNT,
            ContactType.EMAIL,
            a.contact,
            p.code(),
            randomUUID(),
          ),
        ).rejects.toMatchObject({ code: "INVALID_PROOF" });
        expect(await db.session.count({ where: { userId: a.userId } })).toBe(0);
        expect(
          await otp.request(
            ProofPurpose.ACCOUNT,
            ContactType.EMAIL,
            a.contact,
            randomUUID(),
          ),
        ).toBeNull();
        expect(p.fetchMock).toHaveBeenCalledTimes(1);
      },
    );
    it("delivers for new verified-email signup without creating an account before proof or exposing existence", async () => {
      const p = provider(),
        otp = new OtpService(db, config, createOtpSender(config));
      const contact = `${randomUUID()}@example.invalid`;
      const deliver = await otp.request(
        ProofPurpose.ACCOUNT,
        ContactType.EMAIL,
        contact,
        randomUUID(),
      );
      expect(deliver).toBeTypeOf("function");
      await deliver!();
      expect(
        await db.verifiedContact.count({
          where: {
            lookupHash: normalizeContact(
              ContactType.EMAIL,
              contact,
              config.contactKey,
            ).lookupHash,
          },
        }),
      ).toBe(0);
      expect(
        await otp.request(
          ProofPurpose.ACCOUNT,
          ContactType.EMAIL,
          contact,
          randomUUID(),
        ),
      ).toBeNull();
      expect(p.fetchMock).toHaveBeenCalledTimes(1);
    });
    it("preserves guest email proof and its event binding with the same selected transport", async () => {
      const p = provider(),
        otp = new OtpService(db, config, createOtpSender(config));
      const contact = `${randomUUID()}@example.invalid`,
        eventId = randomUUID();
      const deliver = await otp.request(
        ProofPurpose.GUEST_OWNERSHIP,
        ContactType.EMAIL,
        contact,
        randomUUID(),
        eventId,
      );
      await deliver!();
      await expect(
        otp.verify(
          ProofPurpose.GUEST_OWNERSHIP,
          ContactType.EMAIL,
          contact,
          p.code(),
          randomUUID(),
          eventId,
        ),
      ).resolves.toMatchObject({ kind: "guest", contextEventId: eventId });
      expect(p.fetchMock).toHaveBeenCalledTimes(1);
    });
  },
);
