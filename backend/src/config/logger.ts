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
        "headers.authorization",
        "headers.cookie",
      ],
      censor: "[REDACTED]",
    },
  };

  return destination ? pino(options, destination) : pino(options);
}
