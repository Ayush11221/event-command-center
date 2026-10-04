import { readFileSync } from "node:fs";

const names = [
  "DATABASE_URL",
  "JWT_SECRET",
  "CONTACT_KEY",
  "OTP_KEY",
  "FORECAST_SERVICE_KEY",
  "SMTP_URL",
  "BREVO_API_KEY",
  "METRICS_TOKEN",
] as const;
export function loadSecrets(env: NodeJS.ProcessEnv) {
  for (const name of names) {
    const file = env[`${name}_FILE`];
    if (!file) continue;
    if (env[name]) throw new Error(`Ambiguous ${name} source`);
    try {
      const value = readFileSync(file, "utf8").trim();
      if (name === "SMTP_URL" && !value) continue;
      if (!value || value.length > 8192 || /[\r\n\0]/.test(value))
        throw new Error();
      env[name] = value;
    } catch {
      throw new Error(`Cannot load ${name} secret`);
    }
  }
}
