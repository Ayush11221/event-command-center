import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { ContactType, PrismaClient, ProofPurpose } from "@prisma/client";
import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { createDatabase } from "../../config/database.js";
import { createLogger } from "../../config/logger.js";
import type { FoundationConfig } from "../../config/foundation.js";
import {
  defaultOtpAbuseConfig,
  type OtpAbuseConfig,
} from "../../config/otp-abuse.js";
import { normalizeContact } from "./contact.js";
import { OtpService } from "./otp.js";
import { provisionAccount } from "./provision.js";

const url = process.env.TEST_DATABASE_URL;
const origin = "https://app.example.test";
const email = () => `${randomUUID()}@example.test`;

describe.skipIf(!url)("PostgreSQL aggregate OTP admission", () => {
  const db = createDatabase(url ?? "");
  afterAll(() => db.$disconnect());
  function fixture(overrides: Partial<OtpAbuseConfig> = {}, client = db) {
    const config: FoundationConfig = {
      databaseUrl: url!,
      jwtSecret: randomBytes(32),
      contactKey: randomBytes(32),
      otpKey: randomBytes(32),
      cookieSecure: true,
      otpAbuse: { ...defaultOtpAbuseConfig, ...overrides },
    };
    const codes = new Map<string, string>();
    const send = vi.fn(
      async (_type: ContactType, contact: string, code: string) => {
        codes.set(contact, code);
      },
    );
    const failure = vi.fn(),
      limited = vi.fn();
    const sender = { available: () => true, send };
    const otp = new OtpService(client, config, sender, failure, limited);
    let logs = "";
    const logger = createLogger(
      new Writable({
        write(chunk, _encoding, done) {
          logs += String(chunk);
          done();
        },
      }),
    );
    const app = createApp({ port: 3000, frontendOrigin: origin }, logger, {
      db: client,
      config,
      otp,
      frontendOrigin: origin,
    });
    const admit = (
      contact = email(),
      source = "192.0.2.1",
      purpose: ProofPurpose = ProofPurpose.ACCOUNT,
      type: ContactType = ContactType.EMAIL,
    ) => otp.request(purpose, type, contact, randomUUID(), null, source);
    const challenge = (
      contact: string,
      purpose = "account",
      headers: Record<string, string> = {},
      type = "EMAIL",
    ) =>
      request(app)
        .post(`/api/v1/auth/${purpose}/challenge`)
        .set("Origin", origin)
        .set(headers)
        .send({ type, contact });
    const lookup = (contact: string, type: ContactType = ContactType.EMAIL) =>
      normalizeContact(type, contact, config.contactKey).lookupHash;
    const age = async (contact: string) => {
      await db.otpChallenge.updateMany({
        where: { contactLookupHash: lookup(contact) },
        data: { lastSentAt: new Date(Date.now() - 61_000) },
      });
    };
    return {
      config,
      codes,
      send,
      sender,
      failure,
      limited,
      otp,
      app,
      admit,
      challenge,
      lookup,
      age,
      logs: () => logs,
    };
  }

  it("keeps normal delivery and account/guest resend behavior with request budgets", async () => {
    const f = fixture(),
      contact = email();
    const delivery = await f.admit(contact);
    await delivery!();
    expect(f.codes.get(contact)).toMatch(/^\d{6}$/);
    expect(await f.admit(contact)).toBeNull();
    await expect(
      f.admit(contact, "192.0.2.1", ProofPurpose.GUEST_OWNERSHIP),
    ).rejects.toMatchObject({ status: 429 });
    expect(f.send).toHaveBeenCalledTimes(1);
    const row = await db.otpChallenge.findFirstOrThrow({
      where: { contactLookupHash: f.lookup(contact) },
    });
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(300_000);
    expect(row.codeHash).not.toBe(f.codes.get(contact));
  });

  it("shares normalized contact admission across account/guest purposes and sources", async () => {
    const f = fixture({ contact: { limit: 2, windowSeconds: 3600 } }),
      contact = email();
    await (await f.admit(contact))!();
    await f.age(contact);
    await (await f.admit(
      ` ${contact.toUpperCase()} `,
      "192.0.2.2",
      ProofPurpose.GUEST_OWNERSHIP,
    ))!();
    await f.age(contact);
    await expect(f.admit(contact, "192.0.2.3")).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      category: "CONTACT",
    });
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.limited).toHaveBeenCalledExactlyOnceWith("CONTACT");
    expect(
      await db.otpChallenge.count({
        where: { contactLookupHash: f.lookup(contact) },
      }),
    ).toBe(2);
  });

  it("blocks different contacts and equivalent source spellings at the shared source budget", async () => {
    const f = fixture({ source: { limit: 2, windowSeconds: 3600 } });
    await f.admit(email(), "192.0.2.4");
    await f.admit(email(), "::ffff:c000:204", ProofPurpose.GUEST_OWNERSHIP);
    await expect(f.admit(email(), "::ffff:192.0.2.4")).rejects.toMatchObject({
      category: "SOURCE",
    });
    expect(await f.admit(email(), "192.0.2.5")).toBeTypeOf("function");
  });

  it("rejects mailbox parser aliases before admission and shares IDNA domain budgets", async () => {
    const f = fixture({ contact: { limit: 1, windowSeconds: 3600 } });
    for (const contact of [
      "a<victim@example.test>",
      "b<victim@example.test>",
      "victim(comment1)@example.test",
      "victim(comment2)@example.test",
      '"vic"tim@example.test',
      "a:vic@example.test;",
      "a,b@example.test",
      "victim\\@example.test",
      "victim\u0000@example.test",
    ])
      await expect(
        f.admit(contact, "192.0.2.1", ProofPurpose.GUEST_OWNERSHIP),
      ).rejects.toMatchObject({ status: 400, code: "VALIDATION" });
    expect(f.send).not.toHaveBeenCalled();
    expect(await f.admit("victim@example.test")).toBeTypeOf("function");
    await f.admit("victim@bücher.example");
    await expect(
      f.admit(
        "victim@xn--bcher-kva.example",
        "192.0.2.2",
        ProofPurpose.GUEST_OWNERSHIP,
      ),
    ).rejects.toMatchObject({ category: "CONTACT" });
    await f.admit("victim@ｂｕｃｈｅｒ.example");
    await expect(
      f.admit("victim@bucher.example", "192.0.2.3"),
    ).rejects.toMatchObject({ category: "CONTACT" });
  });

  it("blocks total application admission across distinct sources and both purposes", async () => {
    const f = fixture({ provider: { limit: 2, windowSeconds: 3600 } });
    await f.admit(email(), "192.0.2.1");
    await f.admit(email(), "192.0.2.2", ProofPurpose.GUEST_OWNERSHIP);
    await expect(f.admit(email(), "192.0.2.3")).rejects.toMatchObject({
      category: "PROVIDER",
    });
    expect(f.send).not.toHaveBeenCalled();
  });

  it.each(["contact", "source", "provider"] as const)(
    "cannot race past the %s limit across independent instances",
    async (layer) => {
      const f = fixture({ [layer]: { limit: 3, windowSeconds: 3600 } });
      const otherDb = createDatabase(url!);
      try {
        const other = new OtpService(otherDb, f.config, f.sender);
        const contact = email();
        const results = await Promise.allSettled(
          Array.from({ length: 8 }, (_, index) =>
            (index % 2 ? other : f.otp).request(
              ProofPurpose.ACCOUNT,
              ContactType.EMAIL,
              layer === "contact" ? contact : email(),
              randomUUID(),
              null,
              layer === "provider" ? `192.0.2.${index + 1}` : "192.0.2.1",
            ),
          ),
        );
        expect(
          results.filter((result) => result.status === "fulfilled"),
        ).toHaveLength(3);
        for (const result of results.filter(
          (result) => result.status === "rejected",
        ))
          expect(result.reason).toMatchObject({
            code: "RATE_LIMITED",
            category: layer.toUpperCase(),
          });
        // A new service/client after admission observes the same durable state.
        await expect(
          other.request(
            ProofPurpose.ACCOUNT,
            ContactType.EMAIL,
            layer === "contact" ? contact : email(),
            randomUUID(),
            null,
            "192.0.2.1",
          ),
        ).rejects.toMatchObject({ code: "RATE_LIMITED" });
        for (const result of results)
          if (result.status === "fulfilled" && result.value)
            await result.value();
        expect(f.send).toHaveBeenCalledTimes(layer === "contact" ? 1 : 3);
      } finally {
        await otherDb.$disconnect();
      }
    },
  );

  it("shares admission with a separate Node process", async () => {
    const f = fixture({ provider: { limit: 1, windowSeconds: 3600 } });
    await f.admit();
    const databaseModule = pathToFileURL(
      resolve(import.meta.dirname, "../../config/database.ts"),
    ).href;
    const otpModule = pathToFileURL(
      resolve(import.meta.dirname, "otp.ts"),
    ).href;
    const script = `
      import { createDatabase } from ${JSON.stringify(databaseModule)};
      import { OtpService } from ${JSON.stringify(otpModule)};
      const input = JSON.parse(process.env.P0E_TEST_CONFIG);
      const config = { ...input, jwtSecret: Buffer.from(input.jwtSecret, 'hex'), contactKey: Buffer.from(input.contactKey, 'hex'), otpKey: Buffer.from(input.otpKey, 'hex') };
      const db = createDatabase(config.databaseUrl);
      try {
        const otp = new OtpService(db, config, { available: () => true, send: async () => { throw new Error('unexpected delivery'); } });
        try { await otp.request('ACCOUNT', 'EMAIL', 'separate-process@example.test', 'synthetic', null, '192.0.2.99'); process.stdout.write('BYPASSED'); }
        catch (error) { process.stdout.write(error.code); }
      } finally { await db.$disconnect(); }
    `;
    const result = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      {
        env: {
          ...process.env,
          P0E_TEST_CONFIG: JSON.stringify({
            ...f.config,
            jwtSecret: Buffer.from(f.config.jwtSecret).toString("hex"),
            contactKey: f.config.contactKey.toString("hex"),
            otpKey: f.config.otpKey.toString("hex"),
          }),
        },
        timeout: 10_000,
      },
    );
    expect(result.stdout).toBe("RATE_LIMITED");
    expect(result.stderr).toBe("");
  }, 15_000);

  it.each(["contact", "source", "provider"] as const)(
    "uses database windows and restores %s capacity on rollover",
    async (layer) => {
      const f = fixture({ [layer]: { limit: 1, windowSeconds: 1 } }),
        contact = email();
      // Align near the start using the database clock, not an application clock.
      await vi.waitFor(
        async () => {
          const [clock] = await db.$queryRaw<
            { ms: number }[]
          >`SELECT (EXTRACT(MILLISECONDS FROM clock_timestamp())::int % 1000) AS ms`;
          expect(clock!.ms).toBeLessThan(150);
        },
        { timeout: 2000, interval: 20 },
      );
      await f.admit(contact);
      await f.age(contact);
      await expect(f.admit(contact)).rejects.toMatchObject({
        category: layer.toUpperCase(),
      });
      await vi.waitFor(
        async () => {
          expect(await f.admit(contact)).toBeTypeOf("function");
        },
        { timeout: 2000, interval: 50 },
      );
    },
  );

  it("removes expired buckets in bounded batches and retains active buckets", async () => {
    const f = fixture();
    const oldKeys = Array.from({ length: 405 }, () =>
      randomBytes(32).toString("hex"),
    );
    await db.otpRateLimitBucket.createMany({
      data: oldKeys.map((key) => ({
        category: "CONTACT",
        key,
        count: 1,
        windowStart: new Date(Date.now() - 3 * 86400_000),
        expiresAt: new Date(Date.now() - 86400_000),
      })),
    });
    const activeKey = randomBytes(32).toString("hex");
    await db.otpRateLimitBucket.create({
      data: {
        category: "CONTACT",
        key: activeKey,
        count: 1,
        windowStart: new Date(),
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });
    for (const expected of [205, 5, 0]) {
      await f.admit();
      expect(
        await db.otpRateLimitBucket.count({ where: { key: { in: oldKeys } } }),
      ).toBe(expected);
    }
    expect(
      await db.otpRateLimitBucket.count({ where: { key: activeKey } }),
    ).toBe(1);
  });

  it("fails closed on rate-state and challenge/audit persistence failure without delivery", async () => {
    const f = fixture();
    const query = vi
      .spyOn(db, "$transaction")
      .mockRejectedValueOnce(new Error("synthetic database detail"));
    await expect(f.admit()).rejects.toMatchObject({
      status: 503,
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Service unavailable",
    });
    query.mockRestore();
    const broken = {
      $transaction: async (operation: (tx: unknown) => unknown) =>
        operation({
          $queryRaw: () =>
            Promise.reject(new Error("synthetic bucket store detail")),
        }),
    } as unknown as PrismaClient;
    const blocked = new OtpService(broken, f.config, f.sender);
    await expect(
      blocked.request(
        ProofPurpose.ACCOUNT,
        ContactType.EMAIL,
        email(),
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(f.send).not.toHaveBeenCalled();
  });

  it("retains failed and ambiguous delivery reservations and sends a callback at most once", async () => {
    const f = fixture({ provider: { limit: 1, windowSeconds: 3600 } });
    f.send.mockRejectedValueOnce(new Error("synthetic provider body"));
    const contact = email(),
      delivery = await f.admit(contact);
    await Promise.all([delivery!(), delivery!()]);
    expect(f.send).toHaveBeenCalledTimes(1);
    await expect(f.admit(email(), "192.0.2.2")).rejects.toMatchObject({
      category: "PROVIDER",
    });
    const challenge = await db.otpChallenge.findFirstOrThrow({
      where: { contactLookupHash: f.lookup(contact) },
    });
    expect(challenge.consumedAt).not.toBeNull();
    expect(challenge.deliveredAt).toBeNull();
    expect(f.failure).toHaveBeenCalledExactlyOnceWith("OTP delivery failed");
  });

  it("returns identical generic account limits for known/unknown contacts and ignores spoofed headers", async () => {
    const f = fixture({ contact: { limit: 2, windowSeconds: 3600 } });
    const known = email(),
      unknown = email();
    await provisionAccount(
      db,
      f.config,
      ContactType.EMAIL,
      known,
      false,
      randomUUID(),
    );
    for (let index = 0; index < 3; index++) {
      const responses = await Promise.all(
        [known, unknown].map((contact) =>
          f.challenge(contact, "account", {
            "X-Forwarded-For": `192.0.2.${index + 1}`,
            "X-Real-IP": `192.0.2.${index + 1}`,
          }),
        ),
      );
      for (const response of responses) {
        expect(response.status).toBe(index < 2 ? 202 : 429);
        expect(Object.keys(response.body).sort()).toEqual(
          index < 2
            ? ["correlation_id", "status"]
            : ["code", "correlation_id", "message"],
        );
        if (index === 2)
          expect(response.body).toMatchObject({
            code: "RATE_LIMITED",
            message: "Too many verification requests. Please try again later.",
          });
      }
    }
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(2));
    for (const code of f.codes.values()) expect(f.logs()).not.toContain(code);
    for (const contact of [known, unknown]) {
      expect(f.logs()).not.toContain(contact);
      expect(f.logs()).not.toContain(f.lookup(contact));
    }
  });

  it("counts known/unknown phone requests identically even when unknown accounts receive no delivery", async () => {
    for (const known of [false, true]) {
      const f = fixture({ provider: { limit: 1, windowSeconds: 3600 } }),
        phone = "+12025550123";
      if (known)
        await provisionAccount(
          db,
          f.config,
          ContactType.PHONE,
          phone,
          false,
          randomUUID(),
        );
      expect((await f.challenge(phone, "account", {}, "PHONE")).status).toBe(
        202,
      );
      const next = await f.challenge(email());
      expect(next.status).toBe(429);
      expect(next.body.code).toBe("RATE_LIMITED");
      expect(
        await db.otpChallenge.count({
          where: { contactLookupHash: f.lookup(phone, ContactType.PHONE) },
        }),
      ).toBe(1);
    }
  });

  it("integrates trusted Railway sources without grouping clients or trusting a spoofed forwarded header", async () => {
    const f = fixture({
      source: { limit: 1, windowSeconds: 3600 },
      sourceMode: "railway",
      trustedProxyCidrs: ["127.0.0.1/32"],
    });
    expect(
      (await f.challenge(email(), "guest", { "X-Real-IP": "192.0.2.1" }))
        .status,
    ).toBe(202);
    expect(
      (await f.challenge(email(), "account", { "X-Real-IP": "192.0.2.2" }))
        .status,
    ).toBe(202);
    expect(
      (
        await f.challenge(email(), "guest", {
          "X-Real-IP": "192.0.2.1",
          "X-Forwarded-For": "192.0.2.3",
        })
      ).status,
    ).toBe(429);
    expect((await f.challenge(email())).status).toBe(503);
  });
});
