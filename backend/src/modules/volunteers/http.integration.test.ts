import { randomUUID } from "node:crypto";
import request from "supertest";
import { CertificateDeliveries } from "../certificate-delivery/delivery.js";
import { afterAll, describe, expect, it } from "vitest";
import { testContext, selected } from "../../../../tests/fixtures/slice10.mjs";
import {
  matchesSchema,
  openapi,
} from "../../../../tests/contract/slice11-schema.mjs";
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "Slice 11 tasks/results/audit",
  () => {
    const t = testContext({ send: async () => "SENT" });
    afterAll(() => t.db.$disconnect());
    type Actor = Awaited<ReturnType<typeof t.actor>>;
    const body = (id: string) => ({
      assigned_volunteer_id: id,
      title: "Welcome team",
      instructions: "Help arrivals",
      location: null,
      starts_at: null,
      ends_at: null,
    });
    async function setup() {
      const f = await t.fixture();
      const v = await t.actor(),
        other = await t.actor(),
        admin = await t.actor();
      const grant = await t.db.eventRoleAssignment.create({
        data: {
          eventId: f.event.id,
          userId: v.id,
          role: "VOLUNTEER",
          scopeKey: "EVENT",
          grantedByUserId: f.staff.id,
        },
      });
      await t.db.eventRoleAssignment.create({
        data: {
          eventId: f.event.id,
          userId: admin.id,
          role: "EVENT_ADMIN",
          scopeKey: "EVENT",
          grantedByUserId: f.staff.id,
        },
      });
      return {
        ...f,
        v,
        other,
        admin,
        grant,
        path: `/events/${f.event.id}/volunteer-tasks`,
      };
    }
    async function create(
      f: Awaited<ReturnType<typeof setup>>,
      who = f.staff,
      key = randomUUID(),
    ) {
      const r = await t.post(f.path, who, body(f.v.id), key);
      expect(r.status).toBe(201);
      expect(
        matchesSchema(openapi.components.schemas.TaskResponse, r.body),
      ).toBe(true);
      return r;
    }
    function mutate(
      path: string,
      who: Actor,
      data: object,
      etag = '"1"',
      key = randomUUID(),
      post = false,
    ) {
      return request(t.app)
        [post ? "post" : "patch"](`/api/v1${path}`)
        .set("Cookie", who.cookie)
        .set("Origin", t.deps.frontendOrigin)
        .set("X-CSRF-Token", who.csrf)
        .set("Idempotency-Key", key)
        .set("If-Match", etag)
        .send(data);
    }
    it("creates Unicode task with exact closed DTO, current binding and administrator authority", async () => {
      const f = await setup();
      const r = await t.post(f.path, f.admin, {
        ...body(f.v.id),
        title: "你好 🎟️",
      });
      expect(r.status).toBe(201);
      expect(r.headers.etag).toBe('"1"');
      expect(
        matchesSchema(openapi.components.schemas.TaskResponse, r.body),
      ).toBe(true);
      const task = await t.db.volunteerTask.findUniqueOrThrow({
        where: { id: r.body.task.id },
      });
      expect(task.assignedRoleGrantId).toBe(f.grant.id);
      expect(r.body.task).not.toHaveProperty("assignedRoleGrantId");
    });
    it.each([
      {},
      { title: " " },
      { title: "x".repeat(161) },
      { instructions: "x".repeat(4001) },
      { location: " " },
      { status: "COMPLETED" },
      { starts_at: "bad" },
      {
        starts_at: "2026-10-03T01:00:00.000Z",
        ends_at: "2026-10-03T00:00:00.000Z",
      },
    ])("rejects invalid create %j", async (delta) => {
      const f = await setup();
      const raw = Object.keys(delta).length
        ? { ...body(f.v.id), ...delta }
        : {};
      expect((await t.post(f.path, f.staff, raw)).status).toBe(400);
    });
    it("denies unauthenticated, CSRF, nonstaff, nonassignable and cross-event creates", async () => {
      const f = await setup();
      expect(
        (await request(t.app).post(`/api/v1${f.path}`).send(body(f.v.id)))
          .status,
      ).toBe(401);
      expect(
        (
          await request(t.app)
            .post(`/api/v1${f.path}`)
            .set("Cookie", f.staff.cookie)
            .send(body(f.v.id))
        ).status,
      ).toBe(403);
      expect((await t.post(f.path, f.v, body(f.v.id))).status).toBe(404);
      expect((await t.post(f.path, f.staff, body(f.other.id))).body.code).toBe(
        "VOLUNTEER_NOT_ASSIGNABLE",
      );
      expect(
        (
          await t.post(
            `/events/${randomUUID()}/volunteer-tasks`,
            f.staff,
            body(f.v.id),
          )
        ).status,
      ).toBe(404);
    });
    it("limits list/detail to current own grant, while managers see all", async () => {
      const f = await setup(),
        r = await create(f),
        p = `${f.path}/${r.body.task.id}`;
      expect((await t.get(p, f.v)).status).toBe(200);
      expect((await t.get(p, f.other)).status).toBe(404);
      expect((await t.get(f.path + "?view=manage", f.v)).status).toBe(404);
      expect((await t.get(f.path + "?view=own", f.v)).body.items).toHaveLength(
        1,
      );
      expect(
        (
          await t.get(
            `/events/${randomUUID()}/volunteer-tasks/${r.body.task.id}`,
            f.staff,
          )
        ).status,
      ).toBe(404);
    });
    it("volunteer alone progresses, completion immutable and readable", async () => {
      const f = await setup(),
        r = await create(f),
        p = `${f.path}/${r.body.task.id}`;
      expect(
        (await mutate(p + "/status", f.admin, { status: "IN_PROGRESS" }))
          .status,
      ).toBe(403);
      expect(
        (await mutate(p + "/status", f.v, { status: "COMPLETED" })).body.code,
      ).toBe("INVALID_TRANSITION");
      let next = await mutate(p + "/status", f.v, { status: "IN_PROGRESS" });
      expect(next.status).toBe(200);
      expect(
        (await mutate(p, f.staff, { title: "Updated" }, next.headers.etag))
          .status,
      ).toBe(200);
      next = await t.get(p, f.v);
      next = await mutate(
        p + "/status",
        f.v,
        { status: "COMPLETED" },
        next.headers.etag,
      );
      expect(next.status).toBe(200);
      expect((await t.get(p, f.v)).body.task.status).toBe("COMPLETED");
      expect(
        (await mutate(p, f.staff, { title: "bad" }, next.headers.etag)).body
          .code,
      ).toBe("TASK_NOT_EDITABLE");
      expect(
        (
          await mutate(
            p + "/assignee",
            f.staff,
            { assigned_volunteer_id: f.v.id },
            next.headers.etag,
          )
        ).body.code,
      ).toBe("TASK_NOT_REASSIGNABLE");
      expect(
        (
          await mutate(
            p + "/cancel",
            f.staff,
            { reason: "Finished" },
            next.headers.etag,
            randomUUID(),
            true,
          )
        ).body.code,
      ).toBe("INVALID_TRANSITION");
    });
    it.each(["ASSIGNED", "IN_PROGRESS"])(
      "cancels %s retaining reason/binding/history and hides own task",
      async (state) => {
        const f = await setup(),
          r = await create(f),
          id = r.body.task.id,
          p = `${f.path}/${id}`;
        let etag = r.headers.etag;
        if (state === "IN_PROGRESS")
          etag = (await mutate(p + "/status", f.v, { status: state })).headers
            .etag;
        const key = randomUUID(),
          cancel = await mutate(
            p + "/cancel",
            f.admin,
            { reason: "  Shift ended  " },
            etag,
            key,
            true,
          );
        expect(cancel.status).toBe(200);
        expect(cancel.body.task.cancellation_reason).toBe("Shift ended");
        expect(
          matchesSchema(openapi.components.schemas.TaskResponse, cancel.body),
        ).toBe(true);
        expect(
          (
            await mutate(
              p + "/cancel",
              f.admin,
              { reason: "  Shift ended  " },
              etag,
              key,
              true,
            )
          ).headers.etag,
        ).toBe(cancel.headers.etag);
        expect((await t.get(p, f.v)).status).toBe(404);
        expect(
          (await t.get(f.path + "?view=own", f.v)).body.items,
        ).toHaveLength(0);
        expect(
          (await t.get(f.path + "?view=manage", f.staff)).body.items[0].status,
        ).toBe("CANCELLED");
        expect(
          (
            await t.db.eventRoleAssignment.findUniqueOrThrow({
              where: { id: f.grant.id },
            })
          ).revokedAt,
        ).toBeNull();
        const a = await t.db.auditEvent.findFirstOrThrow({
          where: { eventId: f.event.id, action: "VOLUNTEER_TASK_CANCELLED" },
        });
        expect(a.metadata).toMatchObject({
          task_id: id,
          previous_status: state,
          reason: "Shift ended",
        });
        expect(
          await t.db.auditEvent.count({
            where: { eventId: f.event.id, action: "VOLUNTEER_TASK_CANCELLED" },
          }),
        ).toBe(1);
        expect(
          (await mutate(p, f.staff, { title: "no" }, cancel.headers.etag)).body
            .code,
        ).toBe("TASK_NOT_EDITABLE");
      },
    );
    it.each(["", " ", "x".repeat(501)])(
      "rejects cancellation reason boundary",
      async (reason) => {
        const f = await setup(),
          r = await create(f);
        expect(
          (
            await mutate(
              `${f.path}/${r.body.task.id}/cancel`,
              f.staff,
              { reason },
              r.headers.etag,
              randomUUID(),
              true,
            )
          ).status,
        ).toBe(400);
      },
    );
    it("reassigns ASSIGNED only and regrant does not restore the old binding", async () => {
      const f = await setup(),
        r = await create(f),
        p = `${f.path}/${r.body.task.id}`;
      await t.db.eventRoleAssignment.update({
        where: { id: f.grant.id },
        data: { revokedAt: new Date(), revokedByUserId: f.staff.id },
      });
      expect((await t.get(p, f.v)).status).toBe(404);
      await t.db.eventRoleAssignment.create({
        data: {
          eventId: f.event.id,
          userId: f.v.id,
          role: "VOLUNTEER",
          scopeKey: "EVENT",
          grantedByUserId: f.staff.id,
        },
      });
      expect((await t.get(p, f.v)).status).toBe(404);
      const reassigned = await mutate(p + "/assignee", f.admin, {
        assigned_volunteer_id: f.v.id,
      });
      expect(reassigned.status).toBe(200);
      expect((await t.get(p, f.v)).status).toBe(200);
      const progressed = await mutate(
        p + "/status",
        f.v,
        { status: "IN_PROGRESS" },
        reassigned.headers.etag,
      );
      expect(
        (
          await mutate(
            p + "/assignee",
            f.staff,
            { assigned_volunteer_id: f.v.id },
            progressed.headers.etag,
          )
        ).body.code,
      ).toBe("TASK_NOT_REASSIGNABLE");
      await t.db.session.update({
        where: { id: f.v.sessionId },
        data: { revokedAt: new Date() },
      });
      expect((await t.get(p, f.v)).status).toBe(401);
    });
    it("serializes concurrent progress and replays same command before current revision check", async () => {
      const f = await setup(),
        r = await create(f),
        p = `${f.path}/${r.body.task.id}/status`,
        key = randomUUID();
      const responses = await Promise.all([
        mutate(p, f.v, { status: "IN_PROGRESS" }, '"1"', key),
        mutate(p, f.v, { status: "IN_PROGRESS" }, '"1"', key),
      ]);
      expect(responses.map((x) => x.status)).toEqual([200, 200]);
      expect(
        await t.db.auditEvent.count({
          where: {
            eventId: f.event.id,
            action: "VOLUNTEER_TASK_STATUS_CHANGED",
          },
        }),
      ).toBe(1);
      expect(
        (await mutate(p, f.v, { status: "COMPLETED" }, '"1"', key)).body.code,
      ).toBe("IDEMPOTENCY_CONFLICT");
      const next = await Promise.all([
        mutate(p, f.v, { status: "COMPLETED" }, '"2"'),
        mutate(p, f.v, { status: "COMPLETED" }, '"2"'),
      ]);
      expect(next.map((x) => x.status).sort()).toEqual([200, 409]);
    });
    it("retains no-op revision, exposes ETag and matches list/error schemas", async () => {
      const f = await setup(),
        r = await create(f),
        p = `${f.path}/${r.body.task.id}`;
      const same = await mutate(p, f.staff, { title: r.body.task.title });
      expect(same.status).toBe(200);
      expect(same.headers.etag).toBe('"1"');
      expect(
        await t.db.auditEvent.count({
          where: { eventId: f.event.id, action: "VOLUNTEER_TASK_UPDATED" },
        }),
      ).toBe(0);
      const read = await t.get(p, f.staff).set("Origin", t.deps.frontendOrigin);
      expect(read.headers["access-control-expose-headers"]).toContain("ETag");
      const list = await t.get(f.path + "?view=manage", f.staff);
      expect(
        matchesSchema(openapi.components.schemas.TaskList, list.body),
      ).toBe(true);
      const error = await mutate(p, f.staff, { title: "Changed" }, '"2"');
      expect(error.body.code).toBe("VERSION_CONFLICT");
      expect(matchesSchema(openapi.components.schemas.Error, error.body)).toBe(
        true,
      );
      expect(
        (
          await mutate(p, f.staff, {
            title: r.body.task.title,
            instructions: "Changed instructions",
          })
        ).status,
      ).toBe(200);
      const changed = await t.db.auditEvent.findFirstOrThrow({
        where: { eventId: f.event.id, action: "VOLUNTEER_TASK_UPDATED" },
      });
      expect(changed.metadata).toMatchObject({ fields: ["instructions"] });
    });
    it("retains expired create identity and rejects repeat create after replay expiry", async () => {
      const f = await setup(),
        key = randomUUID();
      await create(f, f.staff, key);
      await t.db.commandReplay.updateMany({
        where: {
          actorUserId: f.staff.id,
          action: "VOLUNTEER_TASK_CREATE",
          resourceKey: f.event.id,
        },
        data: { expiresAt: new Date(Date.now() - 1) },
      });
      expect((await t.post(f.path, f.staff, body(f.v.id), key)).body.code).toBe(
        "IDEMPOTENCY_CONFLICT",
      );
      await t.db.eventRoleAssignment.update({
        where: { id: f.grant.id },
        data: { revokedAt: new Date(), revokedByUserId: f.staff.id },
      });
      expect((await t.post(f.path, f.staff, body(f.v.id), key)).body.code).toBe(
        "IDEMPOTENCY_CONFLICT",
      );
      expect(
        await t.db.volunteerTask.count({ where: { eventId: f.event.id } }),
      ).toBe(1);
    });
    async function failAudit(
      eventId: string,
      action: string,
      run: () => Promise<void>,
    ) {
      const name = "slice11_audit_" + randomUUID().replaceAll("-", "");
      await t.db.$executeRawUnsafe(
        `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic required audit failure'; END $$`,
      );
      try {
        await t.db.$executeRawUnsafe(
          `CREATE TRIGGER "${name}" BEFORE INSERT ON "AuditEvent" FOR EACH ROW WHEN (NEW."eventId"='${eventId}'::uuid AND NEW.action='${action}') EXECUTE FUNCTION "${name}"()`,
        );
        await run();
      } finally {
        await t.db.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS "${name}" ON "AuditEvent"`,
        );
        await t.db.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);
      }
    }
    it("rolls task and replay back on required audit failure", async () => {
      const f = await setup();
      await failAudit(f.event.id, "VOLUNTEER_TASK_CREATED", async () => {
        const r = await t.post(f.path, f.staff, body(f.v.id));
        expect(r.status).toBe(503);
        expect(
          await t.db.volunteerTask.count({ where: { eventId: f.event.id } }),
        ).toBe(0);
        expect(
          await t.db.commandReplay.count({
            where: { actorUserId: f.staff.id, action: "VOLUNTEER_TASK_CREATE" },
          }),
        ).toBe(0);
      });
    });
    it.each(["AUDIT_SEARCHED", "EVENT_RESULTS_VIEWED"])(
      "withholds read data when required %s audit fails",
      async (action) => {
        const f = await setup();
        await t.db.event.update({
          where: { id: f.event.id },
          data: { state: "COMPLETED" },
        });
        await failAudit(f.event.id, action, async () => {
          const r = await t.get(
            `/events/${f.event.id}/${action === "AUDIT_SEARCHED" ? "audit-events" : "results"}`,
            f.staff,
          );
          expect(r.status).toBe(503);
          expect(r.body.code).toBe("DEPENDENCY_UNAVAILABLE");
          expect(r.body).not.toHaveProperty("items");
          expect(r.body).not.toHaveProperty("results");
        });
      },
    );
    it("paginates tasks with signed actor/view/event binding and filters before pages", async () => {
      const f = await setup();
      await create(f);
      await create(f);
      const r = await t.get(f.path + "?view=own&limit=1", f.v);
      expect(r.body.next_cursor).toBeTruthy();
      const next = await t.get(
        f.path +
          "?view=own&limit=1&cursor=" +
          encodeURIComponent(r.body.next_cursor),
        f.v,
      );
      expect(next.body.items[0].id).not.toBe(r.body.items[0].id);
      expect(
        (
          await t.get(
            f.path +
              "?view=manage&cursor=" +
              encodeURIComponent(r.body.next_cursor),
            f.staff,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await t.get(
            f.path +
              "?view=own&cursor=" +
              encodeURIComponent(r.body.next_cursor + "a"),
            f.v,
          )
        ).status,
      ).toBe(400);
    });
    it("returns coherent completed results and rejects live results", async () => {
      const f = await setup();
      expect(
        (await t.get(`/events/${f.event.id}/results`, f.staff)).body.code,
      ).toBe("RESULTS_NOT_COMPLETED");
      const zero = await t.db.gate.create({ data: { eventId: f.event.id } });
      await t.db.event.update({
        where: { id: f.event.id },
        data: { state: "COMPLETED" },
      });
      let response = await t.get(`/events/${f.event.id}/results`, f.admin);
      expect(response.status).toBe(200);
      expect(
        matchesSchema(
          openapi.components.schemas.ResultsResponse,
          response.body,
        ),
      ).toBe(true);
      expect(response.body.results).toMatchObject({
        total_registrations: 1,
        cancelled_registrations: 0,
        accepted_check_ins: 1,
        attendance_rate_percentage: 100,
        certificate_eligible_count: 1,
        certificate_issued_count: 0,
      });
      expect(response.body.results.gate_check_ins).toContainEqual({
        gate_id: zero.id,
        accepted_check_ins: 0,
      });
      expect((await t.get(`/events/${f.event.id}/results`, f.v)).status).toBe(
        404,
      );
      await t.post(f.managed, f.staff, selected);
      response = await t.get(`/events/${f.event.id}/results`, f.staff);
      expect(response.body.results).toMatchObject({
        certificate_eligible_count: 0,
        certificate_issued_count: 1,
        certificate_delivery_counts: { PENDING: 1 },
      });
    });
    it("audit search filters exact evidence, redacts free text, binds cursors, and records its own reads", async () => {
      const f = await setup();
      const at = new Date("2026-10-03T10:00:00.000Z");
      for (let i = 0; i < 3; i++)
        await t.db.auditEvent.create({
          data: {
            actorKind: "ACCOUNT",
            actorUserId: f.staff.id,
            eventId: f.event.id,
            action: "EVENT_UPDATED",
            outcome: "ACCEPTED",
            correlationId: randomUUID(),
            createdAt: at,
            metadata: { otp: "secret", reason: "private", pdf: "bytes" },
          },
        });
      await t.db.auditEvent.create({
        data: {
          actorKind: "SYSTEM",
          eventId: f.event.id,
          action: "UNRECOGNIZED",
          outcome: "FAILED",
          correlationId: randomUUID(),
          metadata: { task_id: randomUUID(), email: "secret" },
        },
      });
      const path = `/events/${f.event.id}/audit-events`,
        query =
          "?action=EVENT_UPDATED&target_type=EVENT&limit=1&from=2026-10-03T10%3A00%3A00.000Z&to=2026-10-03T11%3A00%3A00.000Z";
      const first = await t.get(path + query, f.staff);
      expect(first.status).toBe(200);
      expect(
        matchesSchema(openapi.components.schemas.AuditList, first.body),
      ).toBe(true);
      expect(JSON.stringify(first.body)).not.toContain("secret");
      const next = await t.get(
        path + query + "&cursor=" + encodeURIComponent(first.body.next_cursor),
        f.staff,
      );
      expect(next.body.items[0].id < first.body.items[0].id).toBe(true);
      expect(
        (
          await t.get(
            path + "?actor=SYSTEM&outcome=FAILED&target_type=UNKNOWN",
            f.admin,
          )
        ).body.items[0].target_id,
      ).toBeNull();
      expect(
        (
          await t.get(
            path +
              "?action=EVENT&cursor=" +
              encodeURIComponent(first.body.next_cursor),
            f.staff,
          )
        ).status,
      ).toBe(400);
      expect((await t.get(path, f.v)).status).toBe(404);
      expect(
        await t.db.auditEvent.count({
          where: { eventId: f.event.id, action: "AUDIT_SEARCHED" },
        }),
      ).toBeGreaterThanOrEqual(3);
    });

    it("denies cross-task access and loses replay authority after reassignment or revocation", async () => {
      const f = await setup();
      await t.db.eventRoleAssignment.create({
        data: {
          eventId: f.event.id,
          userId: f.other.id,
          role: "VOLUNTEER",
          scopeKey: "EVENT",
          grantedByUserId: f.staff.id,
        },
      });
      const r = await create(f),
        p = `${f.path}/${r.body.task.id}`;
      expect((await t.get(p, f.other)).status).toBe(404);
      expect(
        (await mutate(p + "/status", f.other, { status: "IN_PROGRESS" }))
          .status,
      ).toBe(404);
      const changed = await mutate(p + "/assignee", f.staff, {
        assigned_volunteer_id: f.other.id,
      });
      expect(changed.status).toBe(200);
      expect((await t.get(p, f.v)).status).toBe(404);
      expect((await t.get(p, f.other)).status).toBe(200);
      const key = randomUUID();
      expect(
        (
          await mutate(
            p + "/status",
            f.other,
            { status: "IN_PROGRESS" },
            changed.headers.etag,
            key,
          )
        ).status,
      ).toBe(200);
      await t.db.eventRoleAssignment.updateMany({
        where: { eventId: f.event.id, userId: f.other.id, role: "VOLUNTEER" },
        data: { revokedAt: new Date(), revokedByUserId: f.staff.id },
      });
      expect(
        (
          await mutate(
            p + "/status",
            f.other,
            { status: "IN_PROGRESS" },
            changed.headers.etag,
            key,
          )
        ).status,
      ).toBe(404);
      const createKey = randomUUID();
      await create(f, f.admin, createKey);
      await t.db.eventRoleAssignment.updateMany({
        where: { eventId: f.event.id, userId: f.admin.id, role: "EVENT_ADMIN" },
        data: { revokedAt: new Date(), revokedByUserId: f.staff.id },
      });
      expect(
        (await t.post(f.path, f.admin, body(f.v.id), createKey)).status,
      ).toBe(404);
    });
    it("serializes reassignment/cancellation and completion/cancellation with retained history", async () => {
      const f = await setup(),
        r = await create(f),
        p = `${f.path}/${r.body.task.id}`;
      await t.db.eventRoleAssignment.create({
        data: {
          eventId: f.event.id,
          userId: f.other.id,
          role: "VOLUNTEER",
          scopeKey: "EVENT",
          grantedByUserId: f.staff.id,
        },
      });
      const race = await Promise.all([
        mutate(p + "/assignee", f.staff, { assigned_volunteer_id: f.other.id }),
        mutate(
          p + "/cancel",
          f.admin,
          { reason: "Shift cancelled" },
          '"1"',
          randomUUID(),
          true,
        ),
      ]);
      expect(race.map((x) => x.status).sort()).toEqual([200, 409]);
      const fresh = await create(f),
        q = `${f.path}/${fresh.body.task.id}`;
      await mutate(q + "/status", f.v, { status: "IN_PROGRESS" });
      const finish = await Promise.all([
        mutate(q + "/status", f.v, { status: "COMPLETED" }, '"2"'),
        mutate(
          q + "/cancel",
          f.staff,
          { reason: "Shift cancelled" },
          '"2"',
          randomUUID(),
          true,
        ),
      ]);
      expect(finish.filter((x) => x.status === 200)).toHaveLength(1);
      expect(finish.filter((x) => x.status !== 200)[0]!.status).toBeOneOf([
        404, 409,
      ]);
      const saved = await t.db.volunteerTask.findUniqueOrThrow({
        where: { id: fresh.body.task.id },
      });
      expect(["COMPLETED", "CANCELLED"]).toContain(saved.status);
      expect(saved.revision).toBe(3);
    });
    it("validates headers, closed queries, byte bounds and Unicode cancellation boundary", async () => {
      const f = await setup(),
        r = await create(f),
        p = `${f.path}/${r.body.task.id}`;
      for (const query of [
        "?view=own&view=manage",
        "?view=manage&limit=101",
        "?view=manage&unexpected=x",
      ])
        expect((await t.get(f.path + query, f.staff)).status).toBe(400);
      expect(
        (
          await request(t.app)
            .patch("/api/v1" + p)
            .set("Cookie", f.staff.cookie)
            .set("Origin", t.deps.frontendOrigin)
            .set("X-CSRF-Token", f.staff.csrf)
            .set("Idempotency-Key", randomUUID())
            .send({ title: "Changed" })
        ).status,
      ).toBe(400);
      expect(
        (
          await t.post(f.path, f.staff, {
            ...body(f.v.id),
            instructions: "x".repeat(17000),
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await mutate(
            p + "/cancel",
            f.v,
            { reason: "Not allowed" },
            '"1"',
            randomUUID(),
            true,
          )
        ).status,
      ).toBe(404);
      const reason = "\u{1F600}".repeat(500);
      const cancel = await mutate(
        p + "/cancel",
        f.staff,
        { reason },
        '"1"',
        randomUUID(),
        true,
      );
      expect(cancel.status).toBe(200);
      expect(cancel.body.task.cancellation_reason).toBe(reason);
      const replay = await mutate(
        p + "/status",
        f.v,
        { status: "IN_PROGRESS" },
        '"1"',
      );
      expect(replay.status).toBe(404);
    });
    it("rolls cancellation history/state/replay back on required audit failure", async () => {
      const f = await setup(),
        r = await create(f),
        key = randomUUID(),
        p = `${f.path}/${r.body.task.id}`;
      await failAudit(f.event.id, "VOLUNTEER_TASK_CANCELLED", async () => {
        expect(
          (
            await mutate(
              p + "/cancel",
              f.staff,
              { reason: "Rollback" },
              '"1"',
              key,
              true,
            )
          ).status,
        ).toBe(503);
      });
      const task = await t.db.volunteerTask.findUniqueOrThrow({
        where: { id: r.body.task.id },
      });
      expect(task.status).toBe("ASSIGNED");
      expect(task.revision).toBe(1);
      expect(task.cancellationReason).toBeNull();
      expect(
        (
          await mutate(
            p + "/cancel",
            f.staff,
            { reason: "Rollback" },
            '"1"',
            key,
            true,
          )
        ).status,
      ).toBe(200);
    });
    it("reconciles retained registration rows and zero denominator without fabricated attendance", async () => {
      const f = await setup();
      const cancelled = await t.registration(f.staff, f.event.id, {
        accepted: false,
      });
      await t.db.registration.update({
        where: { id: cancelled.row.id },
        data: {
          state: "CANCELLED",
          cancelledAt: new Date(),
          cancelledActorKind: "ACCOUNT",
          cancelledByUserId: f.staff.id,
        },
      });
      await t.db.registration.create({
        data: { eventId: f.event.id, userId: cancelled.participant.id },
      });
      await t.db.event.update({
        where: { id: f.event.id },
        data: { state: "COMPLETED" },
      });
      const before = Date.now(),
        r = await t.get(`/events/${f.event.id}/results`, f.staff),
        after = Date.now();
      expect(r.body.results).toMatchObject({
        total_registrations: 3,
        cancelled_registrations: 1,
        accepted_check_ins: 1,
        attendance_rate_percentage: 50,
      });
      expect(Date.parse(r.body.results.as_of)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(r.body.results.as_of)).toBeLessThanOrEqual(after);
      const empty = await t.db.event.create({
        data: {
          ownerUserId: f.staff.id,
          name: "Empty results",
          state: "COMPLETED",
          visibility: "PUBLIC",
          startAt: new Date(),
          endAt: new Date(Date.now() + 3600000),
          timeZone: "UTC",
        },
      });
      const none = await t.get(`/events/${empty.id}/results`, f.staff);
      expect(none.body.results.attendance_rate_percentage).toBeNull();
      expect(none.body.results.data_limitations).toContain(
        "NO_REGISTERED_DENOMINATOR",
      );
    });
    it("counts distinct certificates/deliveries in all six states and overlapping batches once", async () => {
      const f = await setup();
      await t.db.event.update({
        where: { id: f.event.id },
        data: { state: "COMPLETED" },
      });
      const rows = [f];
      for (let i = 0; i < 5; i++)
        rows.push({
          ...f,
          ...(await t.registration(f.staff, f.event.id, { guest: i === 0 })),
        });
      for (const row of rows)
        expect((await t.post(row.managed, f.staff, selected)).status).toBe(201);
      const deliveries = await Promise.all(
        rows.map(async (row) => {
          const cert = await t.db.certificate.findUniqueOrThrow({
            where: { registrationId: row.row.id },
          });
          return t.db.certificateDelivery.findUniqueOrThrow({
            where: { certificateId: cert.id },
          });
        }),
      );
      for (const [index, status] of [
        [2, "SENT"],
        [3, "UNKNOWN"],
        [4, "FAILED"],
      ] as const)
        await new CertificateDeliveries(t.deps, {
          send: async () => status,
        }).process(deliveries[index]!.id);
      let authorize!: () => void, finish!: () => void;
      const begun = new Promise<void>((r) => (authorize = r)),
        held = new Promise<void>((r) => (finish = r));
      const running = new CertificateDeliveries(t.deps, {
        send: async () => {
          authorize();
          await held;
          return "SENT";
        },
      }).process(deliveries[5]!.id);
      await begun;
      try {
        const batch = await t.post(
          `/events/${f.event.id}/certificate-batches`,
          f.staff,
          { ...selected, registration_ids: [f.row.id] },
        );
        expect(batch.status).toBe(202);
        const pending = await t.get(`/events/${f.event.id}/results`, f.staff);
        expect(pending.body.results.data_limitations).toContain(
          "CERTIFICATE_PROCESSING_INCOMPLETE",
        );
        await t.settle(batch.body.batch.batch_id);
        expect(
          (
            await t.post(f.managed + "/revoke", f.staff, {
              reason: "Revoked for test",
            })
          ).status,
        ).toBe(200);
        const result = await t.get(`/events/${f.event.id}/results`, f.staff);
        expect(result.body.results).toMatchObject({
          total_registrations: 6,
          accepted_check_ins: 6,
          certificate_eligible_count: 0,
          certificate_issued_count: 5,
          certificate_revoked_count: 1,
          certificate_delivery_counts: {
            NOT_REQUIRED: 1,
            PENDING: 1,
            SENDING: 1,
            SENT: 1,
            UNKNOWN: 1,
            FAILED: 1,
          },
        });
        expect(
          matchesSchema(
            openapi.components.schemas.ResultsResponse,
            result.body,
          ),
        ).toBe(true);
        expect(result.body.results.data_limitations).toContain(
          "DELIVERY_PENDING_OR_UNCERTAIN",
        );
        finish();
        const [concurrent] = await Promise.all([
          t.get(`/events/${f.event.id}/results`, f.staff),
          running,
        ]);
        const counts = concurrent.body.results.certificate_delivery_counts;
        expect(counts.SENDING + counts.SENT).toBe(2);
        expect(
          Object.values(counts).reduce((sum: number, n) => sum + Number(n), 0),
        ).toBe(6);
      } finally {
        finish();
        await running;
      }
    });
    it("rejects malformed audit filters/cursors and maps only actual allowlisted legacy evidence", async () => {
      const f = await setup(),
        path = `/events/${f.event.id}/audit-events`,
        id = randomUUID();
      await t.db.auditEvent.create({
        data: {
          eventId: f.event.id,
          actorKind: "SYSTEM",
          action: "CERTIFICATE_GENERATION_FAILED",
          outcome: "FAILED",
          correlationId: randomUUID(),
          metadata: { issue_work_id: id },
        },
      });
      await t.db.auditEvent.create({
        data: {
          eventId: f.event.id,
          actorKind: "ACCOUNT",
          actorUserId: f.staff.id,
          action: "CERTIFICATE_NAME_SET",
          outcome: "SUCCESS",
          correlationId: randomUUID(),
          metadata: { registration_id: f.row.id },
        },
      });
      await t.db.auditEvent.create({
        data: {
          eventId: f.event.id,
          actorKind: "GUEST",
          action: "CREDENTIAL_VIEWED",
          outcome: "SUCCESS",
          correlationId: randomUUID(),
          metadata: { credential_id: "not-uuid", registration_id: f.row.id },
        },
      });
      expect(
        (
          await t.get(
            path +
              "?actor=SYSTEM&action=CERTIFICATE_GENERATION_FAILED&target_type=CERTIFICATE_ISSUE_WORK",
            f.staff,
          )
        ).body.items[0].target_id,
      ).toBe(id);
      expect(
        (
          await t.get(
            path +
              `?actor=${f.staff.id}&action=CERTIFICATE_NAME_SET&target_type=REGISTRATION`,
            f.staff,
          )
        ).body.items[0].target_id,
      ).toBe(f.row.id);
      expect(
        (await t.get(path + "?actor=GUEST&target_type=UNKNOWN", f.staff)).body
          .items[0].target_id,
      ).toBeNull();
      for (const q of [
        "actor=",
        "action=lower",
        "action=A&action=B",
        "limit=0",
        "limit=101",
        "target_type=ANY",
        "outcome=",
        "from=2026-10-03T00:00:00Z",
        "from=2026-10-03T01:00:00.000Z&to=2026-10-03T00:00:00.000Z",
        "cursor=forged",
        "extra=secret",
      ])
        expect((await t.get(path + "?" + q, f.staff)).status).toBe(400);
      const first = await t.get(path + "?limit=1", f.staff);
      expect(first.body.next_cursor).toBeTruthy();
      expect(
        (
          await t.get(
            path +
              "?limit=1&cursor=" +
              encodeURIComponent(first.body.next_cursor),
            f.admin,
          )
        ).status,
      ).toBe(400);
      expect(
        (await t.get(`/events/${randomUUID()}/audit-events`, f.staff)).status,
      ).toBe(404);
    });
  },
);
