import type { EventState } from "@prisma/client";
import type { AuthContext, AuthDependencies } from "../auth/http.js";
import { ApiError, unavailable } from "../auth/errors.js";
import { lockManagementEvent } from "../events/management-command.js";

export function occupancyValues(
  occupied: number,
  registered: number,
  capacity: number | null,
) {
  if (
    !Number.isSafeInteger(occupied) ||
    occupied < 0 ||
    !Number.isSafeInteger(registered) ||
    registered < occupied ||
    (capacity !== null && (!Number.isInteger(capacity) || capacity < 1))
  )
    throw unavailable();
  return {
    occupied,
    registered,
    capacity,
    remaining: capacity === null ? null : capacity - occupied,
    utilization_percentage:
      capacity === null
        ? null
        : Number(((occupied * 100) / capacity).toFixed(2)),
  };
}

export async function operationsSnapshot(
  deps: AuthDependencies,
  actor: AuthContext,
  eventId: string,
  correlationId: string,
) {
  try {
    return await deps.db.$transaction(async (tx) => {
      // Reuse current owner/Admin authority and the existing event -> identity lock
      // order. No capacity admission check or occupancy counter is introduced.
      await lockManagementEvent(tx, actor, eventId);
      const [row] = await tx.$queryRaw<
        {
          event_id: string;
          event_name: string;
          event_state: EventState;
          capacity: number | null;
          registered: bigint;
          occupied: bigint;
          last_attendance_at: Date | null;
          calculated_at: Date;
        }[]
      >`
        SELECT e.id AS event_id, e.name AS event_name, e.state AS event_state,
          e."registrationCapacity" AS capacity, registrations.registered,
          attendance.occupied, attendance.last_attendance_at,
          statement_timestamp() AS calculated_at
        FROM "Event" e
        CROSS JOIN LATERAL (
          SELECT count(*) AS registered FROM "Registration" r
          WHERE r."eventId" = e.id AND r.state = 'REGISTERED'
        ) registrations
        CROSS JOIN LATERAL (
          SELECT count(*) AS occupied, max(a."acceptedAt") AS last_attendance_at
          FROM "AttendanceTransition" a JOIN "Registration" r ON r.id = a."registrationId" AND r."eventId" = a."eventId"
          WHERE a."eventId" = e.id AND a.kind = 'CHECK_IN' AND r.state = 'REGISTERED'
        ) attendance
        WHERE e.id = ${eventId}::uuid
      `;
      if (!row) throw unavailable();
      return {
        event_id: row.event_id,
        event_name: row.event_name,
        event_state: row.event_state,
        ...occupancyValues(
          Number(row.occupied),
          Number(row.registered),
          row.capacity,
        ),
        attendance_state: "INSIDE" as const,
        last_attendance_at: row.last_attendance_at?.toISOString() ?? null,
        calculated_at: row.calculated_at.toISOString(),
        correlation_id: correlationId,
      };
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unavailable();
  }
}
