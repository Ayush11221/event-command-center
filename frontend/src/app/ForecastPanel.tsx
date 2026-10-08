import { useEffect, useState } from "react";
import type { OperationsState } from "./useOperations";
import { useForecasts } from "./useForecasts";
import { formatEventTime } from "../services/event-time";
import { humanLabel } from "./event-presentation";

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
}: {
  eventId: string;
  operations: OperationsState;
  connection: string;
  timeZone?: string | null;
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
  if (lost) return null;
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
  return (
    <section className="forecast-panel" aria-label="Advisory crowd forecast">
      <h2>Crowd forecast</h2>
      <p>
        Advisory only. Observed occupancy remains authoritative; forecasts never
        control gate entry.
      </p>
      <p className="notice" aria-live="polite">
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
          <dl className="occupancy-values">
            {run.points.map((point) => (
              <div key={point.horizon_minutes}>
                <dt>
                  {point.horizon_minutes}-minute prediction
                  {stale ? " (stale)" : ""}
                </dt>
                <dd>{point.predicted_occupancy}</dd>
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
          <p>
            Persistence baseline only; check-in-only history contains no
            departures. The 90% nominal interval is a calibration target, not an
            accuracy guarantee.
          </p>
          <details>
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
        onClick={refresh}
        disabled={!ready || state.loading || state.denied}
      >
        Refresh forecast
      </button>
    </section>
  );
}
