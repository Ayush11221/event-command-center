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
        "headers.authorization",
        "headers.cookie",
      ],
      censor: "[REDACTED]",
    },
  };

  return destination ? pino(options, destination) : pino(options);
}
