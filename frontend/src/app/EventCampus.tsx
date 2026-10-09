import type { ManagementEvent } from "../services/events";
import { humanLabel } from "./event-presentation";

const S = 15;
const C30 = Math.cos(Math.PI / 6);
const iso = (x: number, y: number, z = 0): [number, number] => [
  (x - y) * C30 * S,
  ((x + y) / 2 - z) * S,
];
const pts = (...p: [number, number, number][]) =>
  p
    .map(([x, y, z]) => iso(x, y, z))
    .map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`)
    .join(" ");

const HEIGHT: Record<ManagementEvent["state"], number> = {
  DRAFT: 2.2,
  PUBLISHED: 2.8,
  LIVE: 3.4,
  COMPLETED: 2,
  CANCELLED: 1.2,
};

function Building({ x, y, h }: { x: number; y: number; h: number }) {
  const w = 2.4;
  return (
    <>
      <polygon
        className="cb-left"
        points={pts(
          [x, y + w, 0],
          [x + w, y + w, 0],
          [x + w, y + w, h],
          [x, y + w, h],
        )}
      />
      <polygon
        className="cb-right"
        points={pts(
          [x + w, y, 0],
          [x + w, y + w, 0],
          [x + w, y + w, h],
          [x + w, y, h],
        )}
      />
      <polygon
        className="cb-top"
        points={pts([x, y, h], [x + w, y, h], [x + w, y + w, h], [x, y + w, h])}
      />
      {[0.55, 1.2].map((dz) =>
        dz < h - 0.4
          ? [0.5, 1.4].map((dx) => (
              <polygon
                key={`${dz}-${dx}`}
                className="cb-window"
                points={pts(
                  [x + dx, y + w, dz],
                  [x + dx + 0.5, y + w, dz],
                  [x + dx + 0.5, y + w, dz + 0.4],
                  [x + dx, y + w, dz + 0.4],
                )}
              />
            ))
          : null,
      )}
    </>
  );
}

/**
 * Isometric "campus" of the organizer's own events. Building style follows
 * the real lifecycle state only. Decorative for assistive technology: the
 * event list below is the accessible, keyboard-operable control.
 */
export function EventCampus({
  events,
  selectedId,
  onOpen,
}: {
  events: ManagementEvent[];
  selectedId: string | null;
  onOpen: (eventId: string) => void;
}) {
  const shown = events.slice(0, 6);
  if (!shown.length) return null;
  const spacing = 4;
  const plots = shown.map((event, i) => ({
    event,
    x: (i % 3) * spacing,
    y: Math.floor(i / 3) * spacing,
  }));
  const rows = Math.ceil(shown.length / 3);
  const cols = Math.min(3, shown.length);
  const gw = cols * spacing,
    gh = rows * spacing;
  const [lx] = iso(0, gh);
  const [rx] = iso(gw, 0);
  const [, ty] = iso(0, 0, 4.4);
  const [, by] = iso(gw, gh);
  const box = { x: lx - 30, y: ty - 30, w: rx - lx + 60, h: by - ty + 50 };
  const pos = (x: number, y: number, z: number) => {
    const [a, b] = iso(x, y, z);
    return {
      left: `${((a - box.x) / box.w) * 100}%`,
      top: `${((b - box.y) / box.h) * 100}%`,
    };
  };
  return (
    <div className="campus studio-only" aria-hidden="true">
      <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}>
        <polygon
          className="campus-ground"
          points={pts(
            [-0.6, -0.6, 0],
            [gw - 0.6, -0.6, 0],
            [gw - 0.6, gh - 0.6, 0],
            [-0.6, gh - 0.6, 0],
          )}
        />
        {plots.map(({ event, x, y }) => (
          <g
            key={event.event_id}
            className={`cb cb-${event.state.toLowerCase()}${
              event.event_id === selectedId ? " is-selected" : ""
            }`}
            onClick={() => onOpen(event.event_id)}
          >
            <polygon
              className="cb-plot"
              points={pts(
                [x, y, 0],
                [x + 3.2, y, 0],
                [x + 3.2, y + 3.2, 0],
                [x, y + 3.2, 0],
              )}
            />
            <Building x={x + 0.4} y={y + 0.4} h={HEIGHT[event.state]} />
          </g>
        ))}
      </svg>
      {plots.map(({ event, x, y }) => (
        <span
          key={event.event_id}
          className={`campus-tag campus-${event.state.toLowerCase()}`}
          style={pos(x + 1.6, y + 1.6, HEIGHT[event.state] + 1.1)}
          data-label={event.name}
          data-state={humanLabel(event.state)}
        />
      ))}
      {events.length > shown.length && (
        <span
          className="campus-more"
          data-label={`+${events.length - shown.length} more below`}
        />
      )}
    </div>
  );
}
