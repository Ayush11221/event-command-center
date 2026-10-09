import { useEffect, useState } from "react";

/**
 * One-shot decorative confetti. Rendered only for a real, server-confirmed
 * milestone (an event becoming Live); hidden from assistive technology and
 * skipped entirely under reduced motion.
 */
export function Celebration({ trigger }: { trigger: number }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!trigger) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setActive(trigger);
    const timer = setTimeout(() => setActive(0), 2600);
    return () => clearTimeout(timer);
  }, [trigger]);
  if (!active) return null;
  return (
    <div className="celebration" aria-hidden="true" key={active}>
      {Array.from({ length: 36 }, (_, i) => (
        <span
          key={i}
          style={{
            left: `${(i * 37) % 100}%`,
            animationDelay: `${(i % 9) * 60}ms`,
            animationDuration: `${1400 + ((i * 53) % 900)}ms`,
          }}
        />
      ))}
    </div>
  );
}
