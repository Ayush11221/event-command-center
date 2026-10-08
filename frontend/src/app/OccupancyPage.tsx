import { useEffect, useState } from "react";
import { useOperations } from "./useOperations";
import { ForecastPanel } from "./ForecastPanel";
import { humanLabel } from "./event-presentation";
import { useEventInformation } from "./useEventInformation";
import { EventInformation } from "./EventInformation";
import { formatEventTime } from "../services/event-time";
import { currentActor } from "../services/proof";
export function OccupancyPage({ eventId }: { eventId: string }) {
  const [attempt, setAttempt] = useState(0);
  const { state, connection } = useOperations(eventId, attempt);
  const information = useEventInformation(eventId);
  const [role, setRole] = useState<string | null>(null);
  const denied =
    state.phase === "error" && [401, 403, 404].includes(state.status);
  useEffect(() => {
    if (denied) information.clear();
  }, [denied, information.clear]);
  useEffect(() => {
    let active = true;
    setRole(null);
    if (!denied)
      void currentActor()
        .then((actor) => {
          if (!active) return;
          const admin = actor.assignments.some(
            (assignment) =>
              assignment.event_id === eventId &&
              assignment.role === "EVENT_ADMIN",
          );
          // A successful operations read is required before showing this label:
          // the server admits only the capable owner or this event's assigned Admin.
          setRole(
            admin
              ? "Event Admin"
              : actor.organizer_capable
                ? "Organizer"
                : null,
          );
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [eventId, denied]);
  const snapshot = state.phase === "ready" ? state.snapshot : null;
  const over =
    snapshot !== null &&
    snapshot.capacity !== null &&
    snapshot.occupied > snapshot.capacity;
  return (
    <main className="page-shell operations-page">
      <a href="/">Back to event workspace</a>
      <h1>Live Operations</h1>
      <EventInformation information={information} />
      {state.phase === "ready" && (
        <p>
          Role:{" "}
          {role ?? "Unconfirmed — return to the workspace to check your role"}
        </p>
      )}
      <p className="notice" aria-live="polite">
        {connection.startsWith("Reconciling")
          ? "Updating latest information… Last confirmed values are shown until the update is confirmed."
          : connection.startsWith("Live")
            ? "Live — latest information confirmed."
            : state.phase === "ready"
              ? "Live connection unavailable. Showing last confirmed information; refresh to check the latest values."
              : "Latest information is not confirmed."}
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
            Event status: {humanLabel(state.snapshot.event_state)}. People
            currently inside are counted from accepted check-ins.
          </p>
          <p className="freshness">
            Confirmed as of:{" "}
            {formatEventTime(
              state.snapshot.as_of,
              information.detail?.time_zone ?? null,
            )}
            .
          </p>
          <dl className="occupancy-values">
            <div>
              <dt>Currently inside</dt>
              <dd>{state.snapshot.occupied}</dd>
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
              <dt>Registration limit</dt>
              <dd>{state.snapshot.capacity ?? "Not configured"}</dd>
            </div>
            <div>
              <dt>Active registrations</dt>
              <dd>{state.snapshot.registered}</dd>
            </div>
            <div>
              <dt>Remaining relative to capacity</dt>
              <dd>{state.snapshot.remaining ?? "Unavailable"}</dd>
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
            Calculated:{" "}
            {formatEventTime(
              state.snapshot.calculated_at,
              information.detail?.time_zone ?? null,
            )}
            .<br />
            Attendance last changed:{" "}
            {state.snapshot.last_attendance_at
              ? formatEventTime(
                  state.snapshot.last_attendance_at,
                  information.detail?.time_zone ?? null,
                )
              : "No accepted check-ins"}
            .
          </p>
          <details className="advanced-details">
            <summary>Advanced details</summary>Version:{" "}
            {state.snapshot.revision}
            <p>{connection}</p>
            <br />
            Event reference: {state.snapshot.event_id}
          </details>
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
        timeZone={information.detail?.time_zone ?? null}
      />
    </main>
  );
}
