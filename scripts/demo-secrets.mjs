import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const dir = new URL("../.secrets/", import.meta.url);
await mkdir(dir, { recursive: true, mode: 0o700 });
const password = randomBytes(32).toString("hex"),
  app = randomBytes(32).toString("hex");
const files = {
  db_password: password,
  app_password: app,
  migration_url: `postgresql://eoc_migrator:${password}@postgres:5432/eoc_demo`,
  database_url: `postgresql://eoc_app:${app}@postgres:5432/eoc_demo`,
  smtp_url: "",
  ...Object.fromEntries(
    [
      "jwt_secret",
      "contact_key",
      "otp_key",
      "forecast_key",
      "metrics_token",
    ].map((name) => [name, randomBytes(32).toString("hex")]),
  ),
};
for (const [name, value] of Object.entries(files))
  await writeFile(new URL(name, dir), value + "\n", {
    flag: "wx",
    mode: 0o600,
  });
console.log(
  "Demo secrets created without overwriting existing files. On Windows restrict .secrets ACL to its owner. Empty SMTP disables submission.",
);
