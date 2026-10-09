import { useEffect, useRef, useState } from "react";
import { Minimize2, TrendingDown, TrendingUp, MoveRight } from "lucide-react";
import type { OperationsSnapshot } from "../services/occupancy";
import type { ForecastRun } from "../services/forecasting";
import type { OccupancySample } from "./OccupancyTrend";
import { VenueView } from "./VenueView";
import { CapacityMeter } from "../components/common/CapacityMeter";
import { LiveValue } from "../components/common/LiveValue";
import { StatusDot, type StatusTone } from "../components/common/StatusDot";
import { SyntheticForecastNotice } from "./SyntheticForecastNotice";

function clock(at: number, timeZone: string | null, seconds = false) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      ...(seconds ? { second: "2-digit" } : {}),
      timeZone: timeZone ?? undefined,
    }).format(at);
  } catch {
    return new Date(at).toLocaleTimeString();
  }
}

/**
 * Control-room display for a projector or TV. It re-presents the same
 * authoritative snapshot, forecast and observed samples as Live Operations;
 * it fetches nothing new except the venue's staff counts.
 */
export function BigScreen({
  eventId,
  snapshot,
  forecast,
  forecastStale,
  connectionTone,
  connectionLabel,
  samples,
  gates,
  timeZone,
  onClose,
}: {
  eventId: string;
  snapshot: OperationsSnapshot;
  forecast: ForecastRun | null;
  forecastStale: boolean;
  connectionTone: StatusTone;
  connectionLabel: string;
  samples: OccupancySample[];
  gates: { gate_id: string }[];
  timeZone: string | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (typeof node.showModal === "function") node.showModal();
    else node.setAttribute("open", "");
    void node.requestFullscreen?.().catch(() => {});
    return () => {
      if (document.fullscreenElement)
        void document.exitFullscreen().catch(() => {});
      if (node.open && typeof node.close === "function") node.close();
    };
  }, []);

  const changes = samples
    .map((sample, index) =>
      index === 0
        ? null
        : { ...sample, delta: sample.occupied - samples[index - 1].occupied },
    )
    .filter(
      (c): c is OccupancySample & { delta: number } => !!c && c.delta !== 0,
    )
    .slice(-6)
    .reverse();
  const points =
    forecast?.status === "AVAILABLE" ? forecast.points : ([] as never[]);
  const pct = snapshot.utilization_percentage;

  return (
    <dialog
      ref={dialog}
      className="bigscreen"
      aria-label="Big screen operations"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="bigscreen-top">
        <div>
          <p className="bigscreen-kicker">
            <StatusDot tone={connectionTone} /> {connectionLabel}
          </p>
          <h2>{snapshot.event_name}</h2>
        </div>
        <p className="bigscreen-clock">{clock(now, timeZone, true)}</p>
        <button type="button" className="bigscreen-exit" onClick={onClose}>
          <Minimize2 aria-hidden="true" className="size-4" />
          Exit big screen
        </button>
      </header>
      <div className="bigscreen-grid">
        <section
          className="bigscreen-card bigscreen-hero"
          aria-label="Occupancy"
        >
          <p className="bigscreen-label">Currently inside</p>
          <p className="bigscreen-number">
            <LiveValue value={snapshot.occupied} />
          </p>
          <p className="bigscreen-sub">
            {snapshot.capacity !== null
              ? `of ${snapshot.capacity} registration limit · ${pct}%`
              : "Registration limit not configured"}
          </p>
          <CapacityMeter
            occupied={snapshot.occupied}
            capacity={snapshot.capacity}
          />
          <dl className="bigscreen-facts">
            <div>
              <dt>Registered</dt>
              <dd>{snapshot.registered}</dd>
            </div>
            <div>
              <dt>Remaining</dt>
              <dd>{snapshot.remaining ?? "—"}</dd>
            </div>
          </dl>
        </section>
        <section className="bigscreen-card bigscreen-venue" aria-label="Venue">
          <VenueView
            eventId={eventId}
            occupied={snapshot.occupied}
            capacity={snapshot.capacity}
            gates={gates}
            forecast={forecast}
            forecastStale={forecastStale}
          />
        </section>
        <section
          className="bigscreen-card bigscreen-forecast"
          aria-label="Advisory forecast"
        >
          <p className="bigscreen-label">
            Crowd outlook {forecastStale && "· stale"}
          </p>
          <SyntheticForecastNotice />
          {points.length ? (
            points.map((point) => {
              const change = point.predicted_occupancy - snapshot.occupied;
              const Icon =
                change > 0 ? TrendingUp : change < 0 ? TrendingDown : MoveRight;
              return (
                <div
                  key={point.horizon_minutes}
                  className={`outlook${forecastStale ? " is-stale" : ""}`}
                >
                  <Icon aria-hidden="true" className="outlook-icon" />
                  <div>
                    <p className="outlook-when">
                      Next {point.horizon_minutes} min
                    </p>
                    <p className="outlook-value">
                      {point.predicted_occupancy}
                      <span>
                        {" "}
                        ({point.uncertainty.lower}–{point.uncertainty.upper})
                      </span>
                    </p>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="bigscreen-sub">No current forecast.</p>
          )}
          <p className="bigscreen-note">Advisory only · never controls entry</p>
        </section>
        <section
          className="bigscreen-card bigscreen-fresh"
          aria-label="Data freshness"
        >
          <p className="bigscreen-label">Data freshness</p>
          <dl className="bigscreen-facts">
            <div>
              <dt>Confirmed</dt>
              <dd>{clock(Date.parse(snapshot.as_of), timeZone, true)}</dd>
            </div>
            <div>
              <dt>Last check-in</dt>
              <dd>
                {snapshot.last_attendance_at
                  ? clock(Date.parse(snapshot.last_attendance_at), timeZone)
                  : "None yet"}
              </dd>
            </div>
          </dl>
          <p className="bigscreen-note">
            <StatusDot tone={connectionTone} /> {connectionLabel}
          </p>
        </section>
        <section
          className="bigscreen-card bigscreen-ticker"
          aria-label="Observed changes"
        >
          <p className="bigscreen-label">Observed on this screen</p>
          {changes.length ? (
            <ul>
              {changes.map((change) => (
                <li key={change.at}>
                  <time>{clock(change.at, timeZone, true)}</time>
                  <strong className={change.delta > 0 ? "up" : "down"}>
                    {change.delta > 0 ? `+${change.delta}` : change.delta}
                  </strong>
                  <span>{change.occupied} inside</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="bigscreen-sub">
              Changes appear here as confirmed updates arrive.
            </p>
          )}
        </section>
      </div>
    </dialog>
  );
}
