import { EventApiError, type ManagementEvent } from "./events";

export interface OperationsSnapshot {
  event_id: string;
  event_name: string;
  event_state: ManagementEvent["state"];
  occupied: number;
  registered: number;
  capacity: number | null;
  remaining: number | null;
  utilization_percentage: number | null;
  attendance_state: "INSIDE";
  last_attendance_at: string | null;
  calculated_at: string;
  correlation_id: string;
  revision: number;
  as_of: string;
}
export async function getOperations(
  eventId: string,
  signal: AbortSignal,
): Promise<OperationsSnapshot> {
  const origin = import.meta.env.VITE_API_ORIGIN;
  if (!origin) throw new EventApiError("NETWORK", 0);
  const controller = new AbortController(),
    abort = () => controller.abort();
  if (signal.aborted) abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15000);
  try {
    const response = await fetch(
      new URL(
        `/api/v1/events/${encodeURIComponent(eventId)}/operations`,
        origin,
      ),
      {
        credentials: "include",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      },
    );
    const body = (await response.json()) as OperationsSnapshot;
    if (!response.ok) {
      const error = body as unknown as {
        code?: string;
        correlation_id?: string;
      };
      throw new EventApiError(
        error?.code ?? "UNKNOWN",
        response.status,
        error?.correlation_id,
      );
    }
    const expectedRemaining =
      body?.capacity === null ? null : body?.capacity - body?.occupied;
    const expectedUtilization =
      body?.capacity === null
        ? null
        : Number(((body?.occupied * 100) / body?.capacity).toFixed(2));
    if (
      !body ||
      typeof body.event_id !== "string" ||
      body.event_id.toLowerCase() !== eventId.toLowerCase() ||
      typeof body.event_name !== "string" ||
      !["DRAFT", "PUBLISHED", "LIVE", "COMPLETED", "CANCELLED"].includes(
        body.event_state,
      ) ||
      body.attendance_state !== "INSIDE" ||
      !Number.isSafeInteger(body.occupied) ||
      body.occupied < 0 ||
      !Number.isSafeInteger(body.registered) ||
      body.registered < body.occupied ||
      (body.capacity !== null &&
        (!Number.isInteger(body.capacity) || body.capacity < 1)) ||
      body.remaining !== expectedRemaining ||
      body.utilization_percentage !== expectedUtilization ||
      typeof body.calculated_at !== "string" ||
      !Number.isFinite(Date.parse(body.calculated_at)) ||
      typeof body.correlation_id !== "string" ||
      !Number.isSafeInteger(body.revision) ||
      body.revision < 0 ||
      typeof body.as_of !== "string" ||
      body.as_of !== body.calculated_at ||
      (body.last_attendance_at !== null &&
        (typeof body.last_attendance_at !== "string" ||
          !Number.isFinite(Date.parse(body.last_attendance_at))))
    )
      throw new EventApiError("INVALID_RESPONSE", 0);
    return {
      event_id: body.event_id,
      event_name: body.event_name,
      event_state: body.event_state,
      occupied: body.occupied,
      registered: body.registered,
      capacity: body.capacity,
      remaining: body.remaining,
      utilization_percentage: body.utilization_percentage,
      attendance_state: body.attendance_state,
      last_attendance_at: body.last_attendance_at,
      calculated_at: body.calculated_at,
      correlation_id: body.correlation_id,
      revision: body.revision,
      as_of: body.as_of,
    };
  } catch (error) {
    if (error instanceof EventApiError) throw error;
    throw new EventApiError("NETWORK", 0);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}
