import { describe, expect, it } from "vitest";
import { defaultOtpAbuseConfig, parseOtpAbuseConfig } from "./otp-abuse.js";
import { parseFoundationConfig } from "./foundation.js";

describe("OTP abuse configuration", () => {
  const signed = {
    OTP_SOURCE_MODE: "signed_gateway",
    OTP_SOURCE_SIGNING_KEY: "d".repeat(64),
  };
  it("requires an independent signing key and keeps every budget unchanged", () => {
    expect(parseOtpAbuseConfig(signed)).toEqual({
      ...defaultOtpAbuseConfig,
      sourceMode: "signed_gateway",
      sourceSigningKey: Buffer.from(signed.OTP_SOURCE_SIGNING_KEY, "hex"),
    });
    expect(() =>
      parseOtpAbuseConfig({ OTP_SOURCE_MODE: "signed_gateway" }),
    ).toThrow("OTP_SOURCE_SIGNING_KEY");
  });
  it.each([
    "",
    "d".repeat(63),
    "d".repeat(65),
    "D".repeat(64),
    "g".repeat(64),
    " d".repeat(32),
    "d".repeat(64) + "\n",
  ])("rejects malformed signing material", (OTP_SOURCE_SIGNING_KEY) => {
    expect(() =>
      parseOtpAbuseConfig({ ...signed, OTP_SOURCE_SIGNING_KEY }),
    ).toThrow("OTP_SOURCE_SIGNING_KEY");
  });
  it.each(["", "127.0.0.1/32", "10.0.0.0/8", "100.0.0.0/8", "0.0.0.0/0"])(
    "rejects all proxy configuration in signed mode",
    (OTP_TRUSTED_PROXY_CIDRS) => {
      expect(() =>
        parseOtpAbuseConfig({ ...signed, OTP_TRUSTED_PROXY_CIDRS }),
      ).toThrow("OTP_TRUSTED_PROXY_CIDRS");
    },
  );
  it.each(["JWT_SECRET", "CONTACT_KEY", "OTP_KEY", "FORECAST_SERVICE_KEY"])(
    "rejects reuse of %s case-insensitively",
    (name) => {
      expect(() =>
        parseFoundationConfig({
          ...signed,
          DATABASE_URL: "postgresql://test@localhost/test",
          JWT_SECRET: "a".repeat(64),
          CONTACT_KEY: "b".repeat(64),
          OTP_KEY: "c".repeat(64),
          [name]: signed.OTP_SOURCE_SIGNING_KEY.toUpperCase(),
        }),
      ).toThrow("independent");
    },
  );
  it("keeps both proxy modes and their trust requirements", () => {
    for (const OTP_SOURCE_MODE of ["forwarded", "railway"]) {
      expect(() => parseOtpAbuseConfig({ OTP_SOURCE_MODE })).toThrow(
        "OTP_TRUSTED_PROXY_CIDRS",
      );
      expect(
        parseOtpAbuseConfig({
          OTP_SOURCE_MODE,
          OTP_TRUSTED_PROXY_CIDRS: "127.0.0.1/32",
        }).sourceMode,
      ).toBe(OTP_SOURCE_MODE);
    }
  });
  it("uses conservative shared defaults and requires an explicit production source mode", () => {
    expect(parseOtpAbuseConfig({})).toEqual(defaultOtpAbuseConfig);
    expect(() => parseOtpAbuseConfig({ NODE_ENV: "production" })).toThrow(
      "OTP_SOURCE_MODE",
    );
    expect(
      parseOtpAbuseConfig({ NODE_ENV: "production", OTP_SOURCE_MODE: "direct" })
        .sourceMode,
    ).toBe("direct");
  });
  it("accepts independent budgets and explicit trusted proxy CIDRs", () => {
    expect(
      parseOtpAbuseConfig({
        OTP_CONTACT_LIMIT: "12",
        OTP_CONTACT_WINDOW_SECONDS: "7200",
        OTP_SOURCE_LIMIT: "150",
        OTP_SOURCE_WINDOW_SECONDS: "900",
        OTP_PROVIDER_LIMIT: "700",
        OTP_PROVIDER_WINDOW_SECONDS: "86400",
        OTP_SOURCE_MODE: "railway",
        OTP_TRUSTED_PROXY_CIDRS: "10.1.2.3/32, fd00::1/128",
      }),
    ).toEqual({
      contact: { limit: 12, windowSeconds: 7200 },
      source: { limit: 150, windowSeconds: 900 },
      provider: { limit: 700, windowSeconds: 86400 },
      sourceMode: "railway",
      trustedProxyCidrs: ["10.1.2.3/32", "fd00::1/128"],
    });
  });
  it.each(["CONTACT", "SOURCE", "PROVIDER"])(
    "rejects malformed or unsafe %s budgets",
    (category) => {
      for (const value of [
        "",
        "0",
        "-1",
        "1.5",
        "NaN",
        "Infinity",
        "1e3",
        " 10",
        "1000001",
      ])
        expect(() =>
          parseOtpAbuseConfig({ [`OTP_${category}_LIMIT`]: value }),
        ).toThrow(`OTP_${category}_LIMIT`);
      for (const value of ["", "0", "-1", "1.5", "86401"])
        expect(() =>
          parseOtpAbuseConfig({ [`OTP_${category}_WINDOW_SECONDS`]: value }),
        ).toThrow(`OTP_${category}_WINDOW_SECONDS`);
    },
  );
  it.each(["true", "1", "auto", ""])(
    "rejects ambiguous source mode %s",
    (OTP_SOURCE_MODE) => {
      expect(() => parseOtpAbuseConfig({ OTP_SOURCE_MODE })).toThrow(
        "OTP_SOURCE_MODE",
      );
    },
  );
  it.each([
    "",
    "private_ranges",
    "0.0.0.0/0",
    "::/0",
    "10.0.0.0/33",
    "::1/129",
    "10.0.0.1",
    "10.0.0.1/32,",
    "invalid/32",
  ])("rejects missing or unsafe trust input %s", (OTP_TRUSTED_PROXY_CIDRS) => {
    expect(() =>
      parseOtpAbuseConfig({
        OTP_SOURCE_MODE: "forwarded",
        OTP_TRUSTED_PROXY_CIDRS,
      }),
    ).toThrow("OTP_TRUSTED_PROXY_CIDRS");
  });
  it("rejects unused trust configuration", () => {
    expect(() =>
      parseOtpAbuseConfig({ OTP_TRUSTED_PROXY_CIDRS: "127.0.0.1/32" }),
    ).toThrow("proxy source mode");
  });
});
