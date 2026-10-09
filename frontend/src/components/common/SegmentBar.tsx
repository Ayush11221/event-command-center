export type SegmentTone =
  "success" | "critical" | "warning" | "pending" | "muted";

/**
 * Proportional bar for counts that are also written out in adjacent text, so
 * it is decorative (aria-hidden) and never the only carrier of an outcome.
 */
export function SegmentBar({
  segments,
  total,
}: {
  segments: { value: number; tone: SegmentTone }[];
  total: number;
}) {
  return (
    <div aria-hidden="true" className="segment-bar">
      {total > 0 &&
        segments
          .filter((segment) => segment.value > 0)
          .map((segment, index) => (
            <span
              key={index}
              className={`segment-${segment.tone}`}
              style={{ width: `${(segment.value * 100) / total}%` }}
            />
          ))}
    </div>
  );
}
