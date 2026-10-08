import { Buffer } from "node:buffer";
import { parseOtpAbuseConfig, type OtpAbuseConfig } from "./otp-abuse.js";

export interface FoundationConfig {
  databaseUrl: string;
  jwtSecret: Uint8Array;
  contactKey: Buffer;
  otpKey: Buffer;
  cookieSecure: boolean;
  smtpUrl?: string;
  smtpFrom?: string;
  emailTransport?: "smtp" | "brevo_api";
  brevoApiUrl?: string;
  brevoApiKey?: string;
  smsGatewayModule?: string;
  forecastServiceUrl?: string;
  forecastServiceKey?: string;
  otpAbuse?: OtpAbuseConfig;
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
  const otpAbuse = parseOtpAbuseConfig(env);
  if (
    otpAbuse.sourceSigningKey &&
    [
      env.JWT_SECRET,
      env.CONTACT_KEY,
      env.OTP_KEY,
      env.FORECAST_SERVICE_KEY,
    ].some((key) => key?.toLowerCase() === env.OTP_SOURCE_SIGNING_KEY)
  )
    throw new Error(
      "OTP source signing key must be independent of auth/contact/OTP/forecast keys",
    );
  if (env.SMTP_URL && !env.SMTP_FROM) {
    throw new Error("SMTP_FROM is required with SMTP_URL");
  }
  const emailTransport = env.EMAIL_TRANSPORT ?? "smtp";
  if (emailTransport !== "smtp" && emailTransport !== "brevo_api")
    throw new Error("EMAIL_TRANSPORT must be smtp or brevo_api");
  if (emailTransport === "brevo_api") {
    if (!env.BREVO_API_KEY || !/^[\x21-\x7e]{1,8192}$/.test(env.BREVO_API_KEY))
      throw new Error(
        "BREVO_API_KEY is required and must be a valid HTTP header value",
      );
    let emailEndpoint: URL;
    try {
      emailEndpoint = new URL(env.BREVO_API_URL ?? "");
    } catch {
      throw new Error("BREVO_API_URL must be an HTTPS endpoint");
    }
    if (
      emailEndpoint.protocol !== "https:" ||
      emailEndpoint.username ||
      emailEndpoint.password ||
      emailEndpoint.search ||
      emailEndpoint.hash
    )
      throw new Error(
        "BREVO_API_URL must use HTTPS without credentials, query or fragment",
      );
    if (
      !env.SMTP_FROM ||
      !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(env.SMTP_FROM)
    )
      throw new Error(
        "SMTP_FROM must be the verified platform email address for Brevo",
      );
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
    emailTransport,
    brevoApiUrl: emailTransport === "brevo_api" ? env.BREVO_API_URL : undefined,
    brevoApiKey: emailTransport === "brevo_api" ? env.BREVO_API_KEY : undefined,
    smsGatewayModule: env.SMS_GATEWAY_MODULE,
    forecastServiceUrl: env.FORECAST_SERVICE_URL,
    forecastServiceKey: env.FORECAST_SERVICE_KEY,
    otpAbuse,
  };
}
