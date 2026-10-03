import assert from "node:assert/strict";
import { test } from "node:test";
import { migrationConfig, migrate } from "../../docker/migrate.mjs";
const url = "postgresql://migrator:synthetic-only@localhost/demo";
const password = "a".repeat(64);
test("direct Railway Variables and mounted Compose secrets preserve separate credentials", () => {
  assert.deepEqual(
    migrationConfig({ DATABASE_URL: url, PGPASSWORD: password }),
    { databaseUrl: url, password },
  );
  assert.deepEqual(
    migrationConfig(
      { DATABASE_URL_FILE: "/run/secrets/migration_url" },
      (path) => (path.endsWith("migration_url") ? url : password),
    ),
    { databaseUrl: url, password },
  );
});
test("unsafe, missing, ambiguous and runtime-role migration credentials fail without leaking", () => {
  for (const env of [
    {},
    { DATABASE_URL: url },
    { DATABASE_URL: url, PGPASSWORD: "unsafe'password" },
    {
      DATABASE_URL: "postgresql://eoc_app:secret@localhost/demo",
      PGPASSWORD: password,
    },
    { DATABASE_URL: "https://secret@example.invalid", PGPASSWORD: password },
    {
      DATABASE_URL: url,
      DATABASE_URL_FILE: "private/path",
      PGPASSWORD: password,
    },
  ]) {
    assert.throws(
      () =>
        migrationConfig(env, () => {
          throw new Error("secret-content");
        }),
      (error) =>
        !/secret-content|synthetic-only|private\/path|unsafe'/.test(
          error.message,
        ),
    );
  }
});
test("failed Prisma execution never provisions roles", async () => {
  await assert.rejects(
    () =>
      migrate(
        { DATABASE_URL: url, PGPASSWORD: password },
        () => ({ status: 1 }),
        () => {
          throw new Error("must not connect");
        },
      ),
    /Migration command failed/,
  );
});
test("role grant failure rolls back and closes; role password does not enter migration subprocess", async () => {
  const queries = [];
  let closed = false;
  await assert.rejects(
    () =>
      migrate(
        { DATABASE_URL: url, PGPASSWORD: password },
        (_cmd, _args, options) => {
          assert.equal(options.env.DATABASE_URL, url);
          assert.equal(options.env.PGPASSWORD, undefined);
          return { status: 0 };
        },
        () => ({
          connect: async () => {},
          query: async (sql) => {
            queries.push(sql);
            if (sql.startsWith("REVOKE CREATE"))
              throw new Error("simulated grant failure");
          },
          end: async () => {
            closed = true;
          },
        }),
      ),
    /simulated grant failure/,
  );
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.ok(!queries.includes("COMMIT"));
  assert.equal(closed, true);
});
