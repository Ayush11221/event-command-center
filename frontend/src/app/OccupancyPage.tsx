import { Accent } from "../components/common/Iso";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ChartSpline,
  Tv,
  Gauge,
  Info,
  RefreshCw,
  TriangleAlert,
  Warehouse,
} from "lucide-react";
import { useOperations } from "./useOperations";
import { ForecastPanel } from "./ForecastPanel";
import { humanLabel } from "./event-presentation";
import { useEventInformation } from "./useEventInformation";
import { EventInformation } from "./EventInformation";
import { OccupancyTrend, type OccupancySample } from "./OccupancyTrend";
import { VenueView } from "./VenueView";
import { BigScreen } from "./BigScreen";
import type { ForecastRun } from "../services/forecasting";
import { formatEventTime } from "../services/event-time";
import { currentActor } from "../services/proof";
import { LiveValue } from "../components/common/LiveValue";
import {
  CapacityMeter,
  capacityTone,
} from "../components/common/CapacityMeter";
import { StatusDot, type StatusTone } from "../components/common/StatusDot";
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
  const [samples, setSamples] = useState<OccupancySample[]>([]);
  const [bigScreen, setBigScreen] = useState(false);
  const [view, setView] = useState<"trend" | "venue">(() => {
    try {
      return localStorage.getItem("eoc.ops.view.v1") === "venue"
        ? "venue"
        : "trend";
    } catch {
      return "trend";
    }
  });
  const chooseView = (next: "trend" | "venue") => {
    setView(next);
    try {
      localStorage.setItem("eoc.ops.view.v1", next);
    } catch {
      // Per-device convenience only.
    }
  };
  const [forecast, setForecast] = useState<{
    run: ForecastRun | null;
    stale: boolean;
  }>({ run: null, stale: false });
  const onRun = useCallback(
    (run: ForecastRun | null, stale: boolean) => setForecast({ run, stale }),
    [],
  );
  const sampleAt = snapshot ? Date.parse(snapshot.as_of) : NaN;
  const sampleValue = snapshot?.occupied;
  useEffect(() => {
    if (sampleValue === undefined || !Number.isFinite(sampleAt)) return;
    // One point per authoritative snapshot, kept in time order.
    setSamples((current) =>
      [
        ...current.filter((s) => s.at !== sampleAt),
        { at: sampleAt, occupied: sampleValue },
      ]
        .sort((a, b) => a.at - b.at)
        .slice(-240),
    );
  }, [sampleAt, sampleValue]);
  const over =
    snapshot !== null &&
    snapshot.capacity !== null &&
    snapshot.occupied > snapshot.capacity;
  const connectionTone: StatusTone = connection.startsWith("Reconciling")
    ? "pending"
    : connection.startsWith("Live")
      ? "live"
      : "degraded";
  const tone = snapshot
    ? capacityTone(snapshot.occupied, snapshot.capacity)
    : "unknown";
  const timeZone = information.detail?.time_zone ?? null;
  return (
    <main className="page-shell operations-page">
      <a href="/">
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to event workspace
      </a>
      <header className="ops-header">
        <div className="min-w-0">
          <p className="eyebrow">Command center</p>
          <h1>
            Live <Accent>Operations</Accent>
          </h1>
          <EventInformation information={information} />
          {state.phase === "ready" && (
            <p className="ops-role">
              Role:{" "}
              {role ??
                "Unconfirmed — return to the workspace to check your role"}
            </p>
          )}
        </div>
        <p
          className={`notice live-strip live-strip-${connectionTone}`}
          aria-live="polite"
        >
          <StatusDot tone={connectionTone} />
          {connection.startsWith("Reconciling")
            ? "Updating latest information… Last confirmed values are shown until the update is confirmed."
            : connection.startsWith("Live")
              ? "Live — latest information confirmed."
              : state.phase === "ready"
                ? "Live connection unavailable. Showing last confirmed information; refresh to check the latest values."
                : "Latest information is not confirmed."}
        </p>
      </header>
      <div className="ops-grid">
        {state.phase === "loading" ? (
          <p role="status" className="notice is-loading ops-occupancy">
            Loading occupancy snapshot...
          </p>
        ) : state.phase === "error" ? (
          <section className="notice critical ops-occupancy" role="alert">
            <p>{state.message}</p>
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry operations read
            </button>
          </section>
        ) : (
          <div className="ops-occupancy reveal">
            <section aria-label="Event occupancy" className="ops-panel">
              <div className="ops-panel-head">
                <div className="min-w-0">
                  <h2>{state.snapshot.event_name}</h2>
                  <p>
                    Event status: {humanLabel(state.snapshot.event_state)}.
                    People currently inside are counted from accepted check-ins.
                  </p>
                </div>
                <div className="ops-panel-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setAttempt((value) => value + 1)}
                  >
                    <RefreshCw aria-hidden="true" className="size-4" />
                    Refresh occupancy
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setBigScreen(true)}
                  >
                    <Tv aria-hidden="true" className="size-4" />
                    Big screen
                  </button>
                </div>
              </div>
              <dl className="occupancy-values ops-metrics">
                <div className={`ops-primary capacity-${tone}`}>
                  <dt>Currently inside</dt>
                  <dd>
                    <LiveValue value={state.snapshot.occupied} />
                  </dd>
                  <CapacityMeter
                    occupied={state.snapshot.occupied}
                    capacity={state.snapshot.capacity}
                  />
                </div>
                <div>
                  <dt>Utilization</dt>
                  <dd>
                    <LiveValue
                      value={
                        state.snapshot.utilization_percentage === null
                          ? "Unavailable"
                          : state.snapshot.utilization_percentage + "%"
                      }
                    />
                  </dd>
                </div>
                <div>
                  <dt>Registration limit</dt>
                  <dd>{state.snapshot.capacity ?? "Not configured"}</dd>
                </div>
                <div>
                  <dt>Active registrations</dt>
                  <dd>
                    <LiveValue value={state.snapshot.registered} />
                  </dd>
                </div>
                <div>
                  <dt>Remaining relative to capacity</dt>
                  <dd>
                    <LiveValue
                      value={state.snapshot.remaining ?? "Unavailable"}
                    />
                  </dd>
                </div>
              </dl>
              <div
                className="view-switch"
                role="group"
                aria-label="Occupancy visual"
              >
                <button
                  type="button"
                  aria-pressed={view === "trend"}
                  onClick={() => chooseView("trend")}
                >
                  <ChartSpline aria-hidden="true" className="size-4" />
                  Trend
                </button>
                <button
                  type="button"
                  aria-pressed={view === "venue"}
                  onClick={() => chooseView("venue")}
                >
                  <Warehouse aria-hidden="true" className="size-4" />
                  Venue
                </button>
              </div>
              {view === "venue" ? (
                <VenueView
                  eventId={eventId}
                  occupied={state.snapshot.occupied}
                  capacity={state.snapshot.capacity}
                  gates={information.detail?.gates ?? []}
                  forecast={forecast.run}
                  forecastStale={forecast.stale}
                />
              ) : (
                <OccupancyTrend
                  samples={samples}
                  capacity={state.snapshot.capacity}
                  forecast={forecast.run}
                  forecastStale={forecast.stale}
                  timeZone={timeZone}
                />
              )}
              <p className={`notice capacity-note capacity-${tone}`}>
                {tone === "over" || tone === "full" ? (
                  <TriangleAlert aria-hidden="true" className="size-4" />
                ) : tone === "near" ? (
                  <Gauge aria-hidden="true" className="size-4" />
                ) : (
                  <Info aria-hidden="true" className="size-4" />
                )}
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
              <p className="field-help">
                Registration capacity is a registration limit, not a gate-entry
                ceiling.
              </p>
              <div className="ops-freshness">
                <p className="freshness">
                  Confirmed as of:{" "}
                  {formatEventTime(state.snapshot.as_of, timeZone)}.
                </p>
                <p className="freshness">
                  Calculated:{" "}
                  {formatEventTime(state.snapshot.calculated_at, timeZone)}
                  .<br />
                  Attendance last changed:{" "}
                  {state.snapshot.last_attendance_at
                    ? formatEventTime(
                        state.snapshot.last_attendance_at,
                        timeZone,
                      )
                    : "No accepted check-ins"}
                  .
                </p>
                <p className="freshness">
                  Live updates reconcile through the authoritative operations
                  snapshot.
                </p>
              </div>
              <details className="advanced-details">
                <summary>Advanced details</summary>Version:{" "}
                {state.snapshot.revision}
                <p>{connection}</p>
                <br />
                Event reference: {state.snapshot.event_id}
              </details>
            </section>
          </div>
        )}
        <ForecastPanel
          eventId={eventId}
          operations={state}
          connection={connection}
          timeZone={timeZone}
          onRun={onRun}
        />
      </div>
      {bigScreen && snapshot && (
        <BigScreen
          eventId={eventId}
          snapshot={snapshot}
          forecast={forecast.run}
          forecastStale={forecast.stale}
          connectionTone={connectionTone}
          connectionLabel={
            connectionTone === "live"
              ? "Live"
              : connectionTone === "pending"
                ? "Updating"
                : "Live connection unavailable · last confirmed"
          }
          samples={samples}
          gates={information.detail?.gates ?? []}
          timeZone={timeZone}
          onClose={() => setBigScreen(false)}
        />
      )}
    </main>
  );
}
