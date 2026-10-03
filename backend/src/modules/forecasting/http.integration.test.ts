import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import request from "supertest";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { createDatabase } from "../../config/database.js";
import { createLogger } from "../../config/logger.js";
import { OtpService } from "../auth/otp.js";
import { signAccountToken, signGuestProof } from "../auth/tokens.js";
import { issueCredential } from "../registrations/credential.js";
import { extractForecast } from "./source.js";
import { fallback, type ForecastRequest } from "./contract.js";
const url = process.env.TEST_DATABASE_URL,
  origin = "http://127.0.0.1:5173";
const config = {
  databaseUrl: url ?? "",
  jwtSecret: Buffer.alloc(32, 9),
  contactKey: Buffer.alloc(32, 10),
  otpKey: Buffer.alloc(32, 11),
  cookieSecure: false,
  forecastServiceUrl: "http://127.0.0.1:8000",
  forecastServiceKey: "d".repeat(64),
};
describe.skipIf(!url)("Slice 8 PostgreSQL/public authority integration", () => {
  const db = createDatabase(url ?? "");
  const deps = {
    db,
    config,
    frontendOrigin: origin,
    otp: new OtpService(db, config, { available: () => true, async send() {} }),
  };
  const app = createApp(
    { port: 3000, frontendOrigin: origin },
    createLogger(
      new Writable({
        write(_c, _e, done) {
          done();
        },
      }),
    ),
    deps,
  );
  afterAll(() => db.$disconnect());
  afterEach(() => vi.unstubAllGlobals());
  async function actor(organizerCapable = false) {
    const user = await db.user.create({ data: { organizerCapable } });
    const session = await db.session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 600000) },
    });
    return {
      userId: user.id,
      sessionId: session.id,
      cookie:
        "eoc_session=" +
        (await signAccountToken(user.id, session.id, config.jwtSecret)),
    };
  }
  async function fixture() {
    const owner = await actor(true),
      admin = await actor(),
      operator = await actor(),
      volunteer = await actor(),
      participant = await actor();
    const event = await db.event.create({
      data: {
        ownerUserId: owner.userId,
        name: "Private forecast event",
        visibility: "PRIVATE",
        registrationCapacity: 1,
        revision: 57,
      },
    });
    const gate = await db.gate.create({ data: { eventId: event.id } });
    const assignment = await db.eventRoleAssignment.create({
      data: {
        eventId: event.id,
        userId: admin.userId,
        role: "EVENT_ADMIN",
        scopeKey: "EVENT",
        grantedByUserId: owner.userId,
      },
    });
    for (const [who, role] of [
      [operator, "GATE_SECURITY"],
      [volunteer, "VOLUNTEER"],
    ] as const)
      await db.eventRoleAssignment.create({
        data: {
          eventId: event.id,
          userId: who.userId,
          role,
          scopeKey: role === "GATE_SECURITY" ? gate.id : "EVENT",
          gateId: role === "GATE_SECURITY" ? gate.id : undefined,
          grantedByUserId: owner.userId,
        },
      });
    return {
      owner,
      admin,
      operator,
      volunteer,
      participant,
      event,
      gate,
      assignment,
    };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const read = (f: Fixture, who = f.owner, path = "current", id = f.event.id) =>
    request(app)
      .get(`/api/v1/events/${id}/forecasts${path ? "/" + path : ""}`)
      .set("Cookie", who.cookie);
  function service(onCall?: (input: ForecastRequest) => Promise<void>) {
    const fetch = vi.fn(async (_url: unknown, options: { body: string }) => {
      const input = JSON.parse(options.body) as ForecastRequest;
      await onCall?.(input);
      return new Response(JSON.stringify(fallback(input, "INSUFFICIENT_DATA")));
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }
  it("persists distinct typed runs for owning Organizer/Admin, with safe headers and no success audit", async () => {
    const f = await fixture(),
      fetch = service();
    const where = { actorUserId: { in: [f.owner.userId, f.admin.userId] } };
    const before = await db.auditEvent.count({ where });
    const ids = [];
    for (const who of [f.owner, f.admin]) {
      const response = await read(f, who, "current", f.event.id.toUpperCase());
      expect(response.status).toBe(200);
      expect(response.body.forecast.status).toBe("INSUFFICIENT_DATA");
      expect(response.body.observed.revision).toBe(0);
      expect(response.body.forecast.input.revision).not.toBe(f.event.revision);
      expect(response.body.forecast.points).toEqual([]);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      expect(response.headers["x-correlation-id"]).toBe(
        response.body.correlation_id,
      );
      expect(JSON.stringify(response.body)).not.toContain(f.owner.userId);
      ids.push(response.body.forecast.run_id);
    }
    expect(ids[0]).not.toBe(ids[1]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await db.auditEvent.count({ where })).toBe(before);
    expect(await db.forecastRun.count({ where: { eventId: f.event.id } })).toBe(
      2,
    );
  });
  it.each(["operator", "volunteer", "participant", "foreign"] as const)(
    "denies %s before extraction/service/history and audits no event facts",
    async (role) => {
      const f = await fixture(),
        fetch = service(),
        who = role === "foreign" ? await actor(true) : f[role];
      for (const path of ["current", ""]) {
        const response = await read(f, who, path);
        expect(response.status).toBe(404);
        expect(response.body.code).toBe("EVENT_NOT_FOUND");
        const audit = await db.auditEvent.findFirstOrThrow({
          where: {
            correlationId: response.body.correlation_id,
            action: "FORECAST_READ_DENIED",
          },
        });
        expect(audit.eventId).toBeNull();
        expect(audit.metadata).toEqual({ code: "EVENT_NOT_FOUND" });
      }
      expect(fetch).not.toHaveBeenCalled();
      expect(
        await db.forecastRun.count({ where: { eventId: f.event.id } }),
      ).toBe(0);
    },
  );
  it("denies anonymous, guest proof, malformed event IDs and owners without capability", async () => {
    const f = await fixture(),
      fetch = service();
    expect(
      (await request(app).get(`/api/v1/events/${f.event.id}/forecasts/current`))
        .status,
    ).toBe(401);
    const proof = await signGuestProof(
      "a".repeat(64),
      "REGISTRATION",
      f.event.id,
      config.jwtSecret,
    );
    expect(
      (
        await request(app)
          .get(`/api/v1/events/${f.event.id}/forecasts/current`)
          .set("Cookie", "eoc_guest_proof=" + proof)
      ).status,
    ).toBe(401);
    expect((await read(f, f.owner, "current", "malformed")).status).toBe(404);
    await db.user.update({
      where: { id: f.owner.userId },
      data: { organizerCapable: false },
    });
    expect((await read(f)).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["session", "assignment", "capability"])(
    "reauthorizes after generation and persists nothing after %s revocation",
    async (kind) => {
      const f = await fixture();
      service(async () => {
        if (kind === "session")
          await db.session.update({
            where: { id: f.owner.sessionId },
            data: { revokedAt: new Date() },
          });
        if (kind === "assignment")
          await db.eventRoleAssignment.update({
            where: { id: f.assignment.id },
            data: { revokedAt: new Date(), revokedByUserId: f.owner.userId },
          });
        if (kind === "capability")
          await db.user.update({
            where: { id: f.owner.userId },
            data: { organizerCapable: false },
          });
      });
      const response = await read(f, kind === "assignment" ? f.admin : f.owner);
      expect(response.status).toBe(kind === "session" ? 401 : 404);
      expect(
        await db.forecastRun.count({ where: { eventId: f.event.id } }),
      ).toBe(0);
    },
  );
  it("keeps history available without Python, exclusive and event-bound across newer inserts", async () => {
    const f = await fixture();
    service();
    const first = await read(f),
      second = await read(f);
    vi.unstubAllGlobals();
    const page = await read(f, f.owner, "").query({ limit: 1 });
    expect(page.status).toBe(200);
    expect(page.body.items[0].run_id).toBe(second.body.forecast.run_id);
    service();
    await read(f);
    const next = await read(f, f.owner, "").query({
      limit: 1,
      cursor: page.body.next_cursor,
    });
    expect(
      next.body.items.map((item: { run_id: string }) => item.run_id),
    ).toEqual([first.body.forecast.run_id]);
    expect(next.body.next_cursor).toBeNull();
    const other = await fixture();
    expect(
      (
        await read(other, other.owner, "").query({
          cursor: page.body.next_cursor,
        })
      ).status,
    ).toBe(400);
  });
  it("rejects unsupported/repeated inputs and all bodies without generation", async () => {
    const f = await fixture(),
      fetch = service();
    for (const query of ["?limit=1", "?horizons=30"]) {
      expect((await read(f, f.owner, "current" + query)).status).toBe(400);
    }
    for (const query of [
      "?limit=0",
      "?limit=101",
      "?limit=2&limit=3",
      "?cursor=bad",
      "?model=anything",
    ]) {
      expect((await read(f, f.owner, "").query(query.slice(1))).status).toBe(
        400,
      );
    }
    expect(
      (await read(f).set("Content-Type", "application/json").send({})).status,
    ).toBe(400);
    expect(
      (await read(f).set("Content-Type", "text/plain").send("body")).status,
    ).toBe(400);
    for (const body of [
      "{invalid-json",
      JSON.stringify({ oversized: "x".repeat(17000) }),
    ]) {
      const response = await read(f)
        .set("Content-Type", "application/json")
        .send(body);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("VALIDATION");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("persists degraded attempts rather than reusing an earlier run", async () => {
    const f = await fixture();
    service();
    const first = await read(f);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("secret internal address")),
    );
    const next = await read(f);
    expect(next.status).toBe(200);
    expect(next.body.forecast.status).toBe("MODEL_UNAVAILABLE");
    expect(next.body.forecast.run_id).not.toBe(first.body.forecast.run_id);
    expect(next.body.forecast.points).toEqual([]);
    expect(JSON.stringify(next.body)).not.toContain("secret");
  });
  it("enforces immutable results, event FK and JSON null/type constraints", async () => {
    const f = await fixture();
    service();
    const response = await read(f),
      id = response.body.forecast.run_id;
    await expect(
      db.forecastRun.update({ where: { id }, data: { result: {} } }),
    ).rejects.toThrow();
    await expect(db.forecastRun.delete({ where: { id } })).rejects.toThrow();
    const row = await db.forecastRun.findUniqueOrThrow({ where: { id } });
    await expect(
      db.forecastRun.create({
        data: { eventId: randomUUID(), result: row.result! },
      }),
    ).rejects.toThrow();
    for (const changes of [
      { status: null },
      { contract_version: "1" },
      { points: null },
      { event_id: null },
      { extra: "secret" },
    ]) {
      await expect(
        db.forecastRun.create({
          data: {
            eventId: f.event.id,
            result: { ...(row.result as object), ...changes },
          },
        }),
      ).rejects.toThrow();
    }
  });
  it("extracts only matching committed accepted check-ins with exact quiet reconstruction", async () => {
    const f = await fixture();
    const acceptedAt = new Date(
      Math.floor((Date.now() - 5 * 3600000) / 60000) * 60000 + 123,
    );
    const registration = await db.registration.create({
      data: { eventId: f.event.id, userId: f.participant.userId },
    });
    const credential = await db.qRCredential.create({
      data: {
        registrationId: registration.id,
        ...issueCredential(registration.id, config.contactKey),
      },
    });
    await db.$transaction(async (tx) => {
      const decision = await tx.scanDecision.create({
        data: {
          eventId: f.event.id,
          scanId: randomUUID(),
          gateId: f.gate.id,
          operatorUserId: f.operator.userId,
          registrationId: registration.id,
          credentialId: credential.id,
          decision: "ACCEPTED",
          reason: "ACCEPTED",
          decidedAt: acceptedAt,
          correlationId: randomUUID(),
        },
      });
      await tx.attendanceTransition.create({
        data: {
          eventId: f.event.id,
          gateId: f.gate.id,
          operatorUserId: f.operator.userId,
          registrationId: registration.id,
          scanDecisionId: decision.id,
          acceptedAt,
        },
      });
    });
    await db.scanDecision.create({
      data: {
        eventId: f.event.id,
        scanId: randomUUID(),
        gateId: f.gate.id,
        operatorUserId: f.operator.userId,
        decision: "REJECTED",
        reason: "INVALID_CREDENTIAL",
        decidedAt: new Date(),
        correlationId: randomUUID(),
      },
    });
    const input = await extractForecast(
      deps,
      f.owner,
      f.event.id,
      randomUUID(),
    );
    expect(input.revision).toBe(1);
    expect(input.occupied).toBe(1);
    expect(input.observations[0].at).toBe(
      new Date(Math.ceil(acceptedAt.getTime() / 60000) * 60000).toISOString(),
    );
    expect(input.observations.every((item) => item.value === 1)).toBe(true);
    expect(input.observations.length).toBeGreaterThanOrEqual(270);
    expect(input.observations.at(-1)?.at).toBe(input.as_of);
  });
  it("fails closed if denial audit or persistence is unavailable", async () => {
    const f = await fixture();
    const tx = vi
      .spyOn(db, "$transaction")
      .mockRejectedValueOnce(new Error("audit unavailable"));
    const denied = await request(app).get(
      `/api/v1/events/${f.event.id}/forecasts/current`,
    );
    expect(denied.status).toBe(503);
    tx.mockRestore();
    service();
    const extracted = await extractForecast(
      deps,
      f.owner,
      f.event.id,
      randomUUID(),
    );
    const create = vi
      .spyOn(db, "$transaction")
      .mockResolvedValueOnce(extracted)
      .mockRejectedValueOnce(new Error("secret db unavailable"));
    const failed = await read(f);
    expect(failed.status).toBe(503);
    expect(failed.body.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(failed.body.forecast).toBeUndefined();
    create.mockRestore();
  });
});
