const S = 14;
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

function Box(props: {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  z?: number;
  className: string;
}) {
  const { x, y, w, d, h, z = 0, className } = props;
  return (
    <g className={className}>
      <polygon
        className="gs-left"
        points={pts(
          [x, y + d, z],
          [x + w, y + d, z],
          [x + w, y + d, z + h],
          [x, y + d, z + h],
        )}
      />
      <polygon
        className="gs-right"
        points={pts(
          [x + w, y, z],
          [x + w, y + d, z],
          [x + w, y + d, z + h],
          [x + w, y, z + h],
        )}
      />
      <polygon
        className="gs-top"
        points={pts(
          [x, y, z + h],
          [x + w, y, z + h],
          [x + w, y + d, z + h],
          [x, y + d, z + h],
        )}
      />
    </g>
  );
}

export type GateOutcome =
  "idle" | "accepted" | "duplicate" | "rejected" | "unknown";

/**
 * Decorative isometric gate that acts out a scan decision the server has
 * already returned. It never represents anything the server did not decide;
 * the written result beside it is authoritative.
 */
export function GateStage({ outcome }: { outcome: GateOutcome }) {
  const [tx, ty] = iso(2.05, 3.7, 0);
  return (
    <svg
      aria-hidden="true"
      className={`gate-stage studio-only gs-${outcome}`}
      viewBox="-70 -30 140 110"
    >
      <polygon
        className="gs-ground"
        points={pts([0, 0, 0], [4.2, 0, 0], [4.2, 4.2, 0], [0, 4.2, 0])}
      />
      <polygon
        className="gs-lane"
        points={pts([1.4, 0, 0], [2.7, 0, 0], [2.7, 4.2, 0], [1.4, 4.2, 0])}
      />
      <Box x={0.9} y={1.9} w={0.4} d={0.4} h={2.1} className="gs-post" />
      <Box x={2.8} y={1.9} w={0.4} d={0.4} h={2.1} className="gs-post" />
      <Box
        x={0.8}
        y={1.8}
        w={2.5}
        d={0.6}
        h={0.35}
        z={2.1}
        className="gs-beam"
      />
      <g className="gs-arm-wrap">
        <Box
          x={1.3}
          y={2.05}
          w={1.5}
          d={0.12}
          h={0.14}
          z={0.95}
          className="gs-arm"
        />
      </g>
      <g className="gs-token" style={{ transformOrigin: `${tx}px ${ty}px` }}>
        <ellipse className="gs-token-shadow" cx={tx} cy={ty} rx={9} ry={4.5} />
        <circle className="gs-token-body" cx={tx} cy={ty - 9} r={6.5} />
      </g>
    </svg>
  );
}
