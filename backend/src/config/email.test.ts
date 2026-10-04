import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { expect, it } from "vitest";
import { parseFoundationConfig } from "./foundation.js";
import { createLogger } from "./logger.js";

const env = {
  DATABASE_URL: "postgresql://test@localhost/test",
  JWT_SECRET: "a".repeat(64),
  CONTACT_KEY: "b".repeat(64),
  OTP_KEY: "c".repeat(64),
};
const brevo = {
  ...env,
  EMAIL_TRANSPORT: "brevo_api",
  BREVO_API_URL: "https://api.brevo.com/v3/smtp/email",
  BREVO_API_KEY: `synthetic-${randomUUID()}`,
  SMTP_FROM: "platform@example.invalid",
};
it("defaults explicitly to SMTP even in production and ignores unselected Brevo inputs", () => {
  const config = parseFoundationConfig({
    ...env,
    NODE_ENV: "production",
    BREVO_API_KEY: "unused",
  });
  expect(config.emailTransport).toBe("smtp");
  expect(config.brevoApiKey).toBeUndefined();
  expect(
    parseFoundationConfig({ ...env, EMAIL_TRANSPORT: "smtp" }).emailTransport,
  ).toBe("smtp");
});
it("selects Brevo with independently configured endpoint and platform sender", () => {
  const config = parseFoundationConfig(brevo);
  expect(config.emailTransport).toBe("brevo_api");
  expect(config.brevoApiUrl).toBe(brevo.BREVO_API_URL);
  expect(config.smtpFrom).toBe(brevo.SMTP_FROM);
  expect(Boolean(config.brevoApiKey)).toBe(true);
  expect(config.smtpUrl).toBeUndefined();
});
it.each(["", "auto", "BREVO_API"])(
  "rejects unsupported transport %s",
  (EMAIL_TRANSPORT) => {
    expect(() => parseFoundationConfig({ ...env, EMAIL_TRANSPORT })).toThrow(
      "EMAIL_TRANSPORT must be smtp or brevo_api",
    );
  },
);
it.each([undefined, "", "bad\r\nheader", " ", "x".repeat(8193)])(
  "rejects missing or unsafe API key without exposing it",
  (BREVO_API_KEY) => {
    expect(() => parseFoundationConfig({ ...brevo, BREVO_API_KEY })).toThrow(
      "BREVO_API_KEY is required and must be a valid HTTP header value",
    );
  },
);
it.each([
  undefined,
  "",
  "not a url",
  "http://api.brevo.com/v3/smtp/email",
  "https://user:password@api.brevo.com/v3/smtp/email",
  "https://api.brevo.com/v3/smtp/email?key=synthetic",
  "https://api.brevo.com/v3/smtp/email#fragment",
])(
  "rejects missing or unsafe endpoint without exposing it",
  (BREVO_API_URL) => {
    expect(() => parseFoundationConfig({ ...brevo, BREVO_API_URL })).toThrow(
      /BREVO_API_URL must/,
    );
  },
);
it.each([
  undefined,
  "",
  "Name <sender@example.invalid>",
  "sender@example.invalid\r\nBcc: other@example.invalid",
])("requires a configured platform email address", (SMTP_FROM) => {
  expect(() => parseFoundationConfig({ ...brevo, SMTP_FROM })).toThrow(
    "SMTP_FROM must be the verified platform email address for Brevo",
  );
});
it("preserves SMTP missing-sender validation", () => {
  expect(() =>
    parseFoundationConfig({ ...env, SMTP_URL: "smtp://127.0.0.1:1025" }),
  ).toThrow("SMTP_FROM is required with SMTP_URL");
});
it("redacts API key fields in structured logs", () => {
  let output = "";
  const key = `synthetic-${randomUUID()}`;
  const logger = createLogger(
    new Writable({
      write(chunk, _encoding, done) {
        output += chunk.toString();
        done();
      },
    }),
  );
  logger.info(
    {
      brevoApiKey: key,
      BREVO_API_KEY: key,
      "api-key": key,
      headers: { "api-key": key },
      config: { brevoApiKey: key },
    },
    "synthetic redaction test",
  );
  expect(output.includes(key)).toBe(false);
  const row = JSON.parse(output);
  expect(row.headers["api-key"]).toBe("[REDACTED]");
  expect(row.config.brevoApiKey).toBe("[REDACTED]");
});
