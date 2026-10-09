import { cn } from "../../lib/utils";

export type CapacityTone = "normal" | "near" | "full" | "over" | "unknown";

/** Near-capacity threshold used only for presentation emphasis. */
export const NEAR_CAPACITY_PERCENT = 90;

export function capacityTone(
  occupied: number,
  capacity: number | null,
): CapacityTone {
  if (capacity === null) return "unknown";
  if (occupied > capacity) return "over";
  if (occupied === capacity) return "full";
  return (occupied * 100) / capacity >= NEAR_CAPACITY_PERCENT
    ? "near"
    : "normal";
}

/**
 * Visual-only bar. The adjacent text (utilization, limit, remaining) carries
 * the meaning, so the bar is hidden from assistive technology.
 */
export function CapacityMeter({
  occupied,
  capacity,
  className,
}: {
  occupied: number;
  capacity: number | null;
  className?: string;
}) {
  const tone = capacityTone(occupied, capacity);
  const fill =
    capacity === null ? 0 : Math.min(100, (occupied * 100) / capacity);
  return (
    <div
      aria-hidden="true"
      className={cn("capacity-meter", `capacity-${tone}`, className)}
    >
      <div className="capacity-meter-fill" style={{ width: `${fill}%` }} />
      <div
        className="capacity-meter-mark"
        style={{ left: `${NEAR_CAPACITY_PERCENT}%` }}
      />
    </div>
  );
}
