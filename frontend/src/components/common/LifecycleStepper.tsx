import { cn } from "../../lib/utils";

type EventState = "DRAFT" | "PUBLISHED" | "LIVE" | "COMPLETED" | "CANCELLED";

const steps = [
  ["DRAFT", "Draft"],
  ["PUBLISHED", "Published"],
  ["LIVE", "Live"],
  ["COMPLETED", "Completed"],
] as const;

/**
 * Visual progress through the event lifecycle. Step names are CSS-generated
 * and the whole graphic is aria-hidden: the adjacent written "Event status"
 * is the accessible source, so nothing is announced twice.
 */
export function LifecycleStepper({ state }: { state: EventState }) {
  const current = steps.findIndex(([value]) => value === state);
  return (
    <ol
      aria-hidden="true"
      className={cn(
        "lifecycle-stepper",
        state === "CANCELLED" && "is-cancelled",
      )}
    >
      {steps.map(([value, label], index) => (
        <li
          key={value}
          data-label={label}
          className={cn(
            index < current && "is-done",
            index === current && "is-current",
          )}
        />
      ))}
    </ol>
  );
}
