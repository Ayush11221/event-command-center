import { createHash, createHmac, randomBytes } from "node:crypto";
import type { Request } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultOtpAbuseConfig } from "../../config/otp-abuse.js";
import { captureOtpBody, otpRequestSource } from "./otp-source.js";

const key = randomBytes(32);
const config = {
  ...defaultOtpAbuseConfig,
  sourceMode: "signed_gateway" as const,
  sourceSigningKey: key,
};
const path = "/api/v1/auth/account/challenge";
const body = Buffer.from(
  '{ "type": "EMAIL", "contact": "synthetic@example.test" }',
);
function payload() {
  return {
    version: 1,
    audience: "eoc-otp-source:production",
    source_ip: "192.0.2.1",
    issued_at: Math.floor(Date.now() / 1000),
    method: "POST",
    path,
    body_sha256: createHash("sha256").update(body).digest("hex"),
  };
}
function sign(value: unknown = payload(), signingKey = key): string {
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encoded}.${createHmac("sha256", signingKey).update(`eoc-otp-source:v1:${encoded}`).digest("base64url")}`;
}
function incoming(
  assertion: string | string[] | undefined = sign(),
  overrides: Partial<Request> = {},
): Request {
  const request = {
    method: "POST",
    originalUrl: path,
    rawHeaders: assertion
      ? [
          "X-EOC-OTP-Source",
          ...(Array.isArray(assertion)
            ? [assertion[0]!, "x-eoc-otp-source", assertion[1]!]
            : [assertion]),
        ]
      : [],
    headers: { "x-eoc-otp-source": assertion },
    socket: { remoteAddress: "10.1.2.3" },
    ...overrides,
  } as unknown as Request;
  captureOtpBody(request, body);
  return request;
}
function reject(request: Request) {
  expect(() => otpRequestSource(request, config)).toThrow(
    "Service unavailable",
  );
  try {
    otpRequestSource(request, config);
  } catch (error) {
    expect(error).toMatchObject({
      status: 503,
      code: "DEPENDENCY_UNAVAILABLE",
    });
  }
}
afterEach(() => vi.useRealTimers());
describe("signed OTP source assertion", () => {
  it.each(["192.0.2.1", "2001:db8::1", "::1"])(
    "accepts canonical %s without a socket source",
    (source_ip) => {
      expect(
        otpRequestSource(
          incoming(sign({ ...payload(), source_ip }), {
            socket: {} as Request["socket"],
          }),
          config,
        ),
      ).toBe(source_ip);
    },
  );
  it("rejects invalid MACs and signatures under another key", () => {
    reject(incoming(sign(payload(), randomBytes(32))));
    const parts = sign().split(".");
    reject(incoming(`${parts[0]}.${Buffer.alloc(32).toString("base64url")}`));
    reject(incoming(`${parts[0]}.${Buffer.alloc(31).toString("base64url")}`));
  });
  it("enforces the 60 second age and 5 second future bounds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T00:00:00Z"));
    for (const offset of [-60, 5])
      expect(
        otpRequestSource(
          incoming(
            sign({ ...payload(), issued_at: payload().issued_at + offset }),
          ),
          config,
        ),
      ).toBe("192.0.2.1");
    for (const offset of [-61, 6])
      reject(
        incoming(
          sign({ ...payload(), issued_at: payload().issued_at + offset }),
        ),
      );
    for (const issued_at of [1.5, "1", null, -1, Number.MAX_SAFE_INTEGER + 1])
      reject(incoming(sign({ ...payload(), issued_at })));
  });
  it.each([
    undefined,
    "",
    "a".repeat(2049),
    "a.b.c",
    "a=.b",
    "a+.b",
    "a/.b",
    "a .b",
    "AB.b",
  ])("rejects missing, oversized and malformed assertions", (assertion) =>
    reject(incoming(assertion === undefined ? "" : assertion)),
  );
  it.each([
    null,
    [],
    1,
    "payload",
    {},
    { ...payload(), extra: true },
    { ...payload(), version: 2 },
    { ...payload(), body_sha256: "a" },
    { ...payload(), path: { toString: null } },
  ])("rejects closed-payload violations", (value) =>
    reject(incoming(sign(value))),
  );
  it("rejects invalid JSON, duplicate JSON fields and noncanonical base64url", () => {
    for (const raw of [
      "{",
      JSON.stringify(payload()).replace(
        '"version":1',
        '"version":2,"version":1',
      ),
    ]) {
      const encoded = Buffer.from(raw).toString("base64url");
      reject(
        incoming(
          `${encoded}.${createHmac("sha256", key).update(`eoc-otp-source:v1:${encoded}`).digest("base64url")}`,
        ),
      );
    }
    const parts = sign().split(".");
    reject(incoming(`${parts[0]}=.${parts[1]}`));
  });
  it.each([
    "192.168.001.1",
    "192.0.2.1:80",
    "[2001:db8::1]",
    "fe80::1%zone",
    "192.0.2.1, 198.51.100.1",
    " 192.0.2.1",
    "2001:0DB8::1",
    "::ffff:192.0.2.1",
  ])("rejects malformed or noncanonical asserted IP %s", (source_ip) =>
    reject(incoming(sign({ ...payload(), source_ip }))),
  );
  it("rejects duplicate headers including differently cased copies and merged values", () => {
    reject(incoming([sign(), sign()]));
    reject(
      incoming(sign(), {
        rawHeaders: ["X-EOC-OTP-Source", sign(), "x-EoC-oTp-SoUrCe", sign()],
      }),
    );
    reject(incoming(`${sign()}, ${sign()}`));
  });
  it.each(["source_ip", "audience", "method", "path", "body_sha256"])(
    "binds %s against unsigned modification",
    (field) => {
      const parts = sign().split(".");
      const changed = { ...payload(), [field]: "modified" };
      reject(
        incoming(
          `${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${parts[1]}`,
        ),
      );
    },
  );
  it("checks audience, method, path and exact body even under a valid MAC", () => {
    reject(incoming(sign({ ...payload(), audience: "preview" })));
    reject(incoming(sign({ ...payload(), method: "GET" })));
    reject(incoming(sign(), { method: "GET" }));
    for (const originalUrl of [
      "/api/v1/auth/guest/challenge",
      path + "/",
      path + "?target=guest",
    ])
      reject(incoming(sign(), { originalUrl }));
    reject(
      incoming(sign({ ...payload(), path: "/api/v1/auth/guest/challenge" })),
    );
    const changed = incoming();
    captureOtpBody(
      changed,
      Buffer.from(JSON.stringify(JSON.parse(body.toString()))),
    );
    reject(changed);
    const absent = incoming();
    reject({ ...absent } as Request); // No parser verification hook for this request.
  });
  it.each(["10.1.2.3", "127.0.0.1", "192.0.2.1"])(
    "never falls back for peer %s",
    (peer) => {
      const r = incoming("", {
        socket: { remoteAddress: peer } as Request["socket"],
        headers: {
          "x-real-ip": "198.51.100.1",
          "x-forwarded-for": "198.51.100.2",
          "x-source-ip": "198.51.100.3",
        },
      });
      reject(r);
    },
  );
});
