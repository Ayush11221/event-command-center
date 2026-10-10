import type { AuthContext, AuthDependencies } from "../auth/http.js";
import { lockManagementEvent } from "../events/management-command.js";
import { readOperations } from "../occupancy/service.js";
import { unavailable } from "../auth/errors.js";
import type { ForecastRequest } from "./contract.js";

export async function extractForecast(
  deps: AuthDependencies,
  actor: AuthContext,
  eventId: string,
  correlationId: string,
): Promise<ForecastRequest> {
  return deps.db.$transaction(async (tx) => {
    const { event } = await lockManagementEvent(tx, actor, eventId);
    const snapshot = await readOperations(tx, eventId, correlationId);
    const cutoff = new Date(Date.parse(snapshot.as_of) - 6 * 3600000);
    // Event serialization prevents legitimate attendance/configuration writes
    // between the shared authoritative read and this bounded bucket extraction.
    // Round each accepted occurrence UP to the first minute at which it exists.
    const rows = await tx.$queryRaw<
      {
        first_at: Date | null;
        prior: bigint;
        at: Date | null;
        arrivals: bigint | null;
      }[]
    >`
      WITH accepted AS (
        SELECT a."acceptedAt" AS at, CASE WHEN a.kind = 'CHECK_IN' THEN 1 ELSE -1 END AS change FROM "AttendanceTransition" a
        JOIN "Registration" r ON r.id = a."registrationId" AND r."eventId" = a."eventId"
        WHERE a."eventId" = ${eventId}::uuid
          AND r.state = 'REGISTERED' AND a."acceptedAt" <= ${new Date(snapshot.as_of)}
      ), context AS (
        SELECT min(at) AS first_at, COALESCE(sum(change) FILTER (WHERE at < ${cutoff}), 0)::bigint AS prior FROM accepted
      ), buckets AS (
        SELECT date_trunc('minute', at) + CASE WHEN at = date_trunc('minute', at)
          THEN interval '0' ELSE interval '1 minute' END AS at, sum(change)::bigint AS arrivals
        FROM accepted WHERE at >= ${cutoff} GROUP BY 1
      )
      SELECT context.first_at, context.prior, buckets.at, buckets.arrivals
      FROM context LEFT JOIN buckets ON true ORDER BY buckets.at
    `;
    const observations: ForecastRequest["observations"] = [];
    if (rows[0]?.first_at) {
      let value = Number(rows[0].prior),
        index = 0;
      const start =
        Math.ceil(
          Math.max(rows[0].first_at.getTime(), cutoff.getTime()) / 60000,
        ) * 60000;
      for (let at = start; at <= Date.parse(snapshot.as_of); at += 60000) {
        while (rows[index]?.at && rows[index].at!.getTime() <= at)
          value += Number(rows[index++].arrivals);
        observations.push({
          at: new Date(at).toISOString(),
          value,
          quality: "COMMITTED",
        });
      }
      if (observations.at(-1)?.at !== snapshot.as_of)
        observations.push({
          at: snapshot.as_of,
          value: snapshot.occupied,
          quality: "COMMITTED",
        });
    }
    if (
      observations.length > 361 ||
      (observations.length &&
        observations.at(-1)?.value !== snapshot.occupied) ||
      (!observations.length && snapshot.occupied !== 0)
    )
      throw unavailable();
    return {
      contract_version: 1,
      event_id: snapshot.event_id,
      as_of: snapshot.as_of,
      time_zone: event.timeZone,
      schedule: {
        start_at: event.startAt?.toISOString() ?? null,
        end_at: event.endAt?.toISOString() ?? null,
      },
      occupied: snapshot.occupied,
      capacity: snapshot.capacity,
      revision: snapshot.revision,
      observations,
      horizons: [30, 60],
      method: { name: "persistence", version: "1" },
    };
  });
}
