import { useEffect, useRef, useState } from "react";
import {
  EventApiError,
  getEventDetail,
  type ManagementDetail,
} from "../services/events";
import type { EventContext } from "./contexts";

interface Props {
  context: EventContext;
  onSessionExpired: () => void;
  onScopeLost: () => void;
}

type DetailState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; detail: ManagementDetail };

function instant(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Not configured";
}

export function EventDetail({ context, onSessionExpired, onScopeLost }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DetailState>({ phase: "loading" });
  const heading = useRef<HTMLHeadingElement>(null);
  const { eventId, relationship } = context;

  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: "loading" });
    void getEventDetail(eventId, controller.signal)
      .then((detail) => {
        if (!controller.signal.aborted) setState({ phase: "ready", detail });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof EventApiError && error.status === 401) {
          onSessionExpired();
          return;
        }
        if (
          error instanceof EventApiError &&
          (error.status === 403 || error.status === 404)
        ) {
          onScopeLost();
          return;
        }
        const reference =
          error instanceof EventApiError && error.correlationId
            ? ` Reference: ${error.correlationId}.`
            : "";
        setState({
          phase: "error",
          message:
            error instanceof EventApiError && error.code === "VERSION_CONFLICT"
              ? `Event data changed. Reload the current detail.${reference}`
              : `Event detail could not be loaded. Retry to check the current data.${reference}`,
        });
      });
    return () => controller.abort();
  }, [eventId, attempt, onSessionExpired, onScopeLost]);

  useEffect(() => {
    if (state.phase === "ready") heading.current?.focus();
  }, [state.phase]);

  if (state.phase === "loading")
    return (
      <p role="status" className="notice">
        Loading event detail…
      </p>
    );
  if (state.phase === "error")
    return (
      <div role="alert" className="notice critical">
        <p>{state.message}</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Retry event detail
        </button>
      </div>
    );
  const { detail } = state;
  return (
    <section
      id="event-detail"
      aria-labelledby="event-detail-heading"
      className="event-section"
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {relationship === "assigned" ? "EVENT ADMIN" : "ORGANIZER"} · READ
            ONLY
          </p>
          <h2 id="event-detail-heading" ref={heading} tabIndex={-1}>
            {detail.name}
          </h2>
          <p>
            Event setup ·{" "}
            {detail.state.charAt(0) + detail.state.slice(1).toLowerCase()}
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Reload detail
        </button>
      </div>
      <dl className="event-detail-fields">
        <div>
          <dt>Description</dt>
          <dd>{detail.description ?? "Not configured"}</dd>
        </div>
        <div>
          <dt>Public location</dt>
          <dd>{detail.public_location ?? "Not configured"}</dd>
        </div>
        <div>
          <dt>Image reference</dt>
          <dd>{detail.image_url ?? "Not configured"}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>{detail.category ?? "Not configured"}</dd>
        </div>
        <div>
          <dt>Tags</dt>
          <dd>{detail.tags.length ? detail.tags.join(", ") : "None"}</dd>
        </div>
        <div>
          <dt>Visibility</dt>
          <dd>{detail.visibility ?? "Not configured"}</dd>
        </div>
        <div>
          <dt>Start</dt>
          <dd>{instant(detail.start_at)}</dd>
        </div>
        <div>
          <dt>End</dt>
          <dd>{instant(detail.end_at)}</dd>
        </div>
        <div>
          <dt>Time zone</dt>
          <dd>{detail.time_zone ?? "Not configured"}</dd>
        </div>
        <div>
          <dt>Configured registration capacity</dt>
          <dd>{detail.registration_capacity ?? "Not configured"}</dd>
        </div>
        <div>
          <dt>Registration opening time</dt>
          <dd>{instant(detail.registration_opens_at)}</dd>
        </div>
        <div>
          <dt>Configured registration closing time</dt>
          <dd>{instant(detail.registration_closes_at)}</dd>
        </div>
        <div>
          <dt>Cancellation cutoff</dt>
          <dd>{instant(detail.registration_cancellation_cutoff_at)}</dd>
        </div>
        <div>
          <dt>Manual registration closure configured</dt>
          <dd>{detail.registration_manually_closed ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt>Checkout configured</dt>
          <dd>{detail.checkout_enabled ? "Yes" : "No"}</dd>
        </div>
      </dl>
      <h3>Associated gates</h3>
      {detail.gates.length ? (
        <ul>
          {detail.gates.map((gate) => (
            <li key={gate.gate_id}>{gate.gate_id}</li>
          ))}
        </ul>
      ) : (
        <p>No gates associated.</p>
      )}
      <p className="freshness">
        Revision {detail.revision} · Confirmed {instant(detail.as_of)}.
      </p>
    </section>
  );
}
