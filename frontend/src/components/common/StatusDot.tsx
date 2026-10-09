import { cn } from "../../lib/utils";

export type StatusTone = "live" | "pending" | "degraded" | "neutral";

/** Decorative dot that reinforces a written status; never used alone. */
export function StatusDot({
  tone,
  className,
}: {
  tone: StatusTone;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("status-dot", `status-dot-${tone}`, className)}
    />
  );
}
