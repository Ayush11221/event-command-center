import { useEffect, useState } from "react";
import type { OperationsState } from "./useOperations";
import { useForecasts } from "./useForecasts";
import type { ForecastRun } from "../services/forecasting";
import { formatEventTime } from "../services/event-time";
import { humanLabel } from "./event-presentation";
import { ChartSpline, RefreshCw } from "lucide-react";
import { StatusDot } from "../components/common/StatusDot";
import { LiveValue } from "../components/common/LiveValue";

const unavailable: Record<string, string> = {
  INSUFFICIENT_DATA: "Not enough accepted attendance history for evaluation.",
  STALE_INPUT: "The extracted observations were too old to forecast.",
  MODEL_UNAVAILABLE: "The forecasting service is unavailable.",
  INVALID_INPUT: "The forecasting result could not be validated.",
};
export function ForecastPanel({
  eventId,
  operations,
  connection,
  timeZone = null,
  onRun,
}: {
  eventId: string;
  operations: OperationsState;
  connection: string;
  timeZone?: string | null;
  /** Shares the already-fetched run with the occupancy trend (no refetch). */
  onRun?: (run: ForecastRun | null, stale: boolean) => void;
}) {
  const ready = operations.phase === "ready";
  const lost =
    operations.phase === "error" && [401, 403, 404].includes(operations.status);
  const { state, elapsed, refresh } = useForecasts(eventId, ready, lost);
  const response = state.response,
    run = response?.forecast;
  const [notifiedRun, setNotifiedRun] = useState<string | null>(null);
  const notified =
    connection.includes("attendance changed") ||
    connection.includes("revision gap");
  useEffect(() => {
    if (notified && run) setNotifiedRun(run.run_id);
  }, [notified, run]);
  const changed =
    !!run &&
    ((ready &&
      (operations.snapshot.revision !== run.input.revision ||
        operations.snapshot.capacity !== run.input.capacity)) ||
      notified ||
      notifiedRun === run.run_id);
  const expired =
    !!run &&
    !!response &&
    Date.parse(response.as_of) + elapsed >=
      Date.parse(run.freshness.expires_at);
  const stale =
    !!run &&
    run.status === "AVAILABLE" &&
    (run.freshness.state === "STALE" || changed || expired || state.failed);
  useEffect(() => {
    onRun?.(lost ? null : (run ?? null), stale);
  }, [onRun, run, stale, lost]);
  if (lost) return null;
  const forecastTone =
    state.denied || state.failed || (!!run && run.status !== "AVAILABLE")
      ? "degraded"
      : state.loading || !run
        ? "pending"
        : stale
          ? "degraded"
          : "live";
  return (
    <section
      className="forecast-panel ops-panel"
      aria-label="Advisory crowd forecast"
    >
      <div className="ops-panel-title">
        <ChartSpline aria-hidden="true" className="size-5" />
        <h2>Crowd forecast</h2>
      </div>
      <p className="field-help">
        Advisory only. Observed occupancy remains authoritative; forecasts never
        control gate entry.
      </p>
      <p
        className={`notice live-strip live-strip-${forecastTone}`}
        aria-live="polite"
      >
        <StatusDot tone={forecastTone} />
        {state.denied
          ? "Forecast access is unavailable. Confirm your current event access."
          : state.loading
            ? "Loading forecast; occupancy continues independently."
            : !run
              ? state.failed
                ? "Forecast read failed. Refresh to try again."
                : "Waiting for an authorized operations snapshot."
              : run.status !== "AVAILABLE"
                ? `Forecast unavailable. ${unavailable[run.status]}`
                : stale
                  ? `Stale forecast. ${changed ? "Attendance or capacity changed." : state.failed ? "Latest refresh failed." : "Refresh to confirm a current estimate."}`
                  : "Current advisory forecast."}
      </p>
      {run && (
        <p className="freshness">
          Generated: {formatEventTime(run.generated_at, timeZone)}.<br />
          Input observed through: {formatEventTime(run.input.end_at, timeZone)}.
          <br />
          Status: {humanLabel(run.status)}.
        </p>
      )}
      {run?.status === "AVAILABLE" && (
        <>
          <dl className="occupancy-values forecast-points">
            {run.points.map((point) => (
              <div
                key={point.horizon_minutes}
                className={stale ? "forecast-point is-stale" : "forecast-point"}
              >
                <dt>
                  {point.horizon_minutes}-minute prediction
                  {stale ? " (stale)" : ""}
                </dt>
                <dd>
                  <LiveValue value={point.predicted_occupancy} />
                </dd>
                {run.input.capacity !== null && (
                  <dd aria-hidden="true" className="forecast-band">
                    <span
                      className="forecast-band-range"
                      style={{
                        left: `${Math.min(100, (point.uncertainty.lower * 100) / run.input.capacity)}%`,
                        width: `${Math.max(1, Math.min(100, (point.uncertainty.upper * 100) / run.input.capacity) - Math.min(100, (point.uncertainty.lower * 100) / run.input.capacity))}%`,
                      }}
                    />
                    <span
                      className="forecast-band-point"
                      style={{
                        left: `${Math.min(100, (point.predicted_occupancy * 100) / run.input.capacity)}%`,
                      }}
                    />
                  </dd>
                )}
                <dd className="forecast-context">
                  Empirical interval: {point.uncertainty.lower}–
                  {point.uncertainty.upper}
                </dd>
                <dd className="forecast-context">
                  Target: {formatEventTime(point.target_at, timeZone)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="field-help">
            Persistence baseline only; check-in-only history contains no
            departures. The 90% nominal interval is a calibration target, not an
            accuracy guarantee.
          </p>
          <details className="advanced-details">
            <summary>Retrospective evaluation</summary>
            <p>
              Chronological training, validation and held-out test ranges.
              Validation residuals set the interval; future operational outcomes
              are unknown.
            </p>
            {run.evaluation && (
              <>
                {(["training", "validation", "test"] as const).map((name) => (
                  <p key={name}>
                    {name}:{" "}
                    {formatEventTime(
                      run.evaluation!.split[name].start_at,
                      timeZone,
                    )}{" "}
                    –{" "}
                    {formatEventTime(
                      run.evaluation!.split[name].end_at,
                      timeZone,
                    )}
                  </p>
                ))}
                {run.evaluation.horizons.map((metric) => (
                  <p key={metric.horizon_minutes}>
                    {metric.horizon_minutes} minutes: {metric.samples} test
                    origins; MAE {metric.mae.toFixed(2)}, RMSE{" "}
                    {metric.rmse.toFixed(2)}. Baseline MAE{" "}
                    {metric.baseline_mae.toFixed(2)}, RMSE{" "}
                    {metric.baseline_rmse.toFixed(2)}. Measured interval
                    coverage {(metric.interval_coverage * 100).toFixed(1)}%;
                    availability{" "}
                    {(metric.availability_coverage * 100).toFixed(1)}%.
                  </p>
                ))}
              </>
            )}
            <p>No production accuracy or usefulness claim.</p>
          </details>
        </>
      )}
      <button
        type="button"
        className="secondary-button"
        onClick={refresh}
        disabled={!ready || state.loading || state.denied}
      >
        <RefreshCw aria-hidden="true" className="size-4" />
        Refresh forecast
      </button>
    </section>
  );
}
