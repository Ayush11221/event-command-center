import { accountFetch } from "./account-session";
import { EventApiError } from "./events";

export interface ForecastRun {
  run_id: string;
  event_id: string;
  contract_version: 1;
  status:
    | "AVAILABLE"
    | "INSUFFICIENT_DATA"
    | "STALE_INPUT"
    | "MODEL_UNAVAILABLE"
    | "INVALID_INPUT";
  generated_at: string;
  persisted_at: string;
  input: {
    start_at: string | null;
    end_at: string;
    last_observation_at: string | null;
    observation_count: number;
    revision: number;
    occupied: number;
    capacity: number | null;
  };
  method: {
    name: "persistence";
    version: "1";
    baseline_name: "persistence";
    baseline_version: "1";
  };
  points: {
    horizon_minutes: 30 | 60;
    target_at: string;
    predicted_occupancy: number;
    uncertainty: {
      method: "validation_residual_quantile";
      nominal_coverage: 0.9;
      lower: number;
      upper: number;
    };
  }[];
  evaluation: null | {
    kind: "BASELINE_ONLY";
    split: Record<
      "training" | "validation" | "test",
      { start_at: string; end_at: string }
    >;
    horizons: {
      horizon_minutes: 30 | 60;
      samples: number;
      mae: number;
      rmse: number;
      baseline_mae: number;
      baseline_rmse: number;
      interval_coverage: number;
      availability_coverage: number;
    }[];
  };
  limitations: string[];
  freshness: {
    state: "CURRENT" | "STALE" | "UNAVAILABLE";
    reason: string | null;
    expires_at: string;
  };
}
export interface ForecastCurrent {
  event_id: string;
  observed: {
    occupied: number;
    capacity: number | null;
    attendance_state: "INSIDE";
    revision: number;
    as_of: string;
  };
  forecast: ForecastRun;
  as_of: string;
  correlation_id: string;
}
const stamp = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const finite = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= Number.MAX_SAFE_INTEGER;
const capacity = (value: unknown) =>
  value === null || (count(value) && value >= 1);
const closed = (
  value: unknown,
  fields: string,
): value is Record<string, unknown> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === fields.split(",").sort().join(",");
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function validCurrent(
  value: unknown,
  eventId: string,
): value is ForecastCurrent {
  if (
    !closed(value, "event_id,observed,forecast,as_of,correlation_id") ||
    !uuid(value.event_id) ||
    value.event_id !== eventId.toLowerCase() ||
    !stamp(value.as_of) ||
    typeof value.correlation_id !== "string"
  )
    return false;
  const observed = value.observed,
    run = value.forecast;
  if (
    !closed(observed, "occupied,capacity,attendance_state,revision,as_of") ||
    !count(observed.occupied) ||
    !count(observed.revision) ||
    !capacity(observed.capacity) ||
    observed.attendance_state !== "INSIDE" ||
    observed.as_of !== value.as_of ||
    !closed(
      run,
      "run_id,event_id,contract_version,status,generated_at,persisted_at,input,method,points,evaluation,limitations,freshness",
    ) ||
    !uuid(run.run_id) ||
    run.event_id !== value.event_id ||
    run.contract_version !== 1 ||
    !stamp(run.generated_at) ||
    !stamp(run.persisted_at) ||
    Date.parse(run.generated_at) > Date.parse(run.persisted_at) ||
    Date.parse(run.persisted_at) > Date.parse(value.as_of)
  )
    return false;
  const input = run.input,
    method = run.method,
    fresh = run.freshness;
  if (
    !closed(
      input,
      "start_at,end_at,last_observation_at,observation_count,revision,occupied,capacity",
    ) ||
    !stamp(input.end_at) ||
    Date.parse(input.end_at) > Date.parse(run.generated_at) ||
    !count(input.observation_count) ||
    input.observation_count > 361 ||
    !count(input.revision) ||
    !count(input.occupied) ||
    !capacity(input.capacity) ||
    (input.observation_count === 0
      ? input.start_at !== null || input.last_observation_at !== null
      : !stamp(input.start_at) ||
        input.last_observation_at !== input.end_at ||
        Date.parse(input.start_at) > Date.parse(input.end_at)) ||
    !closed(method, "name,version,baseline_name,baseline_version") ||
    method.name !== "persistence" ||
    method.baseline_name !== "persistence" ||
    method.version !== "1" ||
    method.baseline_version !== "1" ||
    !Array.isArray(run.points) ||
    !Array.isArray(run.limitations) ||
    run.limitations.length !== 4 ||
    new Set(run.limitations).size !== 4 ||
    run.limitations.some(
      (code) =>
        ![
          "BASELINE_ONLY",
          "CHECK_IN_ONLY",
          "EMPIRICAL_UNCERTAINTY",
          "NO_PRODUCTION_ACCURACY_CLAIM",
        ].includes(code),
    ) ||
    !closed(fresh, "state,reason,expires_at") ||
    !stamp(fresh.expires_at) ||
    Date.parse(fresh.expires_at) !== Date.parse(run.generated_at) + 60000
  )
    return false;
  if (run.status !== "AVAILABLE")
    return (
      [
        "INSUFFICIENT_DATA",
        "STALE_INPUT",
        "MODEL_UNAVAILABLE",
        "INVALID_INPUT",
      ].includes(String(run.status)) &&
      run.points.length === 0 &&
      run.evaluation === null &&
      fresh.state === "UNAVAILABLE" &&
      fresh.reason === run.status
    );
  const reason =
    input.revision !== observed.revision || input.capacity !== observed.capacity
      ? "OBSERVATIONS_CHANGED"
      : Date.parse(value.as_of) >= Date.parse(fresh.expires_at)
        ? "AGE_EXCEEDED"
        : null;
  if (
    fresh.state !== (reason ? "STALE" : "CURRENT") ||
    fresh.reason !== reason ||
    run.points.length !== 2 ||
    !closed(run.evaluation, "kind,split,horizons") ||
    run.evaluation.kind !== "BASELINE_ONLY" ||
    !closed(run.evaluation.split, "training,validation,test") ||
    !Array.isArray(run.evaluation.horizons) ||
    run.evaluation.horizons.length !== 2
  )
    return false;
  let previous = -Infinity;
  for (const name of ["training", "validation", "test"]) {
    const range = run.evaluation.split[name];
    if (
      !closed(range, "start_at,end_at") ||
      !stamp(range.start_at) ||
      !stamp(range.end_at) ||
      Date.parse(range.start_at) <= previous ||
      Date.parse(range.end_at) < Date.parse(range.start_at)
    )
      return false;
    previous = Date.parse(range.end_at);
  }
  const points = run.points,
    metrics = run.evaluation.horizons;
  return [30, 60].every((horizon, index) => {
    const point = points[index],
      metric = metrics[index];
    return (
      closed(
        point,
        "horizon_minutes,target_at,predicted_occupancy,uncertainty",
      ) &&
      point.horizon_minutes === horizon &&
      stamp(point.target_at) &&
      Date.parse(point.target_at) ===
        Date.parse(input.end_at as string) + horizon * 60000 &&
      finite(point.predicted_occupancy) &&
      point.predicted_occupancy === input.occupied &&
      closed(point.uncertainty, "method,nominal_coverage,lower,upper") &&
      point.uncertainty.method === "validation_residual_quantile" &&
      point.uncertainty.nominal_coverage === 0.9 &&
      finite(point.uncertainty.lower) &&
      finite(point.uncertainty.upper) &&
      point.uncertainty.lower <= point.predicted_occupancy &&
      point.uncertainty.upper >= point.predicted_occupancy &&
      closed(
        metric,
        "horizon_minutes,samples,mae,rmse,baseline_mae,baseline_rmse,interval_coverage,availability_coverage",
      ) &&
      metric.horizon_minutes === horizon &&
      count(metric.samples) &&
      metric.samples > 0 &&
      finite(metric.mae) &&
      finite(metric.rmse) &&
      metric.baseline_mae === metric.mae &&
      metric.baseline_rmse === metric.rmse &&
      finite(metric.interval_coverage) &&
      metric.interval_coverage <= 1 &&
      finite(metric.availability_coverage) &&
      metric.availability_coverage <= 1
    );
  });
}

export async function getCurrentForecast(
  eventId: string,
  signal: AbortSignal,
): Promise<ForecastCurrent> {
  const origin = import.meta.env.VITE_API_ORIGIN;
  if (!origin) throw new EventApiError("NETWORK", 0);
  const controller = new AbortController(),
    abort = () => controller.abort();
  if (signal.aborted) abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15000);
  try {
    const response = await accountFetch(
      new URL(
        `/api/v1/events/${encodeURIComponent(eventId)}/forecasts/current`,
        origin,
      ),
      {
        credentials: "include",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      },
    );
    const body: unknown = await response.json();
    if (!response.ok) {
      const error = body as { code?: string; correlation_id?: string } | null;
      throw new EventApiError(
        error?.code ?? "UNKNOWN",
        response.status,
        error?.correlation_id,
      );
    }
    if (!validCurrent(body, eventId))
      throw new EventApiError("INVALID_RESPONSE", 0);
    return body;
  } catch (error) {
    if (error instanceof EventApiError) throw error;
    throw new EventApiError("NETWORK", 0);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}
