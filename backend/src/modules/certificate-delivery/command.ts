import { Prisma } from "@prisma/client";
import { ApiError } from "../auth/errors.js";
import type { AuthContext, AuthDependencies } from "../auth/http.js";
import { staffScope } from "../certificates/access.js";
import {
  idempotencyKeyHash,
  requestFingerprint,
  COMMAND_REPLAY_RETENTION_MS,
} from "../events/command-safety.js";

export async function durableCommand(
  deps: AuthDependencies,
  actor: AuthContext,
  eventId: string,
  action: string,
  key: string,
  request: object,
  execute: (
    tx: Prisma.TransactionClient,
    replayId: string,
  ) => Promise<{ status: number; body: Record<string, unknown> }>,
) {
  return deps.db.$transaction(
    async (tx) => {
      await staffScope(tx, actor, eventId);
      const hash = idempotencyKeyHash(key),
        fingerprint = requestFingerprint(request);
      const previous = await tx.commandReplay.findFirst({
        where: {
          actorUserId: actor.userId,
          action,
          resourceKey: eventId,
          idempotencyKeyHash: hash,
        },
      });
      if (previous) {
        if (previous.requestFingerprint !== fingerprint)
          throw new ApiError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Command differs from the accepted operation",
          );
        if (previous.expiresAt <= new Date())
          throw new ApiError(
            410,
            action === "CERTIFICATE_BATCH"
              ? "BATCH_REPLAY_EXPIRED"
              : "DELIVERY_REPLAY_EXPIRED",
            "Inspect the original operation status",
          );
        return {
          status: previous.responseStatus!,
          body: previous.responseBody as Record<string, unknown>,
        };
      }
      const replay = await tx.commandReplay.create({
        data: {
          actorUserId: actor.userId,
          action,
          resourceKey: eventId,
          idempotencyKeyHash: hash,
          requestFingerprint: fingerprint,
          expiresAt: new Date(Date.now() + COMMAND_REPLAY_RETENTION_MS),
        },
      });
      const result = await execute(tx, replay.id);
      await tx.commandReplay.update({
        where: { id: replay.id },
        data: {
          status: "COMPLETED",
          responseStatus: result.status,
          responseBody: result.body as Prisma.InputJsonObject,
          completedAt: new Date(),
        },
      });
      return result;
    },
    { maxWait: 2000, timeout: 5000 },
  );
}
