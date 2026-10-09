import { useEffect, useMemo, useRef, useState } from "react";
import { useTween } from "../components/common/useTween";
import type { ForecastRun } from "../services/forecasting";
import { listStaff } from "../services/staff";
import { gateLabel } from "./gate-label";
import { isSyntheticDemo } from "./demo-context";
import {
  SyntheticForecastNotice,
  SYNTHETIC_FORECAST_PROVENANCE,
} from "./SyntheticForecastNotice";
import {
  capacityTone,
  NEAR_CAPACITY_PERCENT,
} from "../components/common/CapacityMeter";

// Isometric projection: x runs to the right-front, y to the left-front, z up.
const S = 26;
const C30 = Math.cos(Math.PI / 6);
const iso = (x: number, y: number, z = 0): [number, number] => [
  (x - y) * C30 * S,
  ((x + y) / 2 - z) * S,
];
const pts = (...points: [number, number, number?][]) =>
  points
    .map(([x, y, z]) => iso(x, y, z ?? 0))
    .map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`)
    .join(" ");

const GROUND = 12;
const HALL = { x0: 4, y0: 4, x1: 8, y1: 8, h: 2.6 };
// Decorative landscaping only (no data meaning).
const TREES: [number, number][] = [
  [0.9, 0.9],
  [11.1, 0.9],
  [11.1, 11.1],
  [0.9, 11.1],
  [2.4, 6],
  [9.6, 6],
];

/** Evenly distributes gates around the venue perimeter (schematic only). */
function gatePosition(index: number, count: number): [number, number] {
  const t = ((index + 0.5) / count) * 4;
  const side = Math.floor(t);
  const f = t - side;
  const lo = 1,
    hi = GROUND - 1,
    span = hi - lo;
  return side === 0
    ? [lo + f * span, hi]
    : side === 1
      ? [hi, hi - f * span]
      : side === 2
        ? [hi - f * span, lo]
        : [lo, lo + f * span];
}

function nearestDoor([gx, gy]: [number, number]): [number, number] {
  const cx = (HALL.x0 + HALL.x1) / 2,
    cy = (HALL.y0 + HALL.y1) / 2;
  return Math.abs(gx - cx) > Math.abs(gy - cy)
    ? [gx > cx ? HALL.x1 : HALL.x0, cy]
    : [cx, gy > cy ? HALL.y1 : HALL.y0];
}

function Box({
  x0,
  y0,
  x1,
  y1,
  z0 = 0,
  z1,
  className,
}: {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z0?: number;
  z1: number;
  className: string;
}) {
  return (
    <g className={className}>
      <polygon
        className="face-left"
        points={pts([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1])}
      />
      <polygon
        className="face-right"
        points={pts([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1])}
      />
      <polygon
        className="face-top"
        points={pts([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1])}
      />
    </g>
  );
}

/**
 * Schematic isometric venue: the hall fills to the authoritative occupancy
 * percentage and gates show configured names with their assigned Gate /
 * Security count. Layout is illustrative, not a floor plan; no positions,
 * flows or per-gate traffic are invented. Labels are CSS-generated and the
 * figure carries an accessible summary, so no duplicate text is added.
 */
export function VenueView({
  eventId,
  occupied,
  capacity,
  gates,
  forecast,
  forecastStale,
}: {
  eventId: string;
  occupied: number;
  capacity: number | null;
  gates: { gate_id: string }[];
  forecast: ForecastRun | null;
  forecastStale: boolean;
}) {
  const [staff, setStaff] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    listStaff(eventId, controller.signal)
      .then((list) => {
        const counts: Record<string, number> = {};
        for (const row of list.assignments)
          if (row.role === "GATE_SECURITY" && row.gateId)
            counts[row.gateId] = (counts[row.gateId] ?? 0) + 1;
        setStaff(counts);
      })
      .catch(() => setStaff(null));
    return () => controller.abort();
  }, [eventId]);

  const tone = capacityTone(occupied, capacity);
  const ratio = capacity ? Math.min(1, occupied / capacity) : 0;
  // Geometry eases; the written count is always the exact server value.
  const level = useTween(HALL.h * ratio);
  // A pulse per confirmed increase, labelled with the real delta.
  const previous = useRef(occupied);
  const [pulses, setPulses] = useState<{ id: number; delta: number }[]>([]);
  useEffect(() => {
    const delta = occupied - previous.current;
    previous.current = occupied;
    if (delta <= 0) return;
    const id = Date.now() + Math.random();
    setPulses((current) => [...current.slice(-3), { id, delta }]);
    const timer = setTimeout(
      () => setPulses((current) => current.filter((p) => p.id !== id)),
      1600,
    );
    return () => clearTimeout(timer);
  }, [occupied]);
  const sorted = useMemo(
    () => [...gates].sort((a, b) => a.gate_id.localeCompare(b.gate_id)),
    [gates],
  );
  const placed = sorted.map((gate, index) => {
    const at = gatePosition(index, sorted.length);
    const staffed = staff?.[gate.gate_id];
    return {
      id: gate.gate_id,
      label: gateLabel(gates, gate.gate_id),
      at,
      door: nearestDoor(at),
      note:
        staff === null
          ? ""
          : staffed
            ? `${staffed} security`
            : "No staff assigned",
      unstaffed: staff !== null && !staffed,
    };
  });
  const next =
    forecast?.status === "AVAILABLE"
      ? forecast.points.find((p) => p.horizon_minutes === 30)
      : undefined;

  const [vx0] = iso(0, GROUND);
  const [vx1] = iso(GROUND, 0);
  const [, vy0] = iso(0, 0, HALL.h + 1.4);
  const [, vy1] = iso(GROUND, GROUND);
  const pad = 18;
  const box = {
    x: vx0 - pad,
    y: vy0 - pad,
    w: vx1 - vx0 + pad * 2,
    h: vy1 - vy0 + pad * 2,
  };
  const pos = ([x, y]: [number, number]) => ({
    left: `${((x - box.x) / box.w) * 100}%`,
    top: `${((y - box.y) / box.h) * 100}%`,
  });
  const hallTop = iso(
    (HALL.x0 + HALL.x1) / 2,
    (HALL.y0 + HALL.y1) / 2,
    HALL.h + 0.9,
  );

  const summary =
    `Schematic venue view. Hall ${occupied} inside` +
    (capacity !== null
      ? ` of a registration limit of ${capacity} (${Math.round((occupied * 100) / capacity)}%)`
      : "; capacity not configured") +
    `. ${sorted.length} configured gate${sorted.length === 1 ? "" : "s"}` +
    (staff
      ? `: ${placed.map((g) => `${g.label}, ${g.note.toLowerCase()}`).join("; ")}`
      : "") +
    "." +
    (next
      ? ` Advisory 30-minute forecast ${next.predicted_occupancy}${forecastStale ? ", stale" : ""}.`
      : "") +
    (isSyntheticDemo() ? ` ${SYNTHETIC_FORECAST_PROVENANCE}` : "");

  return (
    <figure
      className={`venue capacity-${tone}`}
      role="img"
      aria-label={summary}
    >
      <div className="venue-stage">
        <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}>
          <polygon
            className="venue-ground"
            points={pts([0, 0], [GROUND, 0], [GROUND, GROUND], [0, GROUND])}
          />
          {Array.from({ length: GROUND - 1 }, (_, i) => i + 1).map((i) => (
            <g key={i} className="venue-grid">
              <polyline points={pts([i, 0], [i, GROUND])} />
              <polyline points={pts([0, i], [GROUND, i])} />
            </g>
          ))}
          <polygon
            className="hall-shadow"
            points={pts(
              [HALL.x0 + 0.3, HALL.y0 + 0.3],
              [HALL.x1 + 0.6, HALL.y0 + 0.3],
              [HALL.x1 + 0.6, HALL.y1 + 0.6],
              [HALL.x0 + 0.3, HALL.y1 + 0.6],
            )}
          />
          {TREES.map(([x, y]) => {
            const [cx, cy] = iso(x, y, 0.95);
            return (
              <g key={`${x}-${y}`} className="venue-tree">
                <Box
                  x0={x - 0.06}
                  y0={y - 0.06}
                  x1={x + 0.06}
                  y1={y + 0.06}
                  z1={0.6}
                  className="tree-trunk"
                />
                <ellipse cx={cx} cy={cy} rx={S * 0.42} ry={S * 0.4} />
              </g>
            );
          })}
          {placed.map((gate) => (
            <polyline
              key={`path-${gate.id}`}
              className="venue-path"
              points={pts(gate.at, gate.door)}
            />
          ))}
          {/* Back walls, then the occupancy volume, then glass front walls. */}
          <polygon
            className="hall-floor"
            points={pts(
              [HALL.x0, HALL.y0],
              [HALL.x1, HALL.y0],
              [HALL.x1, HALL.y1],
              [HALL.x0, HALL.y1],
            )}
          />
          <polygon
            className="hall-wall"
            points={pts(
              [HALL.x0, HALL.y0, 0],
              [HALL.x1, HALL.y0, 0],
              [HALL.x1, HALL.y0, HALL.h],
              [HALL.x0, HALL.y0, HALL.h],
            )}
          />
          <polygon
            className="hall-wall hall-wall-dim"
            points={pts(
              [HALL.x0, HALL.y0, 0],
              [HALL.x0, HALL.y1, 0],
              [HALL.x0, HALL.y1, HALL.h],
              [HALL.x0, HALL.y0, HALL.h],
            )}
          />
          {placed
            .filter(
              (gate) => gate.door[0] === HALL.x0 || gate.door[1] === HALL.y0,
            )
            .map((gate) => {
              const [dx, dy] = gate.door;
              const w = 0.38;
              const onX = dx === HALL.x0 || dx === HALL.x1;
              return (
                <polygon
                  key={`door-${gate.id}`}
                  className="hall-door"
                  points={
                    onX
                      ? pts(
                          [dx, dy - w, 0],
                          [dx, dy + w, 0],
                          [dx, dy + w, 0.85],
                          [dx, dy - w, 0.85],
                        )
                      : pts(
                          [dx - w, dy, 0],
                          [dx + w, dy, 0],
                          [dx + w, dy, 0.85],
                          [dx - w, dy, 0.85],
                        )
                  }
                />
              );
            })}
          {capacity !== null && (
            <polyline
              className="hall-near-mark"
              points={pts(
                [HALL.x0, HALL.y1, (HALL.h * NEAR_CAPACITY_PERCENT) / 100],
                [HALL.x0, HALL.y0, (HALL.h * NEAR_CAPACITY_PERCENT) / 100],
                [HALL.x1, HALL.y0, (HALL.h * NEAR_CAPACITY_PERCENT) / 100],
              )}
            />
          )}
          {level > 0 && (
            <Box
              x0={HALL.x0 + 0.08}
              y0={HALL.y0 + 0.08}
              x1={HALL.x1 - 0.08}
              y1={HALL.y1 - 0.08}
              z1={level}
              className="hall-fill"
            />
          )}
          <polygon
            className="hall-glass"
            points={pts(
              [HALL.x0, HALL.y1, 0],
              [HALL.x1, HALL.y1, 0],
              [HALL.x1, HALL.y1, HALL.h],
              [HALL.x0, HALL.y1, HALL.h],
            )}
          />
          <polygon
            className="hall-glass"
            points={pts(
              [HALL.x1, HALL.y0, 0],
              [HALL.x1, HALL.y1, 0],
              [HALL.x1, HALL.y1, HALL.h],
              [HALL.x1, HALL.y0, HALL.h],
            )}
          />
          {placed
            .filter(
              (gate) => gate.door[0] === HALL.x1 || gate.door[1] === HALL.y1,
            )
            .map((gate) => {
              const [dx, dy] = gate.door;
              const w = 0.38;
              const onX = dx === HALL.x0 || dx === HALL.x1;
              return (
                <polygon
                  key={`door-${gate.id}`}
                  className="hall-door"
                  points={
                    onX
                      ? pts(
                          [dx, dy - w, 0],
                          [dx, dy + w, 0],
                          [dx, dy + w, 0.85],
                          [dx, dy - w, 0.85],
                        )
                      : pts(
                          [dx - w, dy, 0],
                          [dx + w, dy, 0],
                          [dx + w, dy, 0.85],
                          [dx - w, dy, 0.85],
                        )
                  }
                />
              );
            })}
          <polygon
            className="hall-rim"
            points={pts(
              [HALL.x0, HALL.y0, HALL.h],
              [HALL.x1, HALL.y0, HALL.h],
              [HALL.x1, HALL.y1, HALL.h],
              [HALL.x0, HALL.y1, HALL.h],
            )}
          />
          {placed.map((gate) => {
            const [x, y] = gate.at;
            return (
              <g
                key={gate.id}
                className={
                  gate.unstaffed ? "venue-gate is-unstaffed" : "venue-gate"
                }
              >
                <Box
                  x0={x - 0.45}
                  y0={y - 0.1}
                  x1={x - 0.25}
                  y1={y + 0.1}
                  z1={1.1}
                  className="gate-post"
                />
                <Box
                  x0={x + 0.25}
                  y0={y - 0.1}
                  x1={x + 0.45}
                  y1={y + 0.1}
                  z1={1.1}
                  className="gate-post"
                />
                <Box
                  x0={x - 0.5}
                  y0={y - 0.14}
                  x1={x + 0.5}
                  y1={y + 0.14}
                  z0={1.1}
                  z1={1.35}
                  className="gate-beam"
                />
              </g>
            );
          })}
        </svg>
        {pulses.map((pulse) => (
          <span
            key={pulse.id}
            className="venue-pulse"
            style={pos(
              iso((HALL.x0 + HALL.x1) / 2, (HALL.y0 + HALL.y1) / 2, level),
            )}
            data-label={`+${pulse.delta}`}
          />
        ))}
        <span
          className="venue-tag venue-tag-hall"
          style={pos(hallTop)}
          data-label={
            capacity !== null
              ? `Inside ${occupied} / ${capacity}`
              : `Inside ${occupied}`
          }
        />
        {placed.map((gate) => (
          <span
            key={gate.id}
            className={
              gate.unstaffed
                ? "venue-tag venue-gate-tag is-warning"
                : "venue-tag venue-gate-tag"
            }
            style={pos(iso(gate.at[0], gate.at[1], 1.9))}
            data-label={gate.label}
            data-note={gate.note}
          />
        ))}
        {next && (
          <span
            className={
              forecastStale ? "venue-forecast is-stale" : "venue-forecast"
            }
            data-label={`In 30 min ≈ ${next.predicted_occupancy}`}
            data-note={
              forecastStale
                ? "Forecast stale"
                : `Range ${next.uncertainty.lower}–${next.uncertainty.upper} · advisory`
            }
          />
        )}
        {sorted.length === 0 && (
          <span className="venue-empty" data-label="No gates configured" />
        )}
      </div>
      <figcaption className="venue-caption" aria-hidden="true">
        <span data-label="Schematic, not to scale" />
        <span data-label="Hall fill = people inside vs registration limit" />
      </figcaption>
      <SyntheticForecastNotice />
    </figure>
  );
}
