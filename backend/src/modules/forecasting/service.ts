import type { Prisma } from "@prisma/client";
import type { AuthContext, AuthDependencies } from "../auth/http.js";
import { ApiError, unavailable } from "../auth/errors.js";
import { lockManagementEvent } from "../events/management-command.js";
import { readOperations } from "../occupancy/service.js";
import { extractForecast } from "./source.js";
import { callForecast } from "./client.js";
import {
  keys,
  timestamp,
  validResult,
  type ForecastResult,
} from "./contract.js";

type Observed = Pick<
  Awaited<ReturnType<typeof readOperations>>,
  "occupied" | "capacity" | "attendance_state" | "revision" | "as_of"
>;
export function observed(
  snapshot: Awaited<ReturnType<typeof readOperations>>,
): Observed {
  return {
    occupied: snapshot.occupied,
    capacity: snapshot.capacity,
    attendance_state: snapshot.attendance_state,
    revision: snapshot.revision,
    as_of: snapshot.as_of,
  };
}
export function freshness(result: ForecastResult, snapshot: Observed) {
  const expires_at = new Date(
    Date.parse(result.generated_at) + 60000,
  ).toISOString();
  if (result.status !== "AVAILABLE")
    return { state: "UNAVAILABLE" as const, reason: result.status, expires_at };
  if (
    result.input.revision !== snapshot.revision ||
    result.input.capacity !== snapshot.capacity
  )
    return {
      state: "STALE" as const,
      reason: "OBSERVATIONS_CHANGED" as const,
      expires_at,
    };
  if (Date.parse(snapshot.as_of) >= Date.parse(expires_at))
    return {
      state: "STALE" as const,
      reason: "AGE_EXCEEDED" as const,
      expires_at,
    };
  return { state: "CURRENT" as const, reason: null, expires_at };
}
function serialize(
  row: { id: string; eventId: string; persistedAt: Date; result: unknown },
  snapshot: Observed,
) {
  if (
    !validResult(row.result, row.eventId) ||
    row.persistedAt.getTime() < Date.parse(row.result.generated_at) ||
    row.persistedAt.getTime() > Date.parse(snapshot.as_of)
  )
    throw unavailable();
  return {
    run_id: row.id,
    ...row.result,
    persisted_at: row.persistedAt.toISOString(),
    freshness: freshness(row.result, snapshot),
  };
}

export async function currentForecast(
  deps: AuthDependencies,
  actor: AuthContext,
  eventId: string,
  correlationId: string,
) {
  const request = await extractForecast(deps, actor, eventId, correlationId);
  const result = await callForecast(deps.config, request); // No attendance lock during network I/O.
  return deps.db.$transaction(async (tx) => {
    await lockManagementEvent(tx, actor, eventId); // Session/assignment may have been revoked meanwhile.
    if (!validResult(result, eventId)) throw unavailable();
    const row = await tx.forecastRun.create({
      data: { eventId, result: result as unknown as Prisma.InputJsonValue },
    });
    const snapshot = observed(await readOperations(tx, eventId, correlationId));
    return {
      event_id: eventId,
      observed: snapshot,
      forecast: serialize(row, snapshot),
      as_of: snapshot.as_of,
      correlation_id: correlationId,
    };
  });
}

interface Cursor {
  version: 1;
  event_id: string;
  persisted_at: string;
  run_id: string;
}
export function historyParameters(
  query: Record<string, unknown>,
  eventId: string,
) {
  const invalid = () =>
    new ApiError(400, "VALIDATION", "Invalid forecast history parameters");
  if (Object.keys(query).some((key) => key !== "cursor" && key !== "limit"))
    throw invalid();
  const limit =
    query.limit === undefined
      ? 20
      : typeof query.limit === "string" && /^[1-9]\d{0,2}$/.test(query.limit)
        ? Number(query.limit)
        : 0;
  if (limit < 1 || limit > 100) throw invalid();
  let cursor: Cursor | undefined;
  if (query.cursor !== undefined) {
    if (
      typeof query.cursor !== "string" ||
      !/^[A-Za-z0-9_-]{1,512}$/.test(query.cursor)
    )
      throw invalid();
    try {
      const decoded: unknown = JSON.parse(
        Buffer.from(query.cursor, "base64url").toString(),
      );
      if (
        Buffer.from(query.cursor, "base64url").toString("base64url") !==
        query.cursor
      )
        throw invalid();
      if (
        !keys(decoded, "version,event_id,persisted_at,run_id") ||
        decoded.version !== 1 ||
        decoded.event_id !== eventId ||
        !timestamp(decoded.persisted_at) ||
        typeof decoded.run_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          decoded.run_id,
        )
      )
        throw invalid();
      cursor = decoded as unknown as Cursor;
    } catch {
      throw invalid();
    }
  }
  return { limit, cursor };
}
export async function forecastHistory(
  deps: AuthDependencies,
  actor: AuthContext,
  eventId: string,
  query: Record<string, unknown>,
  correlationId: string,
) {
  return deps.db.$transaction(async (tx) => {
    await lockManagementEvent(tx, actor, eventId);
    const { limit, cursor } = historyParameters(query, eventId);
    const rows = await tx.forecastRun.findMany({
      where: {
        eventId,
        ...(cursor
          ? {
              OR: [
                { persistedAt: { lt: new Date(cursor.persisted_at) } },
                {
                  persistedAt: new Date(cursor.persisted_at),
                  id: { lt: cursor.run_id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ persistedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const snapshot = observed(await readOperations(tx, eventId, correlationId));
    const selected = rows.slice(0, limit),
      last = selected.at(-1);
    const next_cursor =
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({
              version: 1,
              event_id: eventId,
              persisted_at: last.persistedAt.toISOString(),
              run_id: last.id,
            }),
          ).toString("base64url")
        : null;
    return {
      event_id: eventId,
      observed: snapshot,
      items: selected.map((row) => serialize(row, snapshot)),
      next_cursor,
      as_of: snapshot.as_of,
      correlation_id: correlationId,
    };
  });
}
