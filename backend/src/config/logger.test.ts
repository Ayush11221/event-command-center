import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { expect, it } from "vitest";
import { createLogger } from "./logger.js";

it("defensively redacts signing keys, assertions and OTP request bodies", () => {
  let logs = "";
  const logger = createLogger(
    new Writable({
      write(chunk, _encoding, done) {
        logs += String(chunk);
        done();
      },
    }),
  );
  const key = randomBytes(32).toString("hex"),
    assertion = "synthetic.signed-source";
  const body = {
    contact: "synthetic@example.test",
    otp: "123456",
    source_ip: "192.0.2.1",
  };
  logger.info(
    {
      OTP_SOURCE_SIGNING_KEY: key,
      sourceSigningKey: key,
      env: { OTP_SOURCE_SIGNING_KEY: key },
      config: { otpAbuse: { sourceSigningKey: key } },
      "X-EOC-OTP-Source": assertion,
      "x-eoc-otp-source": assertion,
      headers: { "X-EOC-OTP-Source": assertion, "x-eoc-otp-source": assertion },
      req: {
        headers: { "x-eoc-otp-source": assertion },
        body,
        rawHeaders: ["x-eoc-otp-source", assertion],
      },
      request: {
        headers: { "x-eoc-otp-source": assertion },
        body,
        rawHeaders: ["x-eoc-otp-source", assertion],
      },
      contact: body.contact,
      otp: body.otp,
      source_ip: body.source_ip,
      assertion,
      body,
    },
    "synthetic privacy test",
  );
  for (const value of [key, assertion, body.contact, body.otp, body.source_ip])
    expect(logs).not.toContain(value);
  expect(logs).toContain("[REDACTED]");
});
