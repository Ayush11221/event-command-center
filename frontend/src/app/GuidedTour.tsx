import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";

export interface TourStep {
  target: string;
  title: string;
  body: string;
}

export const WORKSPACE_TOUR: TourStep[] = [
  {
    target: ".workspace-bar-inner",
    title: "Your event and role",
    body: "This bar always shows which event you are managing and in which role. Switch events here; access is still checked by the server.",
  },
  {
    target: ".nav-tabs",
    title: "Event sections",
    body: "Overview, Setup, Registrations, Team & Staff and Gates for the selected event.",
  },
  {
    target: ".nav-link-live",
    title: "Live Operations",
    body: "Real-time occupancy, the advisory forecast, the venue view and a big-screen mode for the control room.",
  },
  {
    target: ".palette-trigger",
    title: "Quick actions",
    body: "Press Ctrl K (⌘K on Mac) anywhere in the workspace to jump to any section, page or event.",
  },
  {
    target: ".settings-trigger",
    title: "Settings",
    body: "Switch between Light, Dark or System appearance, and sign out.",
  },
];

/**
 * Non-blocking spotlight walkthrough. Only steps whose target is currently
 * rendered are shown, so it never points at controls the role cannot see.
 */
export function GuidedTour({
  steps,
  onClose,
}: {
  steps: TourStep[];
  onClose: () => void;
}) {
  const available = useRef(
    steps.filter((step) => document.querySelector(step.target)),
  ).current;
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const step = available[index];

  const measure = useCallback(() => {
    const node = step && document.querySelector(step.target);
    setRect(node ? node.getBoundingClientRect() : null);
  }, [step]);

  useLayoutEffect(() => {
    const node = step && document.querySelector(step.target);
    node?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    measure();
    const timer = setTimeout(measure, 350);
    heading.current?.focus();
    return () => clearTimeout(timer);
  }, [step, measure]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [measure, onClose]);

  if (!step) return null;
  const pad = 8;
  const below = rect ? rect.bottom + 220 < window.innerHeight : true;
  const cardTop = rect
    ? below
      ? rect.bottom + pad + 10
      : Math.max(12, rect.top - pad - 10 - 200)
    : 80;
  const cardLeft = rect
    ? Math.min(Math.max(12, rect.left), window.innerWidth - 352)
    : 12;

  return (
    <>
      {rect && (
        <div
          aria-hidden="true"
          className="tour-spotlight"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
          }}
        />
      )}
      <section
        className="tour-card"
        role="dialog"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        style={{ top: cardTop, left: cardLeft }}
      >
        <p className="tour-step">
          Step {index + 1} of {available.length}
        </p>
        <h2 id="tour-title" ref={heading} tabIndex={-1}>
          {step.title}
        </h2>
        <p id="tour-body">{step.body}</p>
        <div className="tour-actions">
          <button type="button" className="text-button" onClick={onClose}>
            Skip tour
          </button>
          {index > 0 && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => setIndex(index - 1)}
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              index + 1 < available.length ? setIndex(index + 1) : onClose()
            }
          >
            {index + 1 < available.length ? "Next" : "Finish"}
          </button>
        </div>
        <button
          type="button"
          className="tour-close"
          aria-label="Close tour"
          onClick={onClose}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </section>
    </>
  );
}
