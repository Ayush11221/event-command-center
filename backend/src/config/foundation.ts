import { Buffer } from "node:buffer";

export interface FoundationConfig {
  databaseUrl: string;
  jwtSecret: Uint8Array;
  contactKey: Buffer;
  otpKey: Buffer;
  cookieSecure: boolean;
  smtpUrl?: string;
  smtpFrom?: string;
  smsGatewayModule?: string;
  forecastServiceUrl?: string;
  forecastServiceKey?: string;
}

function requiredKey(value: string | undefined, name: string): Buffer {
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte hex key`);
  }
  return Buffer.from(value, "hex");
}

export function parseFoundationConfig(
  env: NodeJS.ProcessEnv,
): FoundationConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a PostgreSQL URL");
  }
  if (!["postgresql:", "postgres:"].includes(parsed.protocol)) {
    throw new Error("DATABASE_URL must be a PostgreSQL URL");
  }
  if (env.SMTP_URL && !env.SMTP_FROM) {
    throw new Error("SMTP_FROM is required with SMTP_URL");
  }
  if (env.FORECAST_SERVICE_URL || env.FORECAST_SERVICE_KEY) {
    if (
      !env.FORECAST_SERVICE_URL ||
      !env.FORECAST_SERVICE_KEY ||
      !/^[a-fA-F0-9]{64}$/.test(env.FORECAST_SERVICE_KEY)
    )
      throw new Error(
        "Forecast service requires a URL and independent 32-byte hex key",
      );
    if (
      [env.JWT_SECRET, env.CONTACT_KEY, env.OTP_KEY].some(
        (key) => key?.toLowerCase() === env.FORECAST_SERVICE_KEY!.toLowerCase(),
      )
    )
      throw new Error(
        "Forecast service key must be independent of account/contact/OTP keys",
      );
    let endpoint: URL;
    try {
      endpoint = new URL(env.FORECAST_SERVICE_URL);
    } catch {
      throw new Error("Invalid forecast service URL");
    }
    if (
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== "/" ||
      (endpoint.protocol !== "https:" &&
        !(
          endpoint.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
        ))
    )
      throw new Error(
        "Forecast service requires HTTPS or loopback HTTP, with no URL credentials/query/path",
      );
  }
  return {
    databaseUrl,
    jwtSecret: requiredKey(env.JWT_SECRET, "JWT_SECRET"),
    contactKey: requiredKey(env.CONTACT_KEY, "CONTACT_KEY"),
    otpKey: requiredKey(env.OTP_KEY, "OTP_KEY"),
    cookieSecure: env.NODE_ENV === "production",
    smtpUrl: env.SMTP_URL,
    smtpFrom: env.SMTP_FROM,
    smsGatewayModule: env.SMS_GATEWAY_MODULE,
    forecastServiceUrl: env.FORECAST_SERVICE_URL,
    forecastServiceKey: env.FORECAST_SERVICE_KEY,
  };
}
