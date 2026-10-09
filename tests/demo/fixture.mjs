// Test-only worker, bind-mounted exclusively into the guarded local tools container.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EVENT_NAME, assertDatabaseUrl } from "./isolation.mjs";
import { createDatabase } from "../../backend/dist/config/database.js";
import { recoverCredential } from "../../backend/dist/modules/registrations/credential.js";
import {
  isolation,
  seed,
  fixtureSessions,
  validateFixture,
} from "./ledger.mjs";
import { verify } from "./pipeline.mjs";
const secret = async (name) =>
  (await readFile("/run/secrets/" + name, "utf8")).trim();
async function main() {
  assert.equal(process.argv.length, 3);
  const input = JSON.parse(process.argv[2]);
  assert.deepEqual(Object.keys(input).sort(), [
    "action",
    "fixture",
    "instance",
  ]);
  const instance = (await readFile("/run/secrets/instance", "utf8")).trim();
  assert.equal(input.instance, instance);
  assert(/^[a-f0-9]{32}$/.test(instance));
  const url = (await readFile("/run/secrets/migration_url", "utf8")).trim();
  assertDatabaseUrl(url, "eoc_migrator");
  const db = createDatabase(url);
  try {
    assert(["isolation", "seed", "verify", "sessions"].includes(input.action));
    if (input.action === "isolation")
      process.stdout.write(
        JSON.stringify({
          ok: true,
          evidence: await isolation(db, instance, input.fixture === null),
        }),
      );
    else {
      const contactKey = Buffer.from(await secret("contact_key"), "hex"),
        jwt = Buffer.from(await secret("jwt_secret"), "hex");
      assert.equal(contactKey.length, 32);
      assert.equal(jwt.length, 32);
      if (input.action === "seed") {
        assert.equal(input.fixture, null);
        const fixture = await seed(db, instance, contactKey);
        process.stdout.write(
          JSON.stringify({
            ok: true,
            fixture,
            sessions: await fixtureSessions(db, fixture, jwt),
            evidence: {
              event_name: EVENT_NAME,
              event_id: fixture.event_id,
              synthetic_accepted_check_ins: 16,
            },
          }),
        );
      } else if (input.action === "sessions") {
        await isolation(db, instance, false);
        await validateFixture(db, input.fixture);
        const sessions = await fixtureSessions(db, input.fixture, jwt);
        sessions.registrations = {};
        for (const role of ["participant", "arrival"])
          sessions.registrations[role] = (
            await db.registration.findFirstOrThrow({
              where: {
                eventId: input.fixture.event_id,
                userId: input.fixture[role],
                state: "REGISTERED",
              },
            })
          ).id;
        const qr = await db.qRCredential.findFirstOrThrow({
          where: {
            registrationId: sessions.registrations.arrival,
            revokedAt: null,
          },
        });
        sessions.arrival_credential = recoverCredential(
          sessions.registrations.arrival,
          qr.protectedRepresentation,
          contactKey,
        );
        process.stdout.write(JSON.stringify({ ok: true, sessions }));
      } else
        process.stdout.write(
          JSON.stringify(
            await verify(db, instance, input.fixture, jwt, contactKey),
          ),
        );
    }
  } finally {
    await db.$disconnect();
  }
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  main().catch((error) => {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error_type: error.name,
        code: error.code,
        call_sites: error.stack
          ?.split("\n")
          .filter((line) => line.trim().startsWith("at "))
          .slice(0, 3),
      }),
    );
    process.exitCode = 1;
  });
