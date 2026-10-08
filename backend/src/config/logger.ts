import pino, { type DestinationStream } from "pino";

export function createLogger(destination?: DestinationStream) {
  const options = {
    base: undefined,
    redact: {
      paths: [
        "authorization",
        "cookie",
        "password",
        "secret",
        "token",
        "brevoApiKey",
        "BREVO_API_KEY",
        '["api-key"]',
        'headers["api-key"]',
        "config.brevoApiKey",
        "OTP_SOURCE_SIGNING_KEY",
        "sourceSigningKey",
        "config.otpAbuse.sourceSigningKey",
        "otpAbuse.sourceSigningKey",
        "*.OTP_SOURCE_SIGNING_KEY",
        "*.sourceSigningKey",
        '["X-EOC-OTP-Source"]',
        '["x-eoc-otp-source"]',
        'headers["X-EOC-OTP-Source"]',
        'headers["x-eoc-otp-source"]',
        'req.headers["x-eoc-otp-source"]',
        'request.headers["x-eoc-otp-source"]',
        "req.rawHeaders",
        "request.rawHeaders",
        "rawHeaders",
        "contact",
        "otp",
        "assertion",
        "source_ip",
        "rawIp",
        "body",
        "req.body",
        "request.body",
        "headers.authorization",
        "headers.cookie",
      ],
      censor: "[REDACTED]",
    },
  };

  return destination ? pino(options, destination) : pino(options);
}
