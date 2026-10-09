import type { ReactNode } from "react";

/**
 * Re-mounts on change so a short CSS settle (opacity + slight lift) marks a
 * new confirmed value. Never counts through invented intermediate numbers.
 */
export function LiveValue({ value }: { value: ReactNode }) {
  return (
    <span key={String(value)} className="live-value">
      {value}
    </span>
  );
}
