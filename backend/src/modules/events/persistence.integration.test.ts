import { randomBytes, randomUUID } from "node:crypto";
import { AuditActorKind, Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "../../config/database.js";
import { recordAudit } from "../auth/audit.js";
import { ApiError } from "../auth/errors.js";
import {
  COMMAND_REPLAY_RETENTION_MS,
  executeIdempotentCommand,
  PROTECTED_REPLAY_RETENTION_MS,
} from "./command-safety.js";
import {
  generatePrivateLinkProof,
  issuePrivateAccessLink,
  lockEventForCommand,
  privateLinkVerifier,
  replacePrivateAccessLink,
  revokePrivateAccessLink,
} from "./private-links.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("Slice 3 PostgreSQL persistence safety", () => {
  const db = createDatabase(databaseUrl ?? "");
  const verifierKey = { version: 1, key: randomBytes(32) };
  const replayKey = { version: 1, key: randomBytes(32) };

  afterAll(async () => {
    await db.$disconnect();
  });

  async function fixture() {
    const owner = await db.user.create({
      data: { organizerCapable: true },
    });
    const event = await db.event.create({
      data: { ownerUserId: owner.id, name: "Persistence fixture" },
    });
    return { owner, event };
  }

  it("installs the approved constraints and cursor-supporting indexes", async () => {
    const indexes = await db.$queryRaw<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN (
          'Event_ownerUserId_createdAt_id_idx',
          'EventRoleAssignment_active_admin_user_event_idx',
          'Event_public_catalog_idx',
          'PrivateAccessLink_one_active_per_event',
          'PrivateAccessLink_verifierHash_key',
          'CommandReplay_actor_action_resource_key_key',
          'CommandReplay_expiresAt_idx'
        )
    `;
    expect(indexes.map(({ indexname }) => indexname).sort()).toEqual(
      [
        "CommandReplay_actor_action_resource_key_key",
        "CommandReplay_expiresAt_idx",
        "EventRoleAssignment_active_admin_user_event_idx",
        "Event_ownerUserId_createdAt_id_idx",
        "Event_public_catalog_idx",
        "PrivateAccessLink_one_active_per_event",
        "PrivateAccessLink_verifierHash_key",
      ].sort(),
    );

    const owner = await db.user.create({ data: {} });
    await expect(
      db.event.create({ data: { ownerUserId: owner.id, name: "   " } }),
    ).rejects.toMatchObject({ code: "P2004" });
    await expect(
      db.event.create({
        data: {
          ownerUserId: owner.id,
          name: "Incomplete schedule",
          startAt: new Date("2030-01-01T10:00:00Z"),
        },
      }),
    ).rejects.toMatchObject({ code: "P2004" });
    await expect(
      db.event.create({
        data: {
          ownerUserId: owner.id,
          name: "Invalid capacity",
          registrationCapacity: 0,
        },
      }),
    ).rejects.toMatchObject({ code: "P2004" });
  });

  it("enforces one active PRIVATE link under concurrent writes", async () => {
    const { event } = await fixture();
    const firstProof = generatePrivateLinkProof();
    const secondProof = generatePrivateLinkProof();
    const results = await Promise.allSettled([
      db.privateAccessLink.create({
        data: {
          eventId: event.id,
          verifierHash: privateLinkVerifier(firstProof, verifierKey),
          verifierKeyVersion: verifierKey.version,
        },
      }),
      db.privateAccessLink.create({
        data: {
          eventId: event.id,
          verifierHash: privateLinkVerifier(secondProof, verifierKey),
          verifierKeyVersion: verifierKey.version,
        },
      }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    const active = await db.privateAccessLink.findMany({
      where: { eventId: event.id, revokedAt: null },
    });
    expect(active).toHaveLength(1);
    expect([firstProof, secondProof]).not.toContain(active[0]?.verifierHash);
  });

  it("retains ordinary command outcomes durably for seven days", async () => {
    const { owner, event } = await fixture();
    const now = new Date("2031-05-01T00:00:00.000Z");
    let commandRuns = 0;
    const input = {
      actorUserId: owner.id,
      action: "GATE_CREATE",
      resourceKey: event.id,
      idempotencyKey: randomUUID(),
      request: { if_match: 1 },
      now,
    };
    const command = async (tx: Prisma.TransactionClient) => {
      commandRuns += 1;
      await lockEventForCommand(tx, event.id);
      const gate = await tx.gate.create({ data: { eventId: event.id } });
      return {
        status: 201,
        body: { gate_id: gate.id, event_id: event.id, revision: 1 },
      };
    };

    const first = await executeIdempotentCommand(db, input, command);
    const replayed = await executeIdempotentCommand(db, input, command);
    expect(commandRuns).toBe(1);
    expect(first.replayed).toBe(false);
    expect(replayed).toEqual({ ...first, replayed: true });

    const replay = await db.commandReplay.findFirstOrThrow({
      where: { actorUserId: owner.id, action: "GATE_CREATE" },
    });
    expect(replay.responseBody).toEqual(first.body);
    expect(replay.protectedResponse).toBeNull();
    expect(replay.expiresAt.getTime() - replay.createdAt.getTime()).toBe(
      COMMAND_REPLAY_RETENTION_MS,
    );
  });

  it("settles concurrent commands once and replays encrypted link issuance for 24 hours", async () => {
    const { owner, event } = await fixture();
    const now = new Date("2031-06-10T12:00:00.000Z");
    const idempotencyKey = randomUUID();
    let commandRuns = 0;
    const command = async (tx: Prisma.TransactionClient) => {
      commandRuns += 1;
      expect(await lockEventForCommand(tx, event.id)).toMatchObject({
        revision: 1,
      });
      const proof = generatePrivateLinkProof();
      const link = await issuePrivateAccessLink(tx, {
        eventId: event.id,
        verifierHash: privateLinkVerifier(proof, verifierKey),
        verifierKeyVersion: verifierKey.version,
        issuedAt: now,
      });
      await tx.event.update({
        where: { id: event.id },
        data: { revision: { increment: 1 } },
      });
      await recordAudit(tx, {
        actorKind: AuditActorKind.ACCOUNT,
        actorUserId: owner.id,
        eventId: event.id,
        action: "PRIVATE_LINK_ISSUED",
        outcome: "SUCCEEDED",
        correlationId: randomUUID(),
        metadata: { link_id: link.id },
      });
      return {
        status: 201,
        body: {
          event_id: event.id,
          access_url: `https://events.test/private#access=${proof}`,
          revision: 2,
        },
      };
    };
    const input = {
      actorUserId: owner.id,
      action: "PRIVATE_LINK_ISSUE",
      resourceKey: event.id,
      idempotencyKey,
      request: { if_match: 1 },
      protectedResponseKey: replayKey,
      now,
    };

    const outcomes = await Promise.all([
      executeIdempotentCommand(db, input, command),
      executeIdempotentCommand(db, input, command),
    ]);
    expect(commandRuns).toBe(1);
    expect(outcomes.map(({ replayed }) => replayed).sort()).toEqual([
      false,
      true,
    ]);
    expect(outcomes[0]?.body).toEqual(outcomes[1]?.body);
    expect(outcomes[0]?.body.access_url).toContain("#access=");

    const replay = await db.commandReplay.findFirstOrThrow({
      where: { actorUserId: owner.id, resourceKey: event.id },
    });
    expect(replay.responseBody).toBeNull();
    expect(replay.protectedResponse).not.toBeNull();
    expect(replay.protectedResponseKeyVersion).toBe(replayKey.version);
    expect(replay.protectedReplayExpiresAt!.getTime() - now.getTime()).toBe(
      PROTECTED_REPLAY_RETENTION_MS,
    );
    const rawAccessUrl = outcomes[0]!.body.access_url;
    expect(
      Buffer.from(replay.protectedResponse!).includes(
        Buffer.from(rawAccessUrl),
      ),
    ).toBe(false);
    expect(
      await db.auditEvent.count({
        where: { eventId: event.id, action: "PRIVATE_LINK_ISSUED" },
      }),
    ).toBe(1);
    expect(
      (await db.event.findUniqueOrThrow({ where: { id: event.id } })).revision,
    ).toBe(2);

    await expect(
      executeIdempotentCommand(
        db,
        { ...input, request: { if_match: 1, changed: true } },
        command,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(commandRuns).toBe(1);

    const afterReplayRetention = new Date(
      now.getTime() + PROTECTED_REPLAY_RETENTION_MS + 1,
    );
    await expect(
      executeIdempotentCommand(
        db,
        { ...input, now: afterReplayRetention },
        async () => {
          commandRuns += 1;
          throw new ApiError(409, "VERSION_CONFLICT", "Revision changed");
        },
      ),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(commandRuns).toBe(2);
    expect(
      await db.commandReplay.count({
        where: { actorUserId: owner.id, resourceKey: event.id },
      }),
    ).toBe(0);
    expect(
      await db.privateAccessLink.count({
        where: { eventId: event.id, revokedAt: null },
      }),
    ).toBe(1);
  });

  it("replaces and revokes links atomically without overlapping active rows", async () => {
    const { event } = await fixture();
    const issuedAt = new Date("2032-01-01T00:00:00Z");
    const first = await db.$transaction(async (tx) => {
      await lockEventForCommand(tx, event.id);
      const proof = generatePrivateLinkProof();
      return issuePrivateAccessLink(tx, {
        eventId: event.id,
        verifierHash: privateLinkVerifier(proof, verifierKey),
        verifierKeyVersion: verifierKey.version,
        issuedAt,
      });
    });
    const replacedAt = new Date("2032-01-02T00:00:00Z");
    const replaced = await db.$transaction(async (tx) => {
      await lockEventForCommand(tx, event.id);
      return replacePrivateAccessLink(tx, {
        eventId: event.id,
        verifierHash: privateLinkVerifier(
          generatePrivateLinkProof(),
          verifierKey,
        ),
        verifierKeyVersion: verifierKey.version,
        replacedAt,
      });
    });

    expect(replaced?.previous.id).toBe(first.id);
    expect(replaced?.previous.revokedAt).toEqual(replacedAt);
    expect(replaced?.replacement.replacesLinkId).toBe(first.id);
    expect(
      await db.privateAccessLink.count({
        where: { eventId: event.id, revokedAt: null },
      }),
    ).toBe(1);

    const revokedAt = new Date("2032-01-03T00:00:00Z");
    const revoked = await db.$transaction(async (tx) => {
      await lockEventForCommand(tx, event.id);
      return revokePrivateAccessLink(tx, event.id, revokedAt);
    });
    expect(revoked?.revokedAt).toEqual(revokedAt);
    expect(
      await db.privateAccessLink.count({
        where: { eventId: event.id, revokedAt: null },
      }),
    ).toBe(0);
  });

  it("rolls back mutation and replay state when required audit persistence fails", async () => {
    const { owner, event } = await fixture();
    const triggerSuffix = randomUUID().replaceAll("-", "");
    const functionName = `slice3_test_reject_audit_${triggerSuffix}`;
    const triggerName = `slice3_test_audit_failure_${triggerSuffix}`;
    await db.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW."correlationId" = 'slice3-force-audit-failure' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END; $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "AuditEvent"
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
    try {
      await expect(
        executeIdempotentCommand(
          db,
          {
            actorUserId: owner.id,
            action: "PRIVATE_LINK_ISSUE",
            resourceKey: event.id,
            idempotencyKey: randomUUID(),
            request: { if_match: 1 },
            protectedResponseKey: replayKey,
          },
          async (tx) => {
            await lockEventForCommand(tx, event.id);
            const proof = generatePrivateLinkProof();
            await issuePrivateAccessLink(tx, {
              eventId: event.id,
              verifierHash: privateLinkVerifier(proof, verifierKey),
              verifierKeyVersion: verifierKey.version,
              issuedAt: new Date(),
            });
            await tx.event.update({
              where: { id: event.id },
              data: { revision: { increment: 1 } },
            });
            await recordAudit(tx, {
              actorKind: AuditActorKind.ACCOUNT,
              actorUserId: owner.id,
              eventId: event.id,
              action: "PRIVATE_LINK_ISSUED",
              outcome: "SUCCEEDED",
              correlationId: "slice3-force-audit-failure",
            });
            return {
              status: 201,
              body: { event_id: event.id, access_url: proof, revision: 2 },
            };
          },
        ),
      ).rejects.toThrow();
      expect(
        await db.privateAccessLink.count({ where: { eventId: event.id } }),
      ).toBe(0);
      expect(
        await db.commandReplay.count({ where: { resourceKey: event.id } }),
      ).toBe(0);
      expect(
        (await db.event.findUniqueOrThrow({ where: { id: event.id } }))
          .revision,
      ).toBe(1);
      expect(
        await db.auditEvent.count({
          where: { eventId: event.id, action: "PRIVATE_LINK_ISSUED" },
        }),
      ).toBe(0);
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER "${triggerName}" ON "AuditEvent"`,
      );
      await db.$executeRawUnsafe(`DROP FUNCTION "${functionName}"()`);
    }
  });
});
