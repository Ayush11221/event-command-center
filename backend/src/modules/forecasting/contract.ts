export const METHOD = {
  name: "persistence",
  version: "1",
  baseline_name: "persistence",
  baseline_version: "1",
} as const;
export const LIMITATIONS = [
  "BASELINE_ONLY",
  "CHECK_IN_ONLY",
  "EMPIRICAL_UNCERTAINTY",
  "NO_PRODUCTION_ACCURACY_CLAIM",
];
export const STATUSES = [
  "AVAILABLE",
  "INSUFFICIENT_DATA",
  "STALE_INPUT",
  "MODEL_UNAVAILABLE",
  "INVALID_INPUT",
] as const;
export type ForecastStatus = (typeof STATUSES)[number];
export interface ForecastInput {
  start_at: string | null;
  end_at: string;
  last_observation_at: string | null;
  observation_count: number;
  revision: number;
  occupied: number;
  capacity: number | null;
}
export interface ForecastPoint {
  horizon_minutes: 30 | 60;
  target_at: string;
  predicted_occupancy: number;
  uncertainty: {
    method: "validation_residual_quantile";
    nominal_coverage: 0.9;
    lower: number;
    upper: number;
  };
}
export interface EvaluationHorizon {
  horizon_minutes: 30 | 60;
  samples: number;
  mae: number;
  rmse: number;
  baseline_mae: number;
  baseline_rmse: number;
  interval_coverage: number;
  availability_coverage: number;
}
export interface ForecastEvaluation {
  kind: "BASELINE_ONLY";
  split: Record<
    "training" | "validation" | "test",
    { start_at: string; end_at: string }
  >;
  horizons: EvaluationHorizon[];
}
export interface ForecastResult {
  contract_version: 1;
  event_id: string;
  status: ForecastStatus;
  generated_at: string;
  input: ForecastInput;
  method: typeof METHOD;
  points: ForecastPoint[];
  evaluation: ForecastEvaluation | null;
  limitations: string[];
}
export interface ForecastRequest {
  contract_version: 1;
  event_id: string;
  as_of: string;
  time_zone: string | null;
  schedule: { start_at: string | null; end_at: string | null };
  occupied: number;
  capacity: number | null;
  revision: number;
  observations: { at: string; value: number; quality: "COMMITTED" }[];
  horizons: [30, 60];
  method: { name: "persistence"; version: "1" };
}
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function keys(
  value: unknown,
  names: string,
): value is Record<string, unknown> {
  return (
    record(value) &&
    Object.keys(value).sort().join(",") === names.split(",").sort().join(",")
  );
}
export const timestamp = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
export const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const number = (v: unknown): v is number =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  v >= 0 &&
  v <= Number.MAX_SAFE_INTEGER;
const fraction = (v: unknown): v is number => number(v) && v <= 1;

export function inputFor(request: ForecastRequest): ForecastInput {
  return {
    start_at: request.observations[0]?.at ?? null,
    end_at: request.as_of,
    last_observation_at: request.observations.at(-1)?.at ?? null,
    observation_count: request.observations.length,
    revision: request.revision,
    occupied: request.occupied,
    capacity: request.capacity,
  };
}
export function fallback(
  request: ForecastRequest,
  status: Exclude<ForecastStatus, "AVAILABLE">,
): ForecastResult {
  return {
    contract_version: 1,
    event_id: request.event_id,
    status,
    generated_at: new Date().toISOString(),
    input: inputFor(request),
    method: METHOD,
    points: [],
    evaluation: null,
    limitations: [...LIMITATIONS],
  };
}
export function validResult(
  value: unknown,
  eventId: string,
): value is ForecastResult {
  if (
    !keys(
      value,
      "contract_version,event_id,status,generated_at,input,method,points,evaluation,limitations",
    ) ||
    value.contract_version !== 1 ||
    value.event_id !== eventId ||
    !STATUSES.includes(value.status as ForecastStatus) ||
    !timestamp(value.generated_at) ||
    !keys(
      value.input,
      "start_at,end_at,last_observation_at,observation_count,revision,occupied,capacity",
    ) ||
    !keys(value.method, "name,version,baseline_name,baseline_version") ||
    Object.entries(METHOD).some(
      ([key, v]) => (value.method as Record<string, unknown>)[key] !== v,
    ) ||
    !Array.isArray(value.points) ||
    !Array.isArray(value.limitations) ||
    value.limitations.length !== 4 ||
    new Set(value.limitations).size !== 4 ||
    value.limitations.some((v) => !LIMITATIONS.includes(v))
  )
    return false;
  const input = value.input;
  if (
    !timestamp(input.end_at) ||
    !count(input.observation_count) ||
    input.observation_count > 361 ||
    !count(input.revision) ||
    !count(input.occupied) ||
    input.occupied !== input.revision ||
    (input.capacity !== null &&
      (!count(input.capacity) || input.capacity < 1)) ||
    Date.parse(input.end_at) > Date.parse(value.generated_at)
  )
    return false;
  if (input.observation_count === 0) {
    if (
      input.start_at !== null ||
      input.last_observation_at !== null ||
      input.occupied !== 0
    )
      return false;
  } else if (
    !timestamp(input.start_at) ||
    !timestamp(input.last_observation_at) ||
    input.last_observation_at !== input.end_at ||
    Date.parse(input.start_at) > Date.parse(input.end_at) ||
    Date.parse(input.end_at) - Date.parse(input.start_at) > 21600000
  )
    return false;
  if (value.status !== "AVAILABLE")
    return value.points.length === 0 && value.evaluation === null;
  if (
    input.observation_count < 270 ||
    value.points.length !== 2 ||
    !keys(value.evaluation, "kind,split,horizons") ||
    value.evaluation.kind !== "BASELINE_ONLY" ||
    !keys(value.evaluation.split, "training,validation,test") ||
    !Array.isArray(value.evaluation.horizons) ||
    value.evaluation.horizons.length !== 2
  )
    return false;
  if (Date.parse(value.generated_at) - Date.parse(input.end_at) > 60000)
    return false;
  const start = Date.parse(input.start_at as string),
    end = Date.parse(input.end_at);
  const regularCount = Math.floor(end / 60000) - start / 60000 + 1;
  if (
    !Number.isInteger(regularCount) ||
    regularCount < 270 ||
    input.observation_count !== regularCount + (end % 60000 === 0 ? 0 : 1)
  )
    return false;
  const boundaries = [
    0,
    Math.floor(regularCount / 3),
    Math.floor((2 * regularCount) / 3),
    regularCount,
  ];
  let previous = -Infinity;
  for (const [index, name] of ["training", "validation", "test"].entries()) {
    const range = value.evaluation.split[name];
    if (
      !keys(range, "start_at,end_at") ||
      !timestamp(range.start_at) ||
      !timestamp(range.end_at) ||
      Date.parse(range.start_at) <= previous ||
      Date.parse(range.end_at) < Date.parse(range.start_at) ||
      Date.parse(range.start_at) < Date.parse(input.start_at as string) ||
      Date.parse(range.end_at) > Date.parse(input.end_at)
    )
      return false;
    previous = Date.parse(range.end_at);
    if (
      Date.parse(range.start_at) !== start + boundaries[index] * 60000 ||
      Date.parse(range.end_at) !== start + (boundaries[index + 1] - 1) * 60000
    )
      return false;
  }
  for (const [index, horizon] of [30, 60].entries()) {
    const point: unknown = value.points[index],
      metric: unknown = value.evaluation.horizons[index];
    if (
      !keys(
        point,
        "horizon_minutes,target_at,predicted_occupancy,uncertainty",
      ) ||
      point.horizon_minutes !== horizon ||
      !timestamp(point.target_at) ||
      Date.parse(point.target_at) !==
        Date.parse(input.end_at) + horizon * 60000 ||
      !number(point.predicted_occupancy) ||
      point.predicted_occupancy !== input.occupied ||
      !keys(point.uncertainty, "method,nominal_coverage,lower,upper") ||
      point.uncertainty.method !== "validation_residual_quantile" ||
      point.uncertainty.nominal_coverage !== 0.9 ||
      !number(point.uncertainty.lower) ||
      !number(point.uncertainty.upper) ||
      point.uncertainty.lower > point.predicted_occupancy ||
      point.uncertainty.upper < point.predicted_occupancy ||
      !keys(
        metric,
        "horizon_minutes,samples,mae,rmse,baseline_mae,baseline_rmse,interval_coverage,availability_coverage",
      ) ||
      metric.horizon_minutes !== horizon ||
      !count(metric.samples) ||
      metric.samples < 1 ||
      !number(metric.mae) ||
      !number(metric.rmse) ||
      metric.rmse < metric.mae ||
      metric.baseline_mae !== metric.mae ||
      metric.baseline_rmse !== metric.rmse ||
      !fraction(metric.interval_coverage) ||
      !fraction(metric.availability_coverage)
    )
      return false;
    if (
      metric.samples !== regularCount - boundaries[2] - horizon ||
      metric.availability_coverage !== 1
    )
      return false;
  }
  return true;
}
