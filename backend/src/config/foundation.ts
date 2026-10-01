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
  return {
    databaseUrl,
    jwtSecret: requiredKey(env.JWT_SECRET, "JWT_SECRET"),
    contactKey: requiredKey(env.CONTACT_KEY, "CONTACT_KEY"),
    otpKey: requiredKey(env.OTP_KEY, "OTP_KEY"),
    cookieSecure: env.NODE_ENV === "production",
    smtpUrl: env.SMTP_URL,
    smtpFrom: env.SMTP_FROM,
    smsGatewayModule: env.SMS_GATEWAY_MODULE,
  };
}
