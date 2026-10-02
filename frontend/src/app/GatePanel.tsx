import { useEffect, useRef, useState } from "react";
import {
  createGate,
  EventApiError,
  getEventDetail,
  type ManagementDetail,
} from "../services/events";

const blockerLabels: Record<string, string> = {
  VISIBILITY_REQUIRED: "Choose event visibility.",
  SCHEDULE_REQUIRED: "Configure the event start and end.",
  TIME_ZONE_REQUIRED: "Choose the event time zone.",
  REGISTRATION_CAPACITY_REQUIRED: "Configure registration capacity.",
  CONFIGURED_GATE_REQUIRED: "Create a gate associated with this event.",
};
interface Props {
  detail: ManagementDetail;
  csrf?: string;
  onCurrent: (detail: ManagementDetail) => void;
  onSessionExpired: () => void;
  onScopeLost: () => void;
}
interface Attempt {
  revision: number;
  key: string;
}

export function GatePanel({
  detail,
  csrf,
  onCurrent,
  onSessionExpired,
  onScopeLost,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [feedback, setFeedback] = useState("");
  const controller = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const reloadButton = useRef<HTMLButtonElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!busy) {
      if (attempt) retryButton.current?.focus();
      else if (refreshRequired) reloadButton.current?.focus();
    }
  }, [attempt, refreshRequired, busy]);
  const canCreate =
    !!csrf &&
    detail.permitted_actions.includes("CREATE_GATE") &&
    (detail.state === "DRAFT" || detail.state === "PUBLISHED");
  function denied(error: unknown): boolean {
    if (error instanceof EventApiError && error.status === 401) {
      onSessionExpired();
      return true;
    }
    if (
      error instanceof EventApiError &&
      (error.status === 403 || error.status === 404)
    ) {
      onScopeLost();
      return true;
    }
    return false;
  }
  async function refresh(signal: AbortSignal) {
    const current = await getEventDetail(detail.event_id, signal);
    if (signal.aborted) return;
    onCurrent(current);
    setRefreshRequired(false);
    setAttempt(null);
    heading.current?.focus();
  }
  async function send(next: Attempt) {
    if (busy || !canCreate) return;
    controller.current = new AbortController();
    const signal = controller.current.signal;
    setBusy(true);
    setFeedback("");
    let confirmed = false;
    try {
      const result = await createGate(
        detail.event_id,
        next.revision,
        csrf!,
        next.key,
        signal,
      );
      if (signal.aborted) return;
      confirmed = true;
      setAttempt(null);
      setRefreshRequired(true);
      setFeedback(
        `Gate ${result.gate_id} created. Revision ${result.revision}. Refreshing current detail.`,
      );
      await refresh(signal);
      if (!signal.aborted)
        setFeedback(
          `Gate ${result.gate_id} created. Current detail refreshed.`,
        );
    } catch (error) {
      if (signal.aborted || denied(error)) return;
      const reference =
        error instanceof EventApiError && error.correlationId
          ? ` Reference: ${error.correlationId}.`
          : "";
      if (confirmed) {
        setRefreshRequired(true);
        setAttempt(null);
        setFeedback(
          `Gate creation is confirmed, but current detail could not be refreshed. Retry loading detail.${reference}`,
        );
      } else if (
        error instanceof EventApiError &&
        [400, 409, 422].includes(error.status)
      ) {
        setAttempt(null);
        setRefreshRequired(true);
        setFeedback(
          (error.status === 400
            ? "Gate configuration was rejected. Reload current detail before trying again."
            : error.status === 422
              ? "Gates cannot be created in this event state. Reload current detail."
              : error.code === "IDEMPOTENCY_CONFLICT"
                ? "This gate request conflicts with a previous request. Reload current detail."
                : "Event data changed. Reload current detail before creating a gate.") +
            reference,
        );
      } else {
        setAttempt(next);
        setFeedback(
          `The gate creation result is unknown. Retry the same request to confirm it without creating a duplicate.${reference}`,
        );
      }
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  async function reload() {
    if (busy) return;
    controller.current = new AbortController();
    const signal = controller.current.signal;
    setBusy(true);
    try {
      await refresh(signal);
      if (!signal.aborted)
        setFeedback(
          "Current gate configuration refreshed. Review readiness before proceeding.",
        );
    } catch (error) {
      if (!signal.aborted && !denied(error))
        setFeedback(
          "Current detail could not be loaded. Retry loading detail.",
        );
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="gate-panel" aria-labelledby="gate-panel-heading">
      <h3 id="gate-panel-heading" ref={heading} tabIndex={-1}>
        Gate configuration and readiness
      </h3>
      <p className="notice">
        {detail.readiness.configured_gate_present
          ? "Gate configured. The Publish and Live gate prerequisite is satisfied."
          : "Gate missing. Publish and Live require a gate associated with this event."}
      </p>
      <p>
        A persistent event–gate association is sufficient. Staff assignment,
        scanner hardware, connectivity, and scanner health are separate
        operational concerns.
      </p>
      {detail.gates.length ? (
        <ul>
          {detail.gates.map((gate) => (
            <li key={gate.gate_id}>Gate {gate.gate_id}</li>
          ))}
        </ul>
      ) : (
        <p>No gates associated.</p>
      )}
      {detail.readiness.publish_blockers.length > 0 && (
        <div>
          <h4>Publish blockers</h4>
          <ul>
            {detail.readiness.publish_blockers.map((blocker) => (
              <li key={blocker}>
                {blockerLabels[blocker] ?? "Event configuration is incomplete."}
              </li>
            ))}
          </ul>
        </div>
      )}
      {detail.readiness.live_blockers.length > 0 && (
        <div>
          <h4>Live blockers</h4>
          <ul>
            {detail.readiness.live_blockers.map((blocker) => (
              <li key={blocker}>
                {blockerLabels[blocker] ?? "Event configuration is incomplete."}
              </li>
            ))}
          </ul>
        </div>
      )}
      {feedback && (
        <p
          className="notice"
          role={attempt || refreshRequired ? "alert" : "status"}
        >
          {feedback}
        </p>
      )}
      {canCreate && !attempt && !refreshRequired && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void send({ revision: detail.revision, key: crypto.randomUUID() })
          }
        >
          {busy ? "Creating gate…" : "Create gate"}
        </button>
      )}
      {canCreate && attempt && (
        <button
          ref={retryButton}
          type="button"
          disabled={busy}
          onClick={() => void send(attempt)}
        >
          {busy ? "Confirming gate…" : "Retry same gate request"}
        </button>
      )}
      {refreshRequired && (
        <button
          ref={reloadButton}
          type="button"
          disabled={busy}
          onClick={() => void reload()}
        >
          {busy ? "Loading current detail…" : "Reload gate detail"}
        </button>
      )}
    </section>
  );
}
