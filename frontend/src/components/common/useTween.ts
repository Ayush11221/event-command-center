import { useEffect, useRef, useState } from "react";

/**
 * Eases a *geometric* value (e.g. a fill height) toward its target. Never use
 * this for displayed numbers: counts must only ever show real server values.
 */
export function useTween(target: number, duration = 700): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof requestAnimationFrame !== "function") {
      from.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = origin + (target - origin) * eased;
      from.current = next;
      setValue(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}
