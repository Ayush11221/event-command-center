import { useState } from "react";
import type { ManagementEvent } from "../services/events";

export function CompletedEvents({
  userId,
  events,
  onOpen,
  schedule,
}: {
  userId: string;
  events: ManagementEvent[];
  onOpen: (eventId: string) => void;
  schedule: (event: ManagementEvent) => string;
}) {
  const key = `eoc.completed.hidden.v1:${userId}`;
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      return Array.isArray(saved)
        ? saved
            .filter(
              (id): id is string => typeof id === "string" && id.length <= 200,
            )
            .slice(0, 500)
        : [];
    } catch {
      return [];
    }
  });
  const [message, setMessage] = useState("");
  // Only fresh, server-authorized COMPLETED events may be hidden or restored.
  const completed = events.filter((event) => event.state === "COMPLETED");
  function change(eventId: string, remove: boolean) {
    if (!completed.some((event) => event.event_id === eventId)) return;
    const next = remove
      ? [...new Set([...hidden, eventId])].slice(-500)
      : hidden.filter((id) => id !== eventId);
    setHidden(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setMessage(
        remove
          ? "Event removed from this browser’s workspace list. You can restore it below."
          : "Event restored to Event completed.",
      );
    } catch {
      setMessage(
        "The list was updated for this visit. Your browser could not save this preference.",
      );
    }
  }
  const visible = completed.filter((event) => !hidden.includes(event.event_id));
  const removed = completed.filter((event) => hidden.includes(event.event_id));
  return (
    <section
      className="event-section completed-events"
      aria-label="Event completed"
    >
      <div className="section-heading">
        <h2>Event completed</h2>
        <p>
          Past events and their records. Remove hides an event from this
          browser’s list; attendance, certificates and audit history stay
          available.
        </p>
      </div>
      {message && <p role="status">{message}</p>}
      {visible.length === 0 ? (
        <p>No completed events in this list.</p>
      ) : (
        <ul className="event-list">
          {visible.map((event) => (
            <li className="completed-event-row" key={event.event_id}>
              <button
                className="event-row"
                onClick={() => onOpen(event.event_id)}
              >
                <span className="event-row-title">{event.name}</span>
                <span className="event-row-date">{schedule(event)}</span>
                <span className="state-pill state-completed">Completed</span>
              </button>
              <button
                className="secondary-button"
                aria-label={`Remove ${event.name} from workspace`}
                onClick={() => change(event.event_id, true)}
              >
                Remove from workspace
              </button>
            </li>
          ))}
        </ul>
      )}
      {removed.length > 0 && (
        <details className="advanced-details">
          <summary>Removed events ({removed.length})</summary>
          <ul className="event-list">
            {removed.map((event) => (
              <li className="removed-event-row" key={event.event_id}>
                <span>{event.name}</span>
                <button
                  className="secondary-button"
                  aria-label={`Restore ${event.name}`}
                  onClick={() => change(event.event_id, false)}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
