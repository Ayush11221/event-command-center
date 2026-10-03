import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import pg from "pg";

export function migrationConfig(env, read = readFileSync) {
  if (env.DATABASE_URL !== undefined && env.DATABASE_URL_FILE)
    throw new Error("Ambiguous migration URL source");
  let databaseUrl, password;
  try {
    databaseUrl = env.DATABASE_URL_FILE
      ? read(env.DATABASE_URL_FILE, "utf8").trim()
      : env.DATABASE_URL;
    // PGPASSWORD supplies the existing eoc_app role's password in the
    // Variables-only migration job. The explicit admin URL authenticates DDL.
    password =
      env.PGPASSWORD !== undefined
        ? env.PGPASSWORD
        : read("/run/secrets/app_password", "utf8").trim();
    const url = new URL(databaseUrl);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.password ||
      decodeURIComponent(url.username) === "eoc_app" ||
      /[\r\n\0]/.test(databaseUrl)
    )
      throw new Error();
  } catch {
    throw new Error("Invalid migration credentials");
  }
  if (!/^[a-f0-9]{64}$/.test(password))
    throw new Error("Invalid application password");
  return { databaseUrl, password };
}

export async function migrate(
  env = process.env,
  run = spawnSync,
  client = (url) => new pg.Client({ connectionString: url }),
) {
  const { databaseUrl, password } = migrationConfig(env);
  const commandEnv = { ...env, DATABASE_URL: databaseUrl };
  // Prisma must authenticate only with the migration URL, never the role password.
  delete commandEnv.PGPASSWORD;
  const result = run("npm", ["run", "db:migrate"], {
    stdio: "inherit",
    env: commandEnv,
  });
  if (result.status !== 0) throw new Error("Migration command failed");
  const db = client(databaseUrl);
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('eoc_app_role_provision'))",
    );
    await db.query(
      "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='eoc_app') THEN CREATE ROLE eoc_app LOGIN; END IF; END $$",
    );
    await db.query(
      `ALTER ROLE eoc_app WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`,
    );
    await db.query(
      "REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO eoc_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO eoc_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO eoc_app",
    );
    await db.query('REVOKE ALL ON "_prisma_migrations" FROM eoc_app');
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  migrate().catch(() => {
    process.stderr.write(
      "Migration/provisioning failed; verify credentials and database availability\n",
    );
    process.exitCode = 1;
  });
}
