import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  assertContext,
  assertEnvironment,
  assertDatabaseUrl,
  assertManifest,
  assertResource,
  assertCompose,
  assertCredentialDigest,
  credentialDigest,
  SECRET_NAMES,
  DATABASE,
  PROJECT,
  ORIGIN,
  PROVENANCE,
  ROOT,
  SECRET_DIR,
} from "./isolation.mjs";
import { isolation, seed } from "./ledger.mjs";
import { parseCommand } from "./forecast-demo.mjs";

const instance = "a".repeat(32);
test("only explicit local sockets and contexts are allowed", () => {
  assertContext({
    Name: "desktop-linux",
    Endpoints: {
      docker: { Host: "npipe:////./pipe/dockerDesktopLinuxEngine" },
    },
  });
  for (const Host of [
    "tcp://127.0.0.1:2375",
    "tcp://production:2376",
    "ssh://server",
    "unix:///tmp/tunnel.sock",
    "npipe:////remote/pipe/docker_engine",
  ])
    assert.throws(() =>
      assertContext({ Name: "default", Endpoints: { docker: { Host } } }),
    );
  assert.throws(() =>
    assertContext({
      Name: "production",
      Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } },
    }),
  );
  assert.throws(() =>
    assertContext({
      Name: "default",
      Endpoints: {
        docker: { Host: "unix:///var/run/docker.sock", SkipTLSVerify: true },
      },
    }),
  );
});
test("target and credential overrides are rejected before initialization", () => {
  for (const key of [
    "DATABASE_URL",
    "TEST_DATABASE_URL",
    "DATABASE_URL_FILE",
    "PGHOST",
    "PGPASSWORD",
    "RAILWAY_PROJECT_ID",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_CONFIG",
    "COMPOSE_FILE",
    "FORECAST_SERVICE_URL",
    "JWT_SECRET_FILE",
    "SMTP_URL",
  ])
    assert.throws(() => assertEnvironment({ [key]: "sensitive-value" }));
  assertEnvironment({ PATH: "tools", USERPROFILE: "local" });
});
test("database URL cannot point at production, host ports, tunnels or other databases", () => {
  const good = `postgresql://eoc_migrator:${"b".repeat(64)}@postgres:5432/${DATABASE}`;
  assertDatabaseUrl(good, "eoc_migrator");
  for (const value of [
    good.replace("postgres:5432", "127.0.0.1:55432"),
    good.replace("postgres:5432", "postgres.railway.internal:5432"),
    good.replace(DATABASE, "production"),
    good + "?sslmode=disable",
    good.replace("eoc_migrator:", "eoc_app:"),
  ])
    assert.throws(() => assertDatabaseUrl(value, "eoc_migrator"));
});
test("commands never accept arbitrary URLs or existing event IDs", () => {
  assert.equal(parseCommand(["seed"]), "seed");
  for (const args of [
    ["seed", "14a32a93-1bfe-4a8c-91cf-7315dff8c855"],
    ["seed", "--database-url=x"],
    ["start", "--context=production"],
    ["unknown"],
    [],
  ])
    assert.throws(() => parseCommand(args));
});
test("foreign resources and provenance are not adopted", () => {
  const state = {
    version: 1,
    project: PROJECT,
    database: DATABASE,
    origin: ORIGIN,
    provenance: PROVENANCE,
    instance,
    context: "desktop-linux",
    phase: "initialized",
    secretDigests: Object.fromEntries(
      SECRET_NAMES.map((name) => [name, "b".repeat(64)]),
    ),
  };
  assertManifest(state);
  assert.throws(() => assertManifest({ ...state, project: "production" }));
  assert.throws(() => assertManifest({ ...state, provenance: "LIVE" }));
  const resource = {
    Labels: {
      "com.docker.compose.project": PROJECT,
      "org.eoc.forecast-demo.instance": instance,
    },
  };
  assertResource(resource, instance);
  assert.throws(() => assertResource(resource, "b".repeat(32)));
  assert.throws(() =>
    assertResource(
      { Labels: { "com.docker.compose.project": "charming-spirit" } },
      instance,
    ),
  );
});
function configuration() {
  const services = Object.fromEntries(
    ["api", "demo", "forecast", "frontend", "migrate", "postgres"].map(
      (name) => [
        name,
        {
          labels: {
            "org.eoc.forecast-demo": PROVENANCE,
            "org.eoc.forecast-demo.instance": instance,
          },
          build: {
            context: ROOT,
            dockerfile: {
              postgres: "docker/postgres.Dockerfile",
              api: "docker/backend.Dockerfile",
              migrate: "docker/backend.Dockerfile",
              demo: "docker/backend.Dockerfile",
              frontend: "docker/frontend.Dockerfile",
              forecast: "docker/forecast.Dockerfile",
            }[name],
          },
          networks: { data: {} },
        },
      ],
    ),
  );
  services.api.environment = {
    DATABASE_URL_FILE: "/run/secrets/database_url",
    FORECAST_SERVICE_URL: "http://127.0.0.1:8000",
    FRONTEND_ORIGIN: ORIGIN,
    OTP_SOURCE_MODE: "direct",
    EMAIL_TRANSPORT: "smtp",
  };
  services.postgres.environment = { POSTGRES_DB: DATABASE };
  services.frontend.environment = { PUBLIC_ORIGIN: ORIGIN };
  services.frontend.networks = { edge: {} };
  services.api.networks = { data: {}, edge: {} };
  services.frontend.build.args = {
    FRONTEND_ORIGIN: ORIGIN,
    FORECAST_DEMO_CONTEXT: "synthetic_local",
  };
  services.frontend.ports = [
    { host_ip: "127.0.0.1", published: "9443", target: 9443 },
  ];
  return {
    name: PROJECT,
    services,
    networks: { data: { internal: true }, edge: {} },
    volumes: {
      postgres_data: {
        name: `${PROJECT}_postgres_data`,
        labels: { "org.eoc.forecast-demo.instance": instance },
      },
    },
    secrets: { database_url: { file: resolve(SECRET_DIR, "database_url") } },
  };
}
test("public ports, external networks, foreign mounts and unsafe service configuration fail closed", () => {
  assertCompose(configuration(), instance);
  for (const mutate of [
    (c) => (c.services.frontend.ports[0].host_ip = "0.0.0.0"),
    (c) => (c.services.postgres.ports = [{ target: 5432 }]),
    (c) => (c.networks.data.internal = false),
    (c) => (c.services.api.privileged = true),
    (c) => (c.services.api.build.context = "/production"),
    (c) => (c.services.api.build.dockerfile = "docker/foreign.Dockerfile"),
    (c) =>
      (c.services.api.environment.FORECAST_SERVICE_URL = "https://production"),
    (c) =>
      (c.secrets.database_url.file = resolve(ROOT, ".secrets/database_url")),
    (c) =>
      (c.services.api.volumes = [
        { type: "bind", source: "/production", target: "/app" },
      ]),
    (c) => (c.volumes.postgres_data.external = true),
  ]) {
    const config = configuration();
    mutate(config);
    assert.throws(() => assertCompose(config, instance));
  }
});
function database({
  database = DATABASE,
  role = "eoc_migrator",
  replication = "origin",
  enabled = "O",
  existing = 0,
  marker = null,
} = {}) {
  let queries = 0,
    writes = 0;
  const db = {
    $queryRaw: async () =>
      ++queries === 1
        ? [{ database, role, replication_role: replication, marker }]
        : Array.from({ length: 5 }, () => ({ tgenabled: enabled })),
    $executeRaw: async () => {},
    $executeRawUnsafe: async () => {
      writes++;
    },
    user: {
      count: async () => existing,
      create: async () => {
        writes++;
      },
    },
    event: { count: async () => existing },
    attendanceTransition: { count: async () => 0 },
    scanDecision: { count: async () => 0 },
    forecastRun: { count: async () => 0 },
    registration: { count: async () => 0 },
  };
  db.$transaction = (fn) => fn(db);
  return { db, writes: () => writes };
}
test("wrong database/role, disabled triggers, copied marker and existing records reject before fixture writes", async () => {
  for (const options of [
    { database: "production" },
    { role: "eoc_app" },
    { replication: "replica" },
    { enabled: "D" },
    { existing: 1 },
    { marker: `${PROVENANCE}:foreign` },
  ]) {
    const f = database(options);
    await assert.rejects(seed(f.db, instance, Buffer.alloc(32)));
    assert.equal(f.writes(), 0);
  }
  const f = database();
  assert.equal((await isolation(f.db, instance, true)).counts.events, 0);
  assert.equal(f.writes(), 0);
});
test("substituted credentials are refused before Docker or database operations", () => {
  const value = "locally-generated-test-credential\n";
  assertCredentialDigest(value, credentialDigest(value));
  assert.throws(() =>
    assertCredentialDigest(
      "copied-or-edited-credential\n",
      credentialDigest(value),
    ),
  );
});
