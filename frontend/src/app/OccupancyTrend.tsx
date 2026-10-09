import { useMemo } from "react";
import type { ForecastRun } from "../services/forecasting";

export interface OccupancySample {
  at: number;
  occupied: number;
}

const W = 640;
const H = 200;
const PAD = { top: 16, right: 16, bottom: 28, left: 12 };

function clock(at: number, timeZone: string | null) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone ?? undefined,
    }).format(at);
  } catch {
    return new Date(at).toLocaleTimeString();
  }
}

/**
 * Observed occupancy sampled from authoritative snapshots received while this
 * page is open, plus the advisory forecast horizons. No history endpoint
 * exists, so the observed line honestly starts when the page was opened.
 * Labels are CSS-generated so the figure adds no duplicate text nodes; the
 * figure's accessible name summarises it and the exact values are written
 * out in the metrics beside it.
 */
export function OccupancyTrend({
  samples,
  capacity,
  forecast,
  forecastStale,
  timeZone,
}: {
  samples: OccupancySample[];
  capacity: number | null;
  forecast: ForecastRun | null;
  forecastStale: boolean;
  timeZone: string | null;
}) {
  const model = useMemo(() => {
    if (!samples.length) return null;
    const last = samples[samples.length - 1];
    const points =
      forecast?.status === "AVAILABLE"
        ? forecast.points.map((point) => ({
            at: Date.parse(point.target_at),
            value: point.predicted_occupancy,
            lower: point.uncertainty.lower,
            upper: point.uncertainty.upper,
          }))
        : [];
    const start = Math.min(samples[0].at, last.at - 15 * 60_000);
    const end = Math.max(
      last.at + 60 * 60_000,
      ...points.map((point) => point.at),
    );
    const top =
      Math.max(
        capacity ?? 0,
        ...samples.map((s) => s.occupied),
        ...points.map((p) => p.upper),
        1,
      ) * 1.12;
    const x = (at: number) =>
      PAD.left + ((at - start) / (end - start)) * (W - PAD.left - PAD.right);
    const y = (value: number) =>
      H - PAD.bottom - (value / top) * (H - PAD.top - PAD.bottom);
    const observed = samples
      .map((s, index) =>
        index === 0
          ? `M${x(s.at)},${y(s.occupied)}`
          : `H${x(s.at)}V${y(s.occupied)}`,
      )
      .join("");
    const projected = points.length
      ? `M${x(last.at)},${y(last.occupied)}` +
        points.map((p) => `L${x(p.at)},${y(p.value)}`).join("")
      : "";
    const band = points.length
      ? `M${x(last.at)},${y(last.occupied)}` +
        points.map((p) => `L${x(p.at)},${y(p.upper)}`).join("") +
        [...points]
          .reverse()
          .map((p) => `L${x(p.at)},${y(p.lower)}`)
          .join("") +
        "Z"
      : "";
    const ticks = [0, 1, 2, 3].map((i) => start + ((end - start) * i) / 3);
    return { last, points, x, y, observed, projected, band, ticks };
  }, [samples, capacity, forecast]);

  if (!model) return null;
  const { last, points, x, y, observed, projected, band, ticks } = model;
  const pct = (value: number, axis: "x" | "y") =>
    `${(value / (axis === "x" ? W : H)) * 100}%`;
  const summary =
    `Occupancy trend since this page opened: ${last.occupied} inside now` +
    (capacity !== null ? ` of a registration limit of ${capacity}` : "") +
    (points.length
      ? `; advisory forecast ${points
          .map((p) => `${p.value} (range ${p.lower}–${p.upper})`)
          .join(", then ")}${forecastStale ? ", stale" : ""}.`
      : "; no current forecast.");

  return (
    <figure className="trend" role="img" aria-label={summary}>
      <div className="trend-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              className="trend-grid"
              x1={PAD.left}
              x2={W - PAD.right}
              y1={PAD.top + (H - PAD.top - PAD.bottom) * f}
              y2={PAD.top + (H - PAD.top - PAD.bottom) * f}
            />
          ))}
          {capacity !== null && (
            <line
              className="trend-capacity"
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(capacity)}
              y2={y(capacity)}
            />
          )}
          {band && (
            <path
              className={forecastStale ? "trend-band is-stale" : "trend-band"}
              d={band}
            />
          )}
          {projected && (
            <path
              className={
                forecastStale ? "trend-projected is-stale" : "trend-projected"
              }
              d={projected}
            />
          )}
          <path className="trend-observed" d={observed} />
          <line
            className="trend-now"
            x1={x(last.at)}
            x2={x(last.at)}
            y1={PAD.top}
            y2={H - PAD.bottom}
          />
        </svg>
        <span
          className="trend-dot"
          style={{
            left: pct(x(last.at), "x"),
            top: pct(y(last.occupied), "y"),
          }}
        />
        {capacity !== null && (
          <span
            className="trend-tag trend-tag-capacity"
            style={{ top: pct(y(capacity), "y") }}
            data-label={`Limit ${capacity}`}
          />
        )}
        {ticks.map((at, index) => (
          <span
            key={at}
            className="trend-tick"
            style={{ left: pct(x(at), "x") }}
            data-label={clock(at, timeZone)}
            data-edge={
              index === 0 ? "start" : index === ticks.length - 1 ? "end" : ""
            }
          />
        ))}
      </div>
      <figcaption className="trend-legend" aria-hidden="true">
        <span className="legend-observed" data-label="Observed since opened" />
        {points.length > 0 && (
          <span
            className="legend-forecast"
            data-label={forecastStale ? "Forecast (stale)" : "Forecast + range"}
          />
        )}
        {capacity !== null && (
          <span className="legend-capacity" data-label="Registration limit" />
        )}
      </figcaption>
    </figure>
  );
}
