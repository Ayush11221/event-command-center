import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const PROJECT = "eoc-forecast-demo";
export const DATABASE = "eoc_forecast_demo";
export const ORIGIN = "https://127.0.0.1:9443";
export const EVENT_NAME = "Crowd Forecast Demo — synthetic attendance";
export const PROVENANCE = "SYNTHETIC_LOCAL_DEMO";
export const SECRET_DIR = resolve(ROOT, ".secrets/forecast-demo");
export const ARTIFACT_DIR = resolve(ROOT, ".artifacts/forecast-demo");
export const SECRET_NAMES = [
  "db_password",
  "app_password",
  "migration_url",
  "database_url",
  "jwt_secret",
  "contact_key",
  "otp_key",
  "forecast_key",
  "metrics_token",
  "instance",
];
const execute = promisify(execFile);

export function assertEnvironment(env) {
  const forbidden =
    /^(DOCKER_(HOST|CONTEXT|CONFIG|TLS_VERIFY|CERT_PATH|API_VERSION)|COMPOSE_.*|RAILWAY_.*|.*DATABASE_URL.*|PG(HOST|PORT|USER|PASSWORD|DATABASE|SERVICE|SERVICEFILE|OPTIONS)|FORECAST_SERVICE_.*|JWT_SECRET.*|CONTACT_KEY.*|OTP_KEY.*|SMTP_URL.*|BREVO_.*|NODE_OPTIONS)$/i;
  assert(
    !Object.keys(env).some((key) => forbidden.test(key)),
    "Demo refuses target/credential overrides; use a clean shell.",
  );
}

export function assertContext(context, home) {
  const endpoints = [
    "npipe:////./pipe/dockerDesktopLinuxEngine",
    "npipe:////./pipe/docker_engine",
    "unix:///var/run/docker.sock",
    `unix://${home}/.docker/desktop/docker.sock`,
  ];
  assert(
    ["default", "desktop-linux"].includes(context.Name),
    "Unapproved Docker context.",
  );
  assert(
    endpoints.includes(context.Endpoints?.docker?.Host),
    "Docker endpoint must be a known local socket.",
  );
  assert(!context.Endpoints?.docker?.SkipTLSVerify, "Unsafe Docker context.");
}

export function assertManifest(state) {
  assert.equal(state.version, 1);
  assert.equal(state.project, PROJECT);
  assert.equal(state.database, DATABASE);
  assert.equal(state.origin, ORIGIN);
  assert.equal(state.provenance, PROVENANCE);
  assert(/^[a-f0-9]{32}$/.test(state.instance), "Invalid demo instance.");
  assert(["default", "desktop-linux"].includes(state.context));
  assert(
    ["initialized", "isolated", "seeded", "verified"].includes(state.phase),
  );
  assert.deepEqual(
    Object.keys(state.secretDigests).sort(),
    [...SECRET_NAMES].sort(),
  );
  assert(
    Object.values(state.secretDigests).every((value) =>
      /^[a-f0-9]{64}$/.test(value),
    ),
  );
}
export function credentialDigest(value) {
  return createHash("sha256").update(value).digest("hex");
}
export function assertCredentialDigest(value, expected) {
  assert.equal(
    credentialDigest(value),
    expected,
    "Demo credential file changed; never substitute other credentials.",
  );
}

export function assertDatabaseUrl(value, role) {
  const url = new URL(value);
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "postgres");
  assert.equal(url.port, "5432");
  assert.equal(url.pathname, `/${DATABASE}`);
  assert.equal(url.username, role);
  assert(/^[a-f0-9]{64}$/.test(url.password));
  assert.equal(url.search + url.hash, "");
}

export function assertCompose(config, instance) {
  assert.equal(config.name, PROJECT);
  assert.deepEqual(Object.keys(config.services).sort(), [
    "api",
    "demo",
    "forecast",
    "frontend",
    "migrate",
    "postgres",
  ]);
  assert.deepEqual(Object.keys(config.networks).sort(), ["data", "edge"]);
  assert.equal(config.networks.data.internal, true);
  assert(!config.networks.edge.internal && !config.networks.edge.external);
  assert(!config.networks.data.external);
  for (const [name, service] of Object.entries(config.services)) {
    assert.equal(service.labels?.["org.eoc.forecast-demo"], PROVENANCE);
    assert.equal(service.labels?.["org.eoc.forecast-demo.instance"], instance);
    assert.equal(resolve(service.build.context), resolve(ROOT));
    assert.equal(
      service.build.dockerfile,
      {
        postgres: "docker/postgres.Dockerfile",
        api: "docker/backend.Dockerfile",
        migrate: "docker/backend.Dockerfile",
        demo: "docker/backend.Dockerfile",
        frontend: "docker/frontend.Dockerfile",
        forecast: "docker/forecast.Dockerfile",
      }[name],
    );
    assert(
      !service.env_file &&
        !service.privileged &&
        !service.devices &&
        !service.extra_hosts,
    );
    assert(
      !service.ports?.length ||
        (name === "frontend" &&
          service.ports.length === 1 &&
          service.ports[0].host_ip === "127.0.0.1" &&
          String(service.ports[0].published) === "9443" &&
          service.ports[0].target === 9443),
    );
    if (service.network_mode)
      assert(name === "forecast" && service.network_mode === "service:api");
    else
      assert.deepEqual(
        Object.keys(service.networks).sort(),
        name === "api"
          ? ["data", "edge"]
          : [name === "frontend" ? "edge" : "data"],
      );
    for (const mount of service.volumes ?? []) {
      if (mount.type === "bind")
        assert(
          name === "demo" &&
            resolve(mount.source) === resolve(ROOT, "tests/demo") &&
            mount.target === "/app/tests/demo" &&
            mount.read_only,
        );
      else
        assert(
          mount.type === "volume" &&
            ["postgres_data", "caddy_data", "caddy_config"].includes(
              mount.source,
            ),
        );
    }
  }
  for (const [name, secret] of Object.entries(config.secrets)) {
    assert(SECRET_NAMES.includes(name));
    assert.equal(resolve(secret.file), resolve(SECRET_DIR, name));
    assert(!secret.external && !secret.environment);
  }
  for (const volume of Object.values(config.volumes)) {
    assert(
      volume.name.startsWith(`${PROJECT}_`) &&
        !volume.external &&
        !volume.driver_opts,
    );
    assert.equal(volume.labels?.["org.eoc.forecast-demo.instance"], instance);
  }
  const api = config.services.api.environment;
  assert.equal(api.DATABASE_URL_FILE, "/run/secrets/database_url");
  assert.equal(api.FORECAST_SERVICE_URL, "http://127.0.0.1:8000");
  assert.equal(api.FRONTEND_ORIGIN, ORIGIN);
  assert.equal(api.OTP_SOURCE_MODE, "direct");
  assert.equal(api.EMAIL_TRANSPORT, "smtp");
  assert(
    !api.DATABASE_URL &&
      !api.SMTP_URL &&
      !api.BREVO_API_KEY &&
      !api.RAILWAY_PROJECT_ID,
  );
  assert.equal(config.services.postgres.environment.POSTGRES_DB, DATABASE);
  assert.equal(config.services.frontend.environment.PUBLIC_ORIGIN, ORIGIN);
  assert.equal(config.services.frontend.build.args?.FRONTEND_ORIGIN, ORIGIN);
  assert.equal(
    config.services.frontend.build.args?.FORECAST_DEMO_CONTEXT,
    "synthetic_local",
  );
}

export function assertResource(resource, instance) {
  const labels = resource.Labels ?? resource.Config?.Labels;
  assert.equal(labels?.["com.docker.compose.project"], PROJECT);
  assert.equal(
    labels?.["org.eoc.forecast-demo.instance"],
    instance,
    "Existing resource does not belong to this disposable instance.",
  );
}

export function dockerEnvironment(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) =>
      /^(PATH|SystemRoot|WINDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|ALLUSERSPROFILE|ProgramFiles|ProgramFiles\(x86\)|ProgramW6432|TEMP|TMP|COMSPEC|PATHEXT)$/i.test(
        key,
      ),
    ),
  );
}

export async function docker(args, { input, timeout = 120000 } = {}) {
  const child = execute("docker", args, {
    cwd: ROOT,
    env: dockerEnvironment(),
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (input !== undefined) child.child.stdin.end(input);
  try {
    return (await child).stdout;
  } catch {
    throw new Error(
      "Local Docker command failed; inspect only this demo stack's logs.",
    );
  }
}

export async function localContext(env = process.env) {
  assertEnvironment(env);
  const name = (await docker(["context", "show"])).trim();
  const [context] = JSON.parse(await docker(["context", "inspect", name]));
  assertContext(context, env.HOME ?? env.USERPROFILE);
  const info = JSON.parse(
    await docker(["--context", name, "info", "--format", "{{json .}}"]),
  );
  assert.equal(info.OSType, "linux", "Linux containers required.");
  return name;
}

export async function compose(state, args, options) {
  return docker(
    [
      "--context",
      state.context,
      "compose",
      "--project-name",
      PROJECT,
      "--project-directory",
      ROOT,
      "--env-file",
      resolve(ARTIFACT_DIR, "compose.env"),
      "-f",
      resolve(ROOT, "docker/forecast-demo.yml"),
      ...args,
    ],
    options,
  );
}

export async function validateStack(state, running = false) {
  assertManifest(state);
  assert.equal(await localContext(), state.context, "Docker context changed.");
  const config = JSON.parse(
    await compose(state, ["--profile", "tools", "config", "--format", "json"]),
  );
  assertCompose(config, state.instance);
  for (const kind of ["container", "volume", "network"]) {
    // Match reserved names as well as labels, so unlabeled pre-existing resources cannot be adopted.
    const ids = (
      await docker([
        "--context",
        state.context,
        kind === "container" ? "ps" : kind,
        ...(kind === "container" ? ["-aq"] : ["ls", "-q"]),
        "--filter",
        `name=${PROJECT}${kind === "container" ? "-" : "_"}`,
      ])
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (ids.length)
      for (const resource of JSON.parse(
        await docker(["--context", state.context, kind, "inspect", ...ids]),
      ))
        assertResource(resource, state.instance);
  }
  if (running) {
    for (const name of ["postgres", "api", "forecast", "frontend"]) {
      const id = (await compose(state, ["ps", "-q", name])).trim();
      assert(id, `Demo ${name} is not running.`);
      const [container] = JSON.parse(
        await docker(["--context", state.context, "container", "inspect", id]),
      );
      assertResource(container, state.instance);
      assert(
        container.State.Running && container.State.Health?.Status === "healthy",
        `Demo ${name} is not healthy.`,
      );
      assert(!container.HostConfig.Privileged);
      if (name !== "forecast")
        assert(
          Object.keys(container.NetworkSettings.Networks).every((n) =>
            n.startsWith(`${PROJECT}_`),
          ),
        );
      const expected = config.services[name].environment ?? {};
      const actual = Object.fromEntries(
        container.Config.Env.map((item) => {
          const i = item.indexOf("=");
          return [item.slice(0, i), item.slice(i + 1)];
        }),
      );
      for (const [key, value] of Object.entries(expected))
        assert.equal(
          actual[key],
          String(value),
          "Runtime configuration differs from isolated configuration.",
        );
      assert(
        !actual.DATABASE_URL &&
          !actual.SMTP_URL &&
          !actual.RAILWAY_PROJECT_ID &&
          !actual.FORECAST_SERVICE_TRANSPORT,
      );
    }
  }
  return config;
}
