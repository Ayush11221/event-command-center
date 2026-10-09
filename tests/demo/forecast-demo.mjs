import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, lstat, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ARTIFACT_DIR,
  SECRET_DIR,
  SECRET_NAMES,
  ROOT,
  PROJECT,
  DATABASE,
  ORIGIN,
  PROVENANCE,
  assertManifest,
  assertDatabaseUrl,
  assertCredentialDigest,
  credentialDigest,
  localContext,
  compose,
  docker,
  validateStack,
} from "./isolation.mjs";

const manifestFile = resolve(ARTIFACT_DIR, "manifest.json");
export function parseCommand(args) {
  assert(
    args.length === 1 &&
      [
        "init",
        "start",
        "isolation",
        "seed",
        "verify",
        "browser",
        "present",
        "stop",
        "cleanup",
      ].includes(args[0]),
    "Only documented commands are accepted; no targets, URLs or event IDs.",
  );
  return args[0];
}
async function regular(path) {
  assert(
    !(await lstat(path)).isSymbolicLink(),
    "Demo paths must not be symbolic links.",
  );
}
async function privateDirectory(path) {
  const parent = resolve(path, "..");
  await mkdir(parent, { recursive: true });
  await regular(parent);
  await mkdir(path, { mode: 0o700 });
  if (process.platform === "win32") {
    const principal = `${process.env.USERDOMAIN}\\${process.env.USERNAME}:(OI)(CI)F`;
    await promisify(execFile)("icacls", [
      path,
      "/inheritance:r",
      "/grant:r",
      principal,
    ]);
  }
}
async function save(state) {
  await writeFile(manifestFile, JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
}
export async function loadState() {
  await regular(SECRET_DIR);
  await regular(ARTIFACT_DIR);
  await regular(resolve(SECRET_DIR, ".."));
  await regular(resolve(ARTIFACT_DIR, ".."));
  await regular(manifestFile);
  const state = JSON.parse(await readFile(manifestFile, "utf8"));
  assertManifest(state);
  for (const name of SECRET_NAMES) {
    await regular(resolve(SECRET_DIR, name));
    assertCredentialDigest(
      await readFile(resolve(SECRET_DIR, name)),
      state.secretDigests[name],
    );
  }
  assert.equal(
    (await readFile(resolve(SECRET_DIR, "instance"), "utf8")).trim(),
    state.instance,
  );
  assertDatabaseUrl(
    (await readFile(resolve(SECRET_DIR, "migration_url"), "utf8")).trim(),
    "eoc_migrator",
  );
  assertDatabaseUrl(
    (await readFile(resolve(SECRET_DIR, "database_url"), "utf8")).trim(),
    "eoc_app",
  );
  assert.equal(
    await readFile(resolve(ARTIFACT_DIR, "compose.env"), "utf8"),
    `FORECAST_DEMO_INSTANCE=${state.instance}\n`,
  );
  return state;
}
async function init() {
  const context = await localContext();
  for (const [kind, args, prefix] of [
    ["containers", ["ps", "-aq"], `${PROJECT}-`],
    ["volumes", ["volume", "ls", "-q"], `${PROJECT}_`],
    ["networks", ["network", "ls", "-q"], `${PROJECT}_`],
  ]) {
    assert.equal(
      (
        await docker([
          "--context",
          context,
          ...args,
          "--filter",
          `name=${prefix}`,
        ])
      ).trim(),
      "",
      `Existing demo ${kind}; initialization refuses adoption.`,
    );
  }
  await privateDirectory(SECRET_DIR);
  await privateDirectory(ARTIFACT_DIR);
  const state = {
    version: 1,
    project: PROJECT,
    database: DATABASE,
    origin: ORIGIN,
    provenance: PROVENANCE,
    instance: randomBytes(16).toString("hex"),
    context,
    phase: "initialized",
  };
  const values = Object.fromEntries(
    SECRET_NAMES.map((name) => [name, randomBytes(32).toString("hex")]),
  );
  values.instance = state.instance;
  values.migration_url = `postgresql://eoc_migrator:${values.db_password}@postgres:5432/${DATABASE}`;
  values.database_url = `postgresql://eoc_app:${values.app_password}@postgres:5432/${DATABASE}`;
  state.secretDigests = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      credentialDigest(value + "\n"),
    ]),
  );
  for (const [name, value] of Object.entries(values))
    await writeFile(resolve(SECRET_DIR, name), value + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  await writeFile(
    resolve(ARTIFACT_DIR, "compose.env"),
    `FORECAST_DEMO_INSTANCE=${state.instance}\n`,
    { flag: "wx", mode: 0o600 },
  );
  await save(state);
  await validateStack(state);
  console.log(
    "Initialized new local-only credentials and synthetic provenance. Nothing seeded.",
  );
}
export async function worker(state, action) {
  await validateStack(state, true);
  const request = JSON.stringify({
    action,
    instance: state.instance,
    fixture: state.fixture ?? null,
  });
  // Request contains only provenance and fixture identifiers, never credentials.
  const output = await compose(
    state,
    [
      "run",
      "--rm",
      "-T",
      "--interactive=false",
      "--no-deps",
      "demo",
      "node",
      "tests/demo/fixture.mjs",
      request,
    ],
    { timeout: 120000 },
  );
  const result = JSON.parse(output);
  assert.equal(result.ok, true, "Isolated worker refused the operation.");
  return result;
}
async function correlate(state, correlations) {
  const result = {};
  for (const service of ["api", "forecast"]) {
    const log = await compose(state, [
      "logs",
      "--no-color",
      "--no-log-prefix",
      service,
    ]);
    result[service] = correlations.map((id) => {
      const matched = log.split("\n").some((line) => {
        const start = line.indexOf("{");
        try {
          const row = JSON.parse(line.slice(start));
          return (
            row.correlation_id === id &&
            (service === "api" ? row.status_code : row.status) === 200
          );
        } catch {
          return false;
        }
      });
      assert(matched, "Missing successful correlated application log.");
      return { correlation_id: id, status: 200 };
    });
  }
  return result;
}
export async function main(args = process.argv.slice(2)) {
  const command = parseCommand(args);
  if (command === "init") return init();
  const state = await loadState();
  await validateStack(state);
  if (command === "start") {
    await compose(
      state,
      ["up", "--build", "-d", "--wait", "--wait-timeout", "180"],
      { timeout: 1200000 },
    );
    await validateStack(state, true);
    console.log("Dedicated local stack healthy. Run isolation before seed.");
  } else if (command === "isolation") {
    const result = await worker(state, "isolation");
    if (state.phase === "initialized") {
      state.phase = "isolated";
      await save(state);
    }
    console.log(JSON.stringify(result.evidence));
  } else if (command === "seed") {
    assert.equal(
      state.phase,
      "isolated",
      "Verify empty disposable isolation before seeding.",
    );
    const result = await worker(state, "seed");
    state.fixture = result.fixture;
    state.phase = "seeded";
    await save(state);
    await writeFile(
      resolve(ARTIFACT_DIR, "sessions.json"),
      JSON.stringify(result.sessions),
      { mode: 0o600 },
    );
    console.log(JSON.stringify({ provenance: PROVENANCE, ...result.evidence }));
  } else if (command === "verify") {
    assert(["seeded", "verified"].includes(state.phase));
    const result = await worker(state, "verify");
    const logs = await correlate(state, result.evidence.correlations);
    state.phase = "verified";
    await save(state);
    await writeFile(
      resolve(ARTIFACT_DIR, "evidence.json"),
      JSON.stringify(
        { provenance: PROVENANCE, ...result.evidence, logs },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await writeFile(
      resolve(ARTIFACT_DIR, "sessions.json"),
      JSON.stringify(result.sessions),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({ provenance: PROVENANCE, ...result.evidence, logs }),
    );
  } else if (command === "browser" || command === "present") {
    assert.equal(state.phase, "verified", "Verify the real pipeline first.");
    const { demonstrate } = await import("./browser.mjs");
    await demonstrate(state, command === "present");
  } else if (command === "stop") {
    await compose(state, ["down"]);
    console.log("Only the local forecast demo stopped; its volumes retained.");
  } else if (command === "cleanup") {
    // validateStack verifies instance ownership before this narrowly scoped removal.
    await compose(state, ["down", "--volumes", "--remove-orphans"]);
    for (const path of [SECRET_DIR, ARTIFACT_DIR]) {
      await regular(path);
      assert(path.startsWith(ROOT));
      await rm(path, { recursive: true });
    }
    console.log(
      "Only this verified disposable demo and its generated files removed.",
    );
  }
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  main().catch(() => {
    console.error(
      "Local forecast demo refused or failed. No further action taken. Check the isolation requirements and this demo stack's logs; never print credential files.",
    );
    process.exitCode = 1;
  });
