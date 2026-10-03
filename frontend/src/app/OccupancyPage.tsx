import { useState } from "react";
import { useOperations } from "./useOperations";
import { ForecastPanel } from "./ForecastPanel";
export function OccupancyPage({ eventId }: { eventId: string }) {
  const [attempt, setAttempt] = useState(0);
  const { state, connection } = useOperations(eventId, attempt);
  const snapshot = state.phase === "ready" ? state.snapshot : null;
  const over =
    snapshot !== null &&
    snapshot.capacity !== null &&
    snapshot.occupied > snapshot.capacity;
  return (
    <main className="page-shell operations-page">
      <a href="/">Back to event workspace</a>
      <h1>Attendance &amp; occupancy</h1>
      <p className="notice" aria-live="polite">
        {connection}
      </p>
      {state.phase === "loading" ? (
        <p role="status" className="notice">
          Loading occupancy snapshot...
        </p>
      ) : state.phase === "error" ? (
        <section className="notice" role="alert">
          <p>{state.message}</p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry operations read
          </button>
        </section>
      ) : (
        <section aria-label="Event occupancy">
          <h2>{state.snapshot.event_name}</h2>
          <p>
            Lifecycle: {state.snapshot.event_state}. Occupancy counts
            registrations currently INSIDE from accepted check-ins.
          </p>
          <dl className="occupancy-values">
            <div>
              <dt>Currently inside</dt>
              <dd>{state.snapshot.occupied}</dd>
            </div>
            <div>
              <dt>Configured registration capacity</dt>
              <dd>{state.snapshot.capacity ?? "Not configured"}</dd>
            </div>
            <div>
              <dt>Remaining relative to capacity</dt>
              <dd>{state.snapshot.remaining ?? "Unavailable"}</dd>
            </div>
            <div>
              <dt>Utilization</dt>
              <dd>
                {state.snapshot.utilization_percentage === null
                  ? "Unavailable"
                  : state.snapshot.utilization_percentage + "%"}
              </dd>
            </div>
            <div>
              <dt>Active registrations</dt>
              <dd>{state.snapshot.registered}</dd>
            </div>
          </dl>
          <p className="notice">
            {over
              ? "Above configured registration capacity. This is a factual occupancy state; valid registered participants may still check in."
              : state.snapshot.capacity !== null &&
                  state.snapshot.occupied === state.snapshot.capacity
                ? "At configured registration capacity. This does not block valid check-ins."
                : state.snapshot.capacity === null
                  ? "Registration capacity is not configured; capacity comparison is unavailable."
                  : state.snapshot.occupied === 0
                    ? "No accepted check-ins recorded."
                    : "Below configured registration capacity."}
          </p>
          <p>
            Registration capacity is a registration limit, not a gate-entry
            ceiling.
          </p>
          <p className="freshness">
            Revision: {state.snapshot.revision}.<br />
            Confirmed as of: {new Date(state.snapshot.as_of).toLocaleString()}.
            <br />
            Calculated:{" "}
            {new Date(state.snapshot.calculated_at).toLocaleString()}.<br />
            Attendance last changed:{" "}
            {state.snapshot.last_attendance_at
              ? new Date(state.snapshot.last_attendance_at).toLocaleString()
              : "No accepted check-ins"}
            .
          </p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Refresh occupancy
          </button>
          <p className="freshness">
            Live updates reconcile through the authoritative operations
            snapshot.
          </p>
        </section>
      )}
      <ForecastPanel
        eventId={eventId}
        operations={state}
        connection={connection}
      />
    </main>
  );
}
