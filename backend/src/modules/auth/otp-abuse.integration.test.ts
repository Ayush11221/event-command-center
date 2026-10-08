import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
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
    const signedChallenge = (
      contact: string,
      purpose = "account",
      source = "192.0.2.1",
      body?: string,
    ) => {
      const path = `/api/v1/auth/${purpose}/challenge`;
      const raw = body ?? JSON.stringify({ type: "EMAIL", contact });
      const payload = Buffer.from(
        JSON.stringify({
          version: 1,
          audience: "eoc-otp-source:production",
          source_ip: source,
          issued_at: Math.floor(Date.now() / 1000),
          method: "POST",
          path,
          body_sha256: createHash("sha256").update(raw).digest("hex"),
        }),
      ).toString("base64url");
      const assertion = `${payload}.${createHmac(
        "sha256",
        config.otpAbuse!.sourceSigningKey!,
      )
        .update(`eoc-otp-source:v1:${payload}`)
        .digest("base64url")}`;
      return {
        assertion,
        request: request(app)
          .post(path)
          .set("Origin", origin)
          .set("Content-Type", "application/json")
          .set("X-EOC-OTP-Source", assertion)
          .send(raw),
      };
    };
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
      signedChallenge,
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

  const signedMode = () => ({
    sourceMode: "signed_gateway" as const,
    sourceSigningKey: randomBytes(32),
  });
  it("rejects unsigned/spoofed/tampered requests before every database reservation or delivery", async () => {
    const f = fixture(signedMode());
    const contact = email();
    const transaction = vi.spyOn(db, "$transaction");
    const providerKey = createHmac("sha256", f.config.otpKey)
      .update("otp-budget:PROVIDER:3600:application")
      .digest("hex");
    const spoofedHeaders: Record<string, string>[] = [
      {},
      { "X-Real-IP": "192.0.2.1" },
      { "X-Forwarded-For": "192.0.2.1" },
      { "X-Source-IP": "192.0.2.1" },
      { "X-EOC-OTP-Source": "invalid" },
    ];
    for (const purpose of ["account", "guest"]) {
      for (const headers of spoofedHeaders) {
        const response = await f.challenge(contact, purpose, headers);
        expect(response.status).toBe(503);
        expect(response.body).toMatchObject({
          code: "DEPENDENCY_UNAVAILABLE",
          message: "Service unavailable",
        });
      }
      const signed = f.signedChallenge(contact, purpose);
      expect(
        (
          await f.challenge(email(), purpose, {
            "X-EOC-OTP-Source": signed.assertion,
          })
        ).status,
      ).toBe(503);
      const opposite = purpose === "account" ? "guest" : "account";
      expect(
        (
          await f.challenge(contact, opposite, {
            "X-EOC-OTP-Source": signed.assertion,
          })
        ).status,
      ).toBe(503);
    }
    expect(transaction).not.toHaveBeenCalled();
    transaction.mockRestore();
    expect(
      await db.otpChallenge.count({
        where: { contactLookupHash: f.lookup(contact) },
      }),
    ).toBe(0);
    expect(
      await db.otpRateLimitBucket.count({ where: { key: providerKey } }),
    ).toBe(0);
    expect(f.send).not.toHaveBeenCalled();
    for (const secret of [
      contact,
      "192.0.2.1",
      f.config.otpAbuse!.sourceSigningKey!.toString("hex"),
    ])
      expect(f.logs()).not.toContain(secret);
  });
  it("shares verified-source budgets across purposes and isolates different verified sources", async () => {
    const f = fixture({
      ...signedMode(),
      source: { limit: 1, windowSeconds: 3600 },
    });
    expect(
      (await f.signedChallenge(email(), "guest", "192.0.2.1").request).status,
    ).toBe(202);
    expect(
      (await f.signedChallenge(email(), "account", "192.0.2.1").request).status,
    ).toBe(429);
    expect(
      (await f.signedChallenge(email(), "guest", "192.0.2.2").request).status,
    ).toBe(202);
  });
  it("keeps contact and application limits global with signed sources", async () => {
    const f = fixture({
      ...signedMode(),
      contact: { limit: 1, windowSeconds: 3600 },
    });
    const contact = email();
    expect(
      (await f.signedChallenge(contact, "guest", "192.0.2.1").request).status,
    ).toBe(202);
    await f.age(contact);
    expect(
      (await f.signedChallenge(contact, "account", "192.0.2.2").request).status,
    ).toBe(429);
    const application = fixture({
      ...signedMode(),
      provider: { limit: 1, windowSeconds: 3600 },
    });
    expect(
      (await application.signedChallenge(email(), "guest", "192.0.2.1").request)
        .status,
    ).toBe(202);
    expect(
      (
        await application.signedChallenge(email(), "account", "192.0.2.2")
          .request
      ).status,
    ).toBe(429);
  });
  it("keeps concurrent signed HTTP reservations atomic", async () => {
    const f = fixture({
      ...signedMode(),
      provider: { limit: 3, windowSeconds: 3600 },
    });
    const replies = await Promise.all(
      Array.from(
        { length: 8 },
        (_, index) =>
          f.signedChallenge(
            email(),
            index % 2 ? "account" : "guest",
            `192.0.2.${index + 1}`,
          ).request,
      ),
    );
    expect(replies.filter((reply) => reply.status === 202)).toHaveLength(3);
    expect(replies.filter((reply) => reply.status === 429)).toHaveLength(5);
  });
  it("keeps raw-body binding, cooldown, expiry, attempt limits, latest challenges and private logs", async () => {
    const f = fixture(signedMode());
    const contact = email();
    const raw = `{ "contact": "${contact}", "type": "EMAIL" }`;
    const initial = f.signedChallenge(contact, "guest", "2001:db8::1", raw);
    expect((await initial.request).status).toBe(202);
    await vi.waitFor(() => expect(f.codes.has(contact)).toBe(true));
    const originalCode = f.codes.get(contact)!;
    expect(
      (await f.signedChallenge(contact, "guest", "2001:db8::1").request).status,
    ).toBe(429);
    expect(f.send).toHaveBeenCalledTimes(1);
    const row = await db.otpChallenge.findFirstOrThrow({
      where: { contactLookupHash: f.lookup(contact) },
    });
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(300_000);
    await f.age(contact);
    expect(
      (await f.signedChallenge(contact, "guest", "2001:db8::1").request).status,
    ).toBe(202);
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => {
      const latest = await db.otpChallenge.findFirstOrThrow({
        where: { contactLookupHash: f.lookup(contact) },
        orderBy: { createdAt: "desc" },
      });
      expect(latest.deliveredAt).not.toBeNull();
    });
    expect(
      (await db.otpChallenge.findUniqueOrThrow({ where: { id: row.id } }))
        .consumedAt,
    ).not.toBeNull();
    for (let attempt = 1; attempt <= 5; attempt++) {
      const code = f.codes.get(contact) === "000000" ? "111111" : "000000";
      const response = await request(f.app)
        .post("/api/v1/auth/guest/verify")
        .set("Origin", origin)
        .send({ type: "EMAIL", contact, code });
      expect(response.status).toBe(attempt === 5 ? 429 : 401);
    }
    for (const value of [
      contact,
      "2001:db8::1",
      initial.assertion,
      originalCode,
      f.config.otpAbuse!.sourceSigningKey!.toString("hex"),
    ])
      expect(f.logs()).not.toContain(value);
  });
  it("retains account anti-enumeration, unsigned verification and expiry in signed mode", async () => {
    const f = fixture(signedMode()),
      known = email(),
      unknown = email(),
      guest = email();
    await provisionAccount(
      db,
      f.config,
      ContactType.EMAIL,
      known,
      false,
      randomUUID(),
    );
    const replies = await Promise.all(
      [known, unknown].map((contact) => f.signedChallenge(contact).request),
    );
    for (const reply of replies) {
      expect(reply.status).toBe(202);
      expect(Object.keys(reply.body).sort()).toEqual([
        "correlation_id",
        "status",
      ]);
    }
    expect((await f.signedChallenge(guest, "guest").request).status).toBe(202);
    await vi.waitFor(async () => {
      const rows = await db.otpChallenge.findMany({
        where: {
          contactLookupHash: { in: [f.lookup(known), f.lookup(guest)] },
        },
      });
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.deliveredAt)).toBe(true);
    });
    const signedIn = await request(f.app)
      .post("/api/v1/auth/account/verify")
      .set("Origin", origin)
      .send({ type: "EMAIL", contact: known, code: f.codes.get(known)! });
    expect(signedIn.status).toBe(200);
    expect(signedIn.headers["set-cookie"]).toBeDefined();
    await db.otpChallenge.updateMany({
      where: { contactLookupHash: f.lookup(guest) },
      data: {
        createdAt: new Date(Date.now() - 120_000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    expect(
      (
        await request(f.app)
          .post("/api/v1/auth/guest/verify")
          .set("Origin", origin)
          .send({ type: "EMAIL", contact: guest, code: f.codes.get(guest)! })
      ).status,
    ).toBe(401);
    expect(f.codes.has(unknown)).toBe(true); // Existing email anti-enumeration sends a generic challenge for both.
  });
  it("retains delivery-failure cleanup and reservations after a signed admission", async () => {
    const f = fixture({
        ...signedMode(),
        provider: { limit: 1, windowSeconds: 3600 },
      }),
      contact = email();
    f.send.mockRejectedValueOnce(new Error("synthetic provider failure"));
    expect((await f.signedChallenge(contact, "guest").request).status).toBe(
      202,
    );
    await vi.waitFor(async () => {
      const row = await db.otpChallenge.findFirstOrThrow({
        where: { contactLookupHash: f.lookup(contact) },
      });
      expect(row.consumedAt).not.toBeNull();
      expect(row.deliveredAt).toBeNull();
    });
    expect(
      (await f.signedChallenge(email(), "account", "192.0.2.2").request).status,
    ).toBe(429);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.failure).toHaveBeenCalledExactlyOnceWith("OTP delivery failed");
  });
});
