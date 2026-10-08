import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { defaultOtpAbuseConfig } from "../../config/otp-abuse.js";
import { canonicalOtpIp, otpRequestSource } from "./otp-source.js";

function incoming(peer: string, headers: Record<string, string> = {}): Request {
  return {
    socket: { remoteAddress: peer },
    header: (name: string) => headers[name],
  } as unknown as Request;
}
describe("trusted OTP source", () => {
  const forwarded = {
    ...defaultOtpAbuseConfig,
    sourceMode: "forwarded" as const,
    trustedProxyCidrs: ["10.1.2.3/32"],
  };
  const railway = { ...forwarded, sourceMode: "railway" as const };
  it("ignores spoofed headers in direct mode", () => {
    expect(
      otpRequestSource(
        incoming("::ffff:192.0.2.4", {
          "x-forwarded-for": "198.51.100.1",
          "x-real-ip": "198.51.100.2",
        }),
      ),
    ).toBe("192.0.2.4");
  });
  it.each([forwarded, railway])(
    "fails closed for an untrusted peer",
    (config) => {
      expect(() =>
        otpRequestSource(
          incoming("192.0.2.4", {
            "x-forwarded-for": "198.51.100.1",
            "x-real-ip": "198.51.100.1",
          }),
          config,
        ),
      ).toThrow("Service unavailable");
    },
  );
  it("selects the nearest untrusted hop rather than a spoofed prefix", () => {
    expect(
      otpRequestSource(
        incoming("::ffff:10.1.2.3", {
          "x-forwarded-for": "203.0.113.1, 198.51.100.1",
        }),
        forwarded,
      ),
    ).toBe("198.51.100.1");
    expect(
      otpRequestSource(
        incoming("10.1.2.3", { "x-forwarded-for": "198.51.100.1, 10.1.2.3" }),
        forwarded,
      ),
    ).toBe("198.51.100.1");
  });
  it("uses Railway's single client header only through the trusted private peer", () => {
    expect(
      otpRequestSource(
        incoming("10.1.2.3", {
          "x-real-ip": "2001:db8::1",
          "x-forwarded-for": "203.0.113.1",
        }),
        railway,
      ),
    ).toBe("2001:db8::1");
  });
  it.each([
    "",
    "unknown",
    "192.0.2.1:80",
    "192.0.2.1, 198.51.100.1",
    "fe80::1%zone",
  ])("rejects invalid Railway metadata %s", (value) => {
    expect(() =>
      otpRequestSource(incoming("10.1.2.3", { "x-real-ip": value }), railway),
    ).toThrow("Service unavailable");
  });
  it("rejects absent or excessive forwarded chains", () => {
    for (const value of ["", Array(17).fill("192.0.2.1").join(",")])
      expect(() =>
        otpRequestSource(
          incoming("10.1.2.3", { "x-forwarded-for": value }),
          forwarded,
        ),
      ).toThrow("Service unavailable");
  });
  it("canonicalizes equivalent IP representations", () => {
    expect(canonicalOtpIp("2001:0db8:0:0:0:0:0:1")).toBe(
      canonicalOtpIp("2001:db8::1"),
    );
    expect(canonicalOtpIp("::ffff:c000:204")).toBe(canonicalOtpIp("192.0.2.4"));
  });
});
