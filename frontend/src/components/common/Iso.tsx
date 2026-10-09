import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/*
 * Isometric illustration kit for the "studio" look. Everything here is
 * decorative (aria-hidden) and only shown when <html data-look="studio">;
 * labels are CSS-generated so no duplicate text enters the page.
 */

const C30 = Math.cos(Math.PI / 6);
function iso(x: number, y: number, z: number, s: number): [number, number] {
  return [(x - y) * C30 * s, ((x + y) / 2 - z) * s];
}
function poly(points: [number, number, number][], s: number) {
  return points
    .map(([x, y, z]) =>
      iso(x, y, z, s)
        .map((v) => v.toFixed(1))
        .join(","),
    )
    .join(" ");
}

function Block({
  x,
  y,
  w,
  d,
  h,
  s,
  tone,
  z = 0,
}: {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  s: number;
  tone: string;
  z?: number;
}) {
  return (
    <g className={`iso-block iso-${tone}`}>
      <polygon
        className="iso-left"
        points={poly(
          [
            [x, y + d, z],
            [x + w, y + d, z],
            [x + w, y + d, z + h],
            [x, y + d, z + h],
          ],
          s,
        )}
      />
      <polygon
        className="iso-right"
        points={poly(
          [
            [x + w, y, z],
            [x + w, y + d, z],
            [x + w, y + d, z + h],
            [x + w, y, z + h],
          ],
          s,
        )}
      />
      <polygon
        className="iso-top"
        points={poly(
          [
            [x, y, z + h],
            [x + w, y, z + h],
            [x + w, y + d, z + h],
            [x, y + d, z + h],
          ],
          s,
        )}
      />
    </g>
  );
}

/** Small building used as an event thumbnail; tone follows event state. */
export function IsoBuilding({
  tone = "action",
  className,
}: {
  tone?: string;
  className?: string;
}) {
  const s = 9;
  return (
    <svg
      aria-hidden="true"
      className={cn("iso-glyph studio-only", className)}
      viewBox="-40 -30 80 62"
    >
      <polygon
        className="iso-ground"
        points={poly(
          [
            [0, 0, 0],
            [4, 0, 0],
            [4, 4, 0],
            [0, 4, 0],
          ],
          s,
        )}
      />
      <Block x={0.7} y={0.7} w={2.6} d={2.6} h={1.6} s={s} tone={tone} />
      <Block
        x={1.4}
        y={1.4}
        w={1.2}
        d={1.2}
        h={0.6}
        z={1.6}
        s={s}
        tone="roof"
      />
    </svg>
  );
}

/** Isometric gate arch for the scanner header. */
export function IsoGate({ className }: { className?: string }) {
  const s = 16;
  return (
    <svg
      aria-hidden="true"
      className={cn("iso-glyph studio-only", className)}
      viewBox="-60 -26 120 94"
    >
      <polygon
        className="iso-ground"
        points={poly(
          [
            [0, 0, 0],
            [4, 0, 0],
            [4, 4, 0],
            [0, 4, 0],
          ],
          s,
        )}
      />
      <Block x={1} y={1.8} w={0.35} d={0.4} h={2} s={s} tone="post" />
      <Block x={2.65} y={1.8} w={0.35} d={0.4} h={2} s={s} tone="post" />
      <Block
        x={0.9}
        y={1.7}
        w={2.2}
        d={0.6}
        h={0.4}
        z={2}
        s={s}
        tone="action"
      />
      <Block x={1.6} y={3.2} w={0.8} d={0.25} h={0.05} s={s} tone="success" />
    </svg>
  );
}

/**
 * Decorative venue scene with floating capability chips (not metrics).
 * `chips` are plain feature labels such as "QR entry".
 */
export function IsoScene({
  chips = [],
  className,
  children,
}: {
  chips?: string[];
  className?: string;
  children?: ReactNode;
}) {
  const s = 22;
  const trees: [number, number][] = [
    [0.8, 0.8],
    [9.2, 0.8],
    [9.2, 9.2],
    [0.8, 9.2],
    [5, 0.6],
  ];
  return (
    <div
      aria-hidden="true"
      className={cn("iso-scene studio-only", className)}
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty(
          "--px",
          String((event.clientX - box.left) / box.width - 0.5),
        );
        event.currentTarget.style.setProperty(
          "--py",
          String((event.clientY - box.top) / box.height - 0.5),
        );
      }}
      onPointerLeave={(event) => {
        event.currentTarget.style.setProperty("--px", "0");
        event.currentTarget.style.setProperty("--py", "0");
      }}
    >
      <svg viewBox="-210 -70 420 300">
        <polygon
          className="iso-ground"
          points={poly(
            [
              [0, 0, 0],
              [10, 0, 0],
              [10, 10, 0],
              [0, 10, 0],
            ],
            s,
          )}
        />
        {[2, 4, 6, 8].map((i) => (
          <g key={i} className="iso-grid">
            <polyline
              points={poly(
                [
                  [i, 0, 0],
                  [i, 10, 0],
                ],
                s,
              )}
            />
            <polyline
              points={poly(
                [
                  [0, i, 0],
                  [10, i, 0],
                ],
                s,
              )}
            />
          </g>
        ))}
        <polyline
          className="iso-path"
          points={poly(
            [
              [5, 9.4, 0],
              [5, 7, 0],
            ],
            s,
          )}
        />
        <polyline
          className="iso-path"
          points={poly(
            [
              [9.4, 5, 0],
              [7, 5, 0],
            ],
            s,
          )}
        />
        <Block x={3} y={3} w={4} d={4} h={2.2} s={s} tone="action" />
        <Block
          x={3.8}
          y={3.8}
          w={2.4}
          d={2.4}
          h={0.5}
          z={2.2}
          s={s}
          tone="roof"
        />
        <Block x={4.4} y={9} w={0.25} d={0.3} h={1.1} s={s} tone="post" />
        <Block x={5.35} y={9} w={0.25} d={0.3} h={1.1} s={s} tone="post" />
        <Block
          x={4.3}
          y={8.95}
          w={1.4}
          d={0.4}
          h={0.25}
          z={1.1}
          s={s}
          tone="action"
        />
        <Block x={9} y={4.4} w={0.3} d={0.25} h={1.1} s={s} tone="post" />
        <Block x={9} y={5.35} w={0.3} d={0.25} h={1.1} s={s} tone="post" />
        <Block
          x={8.95}
          y={4.3}
          w={0.4}
          d={1.4}
          h={0.25}
          z={1.1}
          s={s}
          tone="action"
        />
        {trees.map(([x, y]) => {
          const [cx, cy] = iso(x, y, 0.9, s);
          return (
            <g key={`${x}-${y}`} className="iso-tree">
              <Block
                x={x - 0.05}
                y={y - 0.05}
                w={0.1}
                d={0.1}
                h={0.55}
                s={s}
                tone="trunk"
              />
              <ellipse cx={cx} cy={cy} rx={s * 0.42} ry={s * 0.4} />
            </g>
          );
        })}
      </svg>
      {chips.map((chip, index) => (
        <span
          key={chip}
          className={`iso-chip iso-chip-${index}`}
          data-label={chip}
        />
      ))}
      {children}
    </div>
  );
}

/** Italic accent word for display headings (studio look only styles it). */
export function Accent({ children }: { children: ReactNode }) {
  return <span className="accent">{children}</span>;
}
