import { useEffect, useRef, useState } from "react";
import {
  createGate,
  EventApiError,
  getEventDetail,
  type ManagementDetail,
} from "../services/events";
import { gateLabel } from "./gate-label";
import { readinessLabels } from "./event-presentation";
import { staffRoleLabels, type StaffAssignment } from "../services/staff";

interface Props {
  detail: ManagementDetail;
  csrf?: string;
  onCurrent: (detail: ManagementDetail) => void;
  onSessionExpired: () => void;
  onScopeLost: () => void;
  assignments?: StaffAssignment[];
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
  assignments,
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
      await createGate(detail.event_id, next.revision, csrf!, next.key, signal);
      if (signal.aborted) return;
      confirmed = true;
      setAttempt(null);
      setRefreshRequired(true);
      setFeedback("Gate created. Refreshing current detail.");
      await refresh(signal);
      if (!signal.aborted)
        setFeedback("Gate created. Current detail refreshed.");
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
        Gates
      </h3>
      <p
        className={`notice ${detail.readiness.configured_gate_present ? "notice-success" : "notice-warning"}`}
      >
        {detail.readiness.configured_gate_present
          ? "Gate configured. The gate requirement for publishing and starting the event is satisfied."
          : "Your event needs at least one configured gate before it can be published or started."}
      </p>
      <p>
        Add gates here and assign Gate / Security staff in Team &amp; Staff.
      </p>
      {detail.gates.length ? (
        <ul className="gate-list">
          {[...detail.gates]
            .sort((a, b) => a.gate_id.localeCompare(b.gate_id))
            .map((gate) => (
              <li key={gate.gate_id} className="gate-card">
                <strong>{gateLabel(detail.gates, gate.gate_id)}</strong> ·
                Configured
                <div>
                  <p>Team assignment:</p>
                  {assignments ? (
                    assignments
                      .filter((row) => row.gateId === gate.gate_id)
                      .map((row) => (
                        <p key={row.id}>
                          {row.email ?? "Verified account"} —{" "}
                          {staffRoleLabels[row.role]}
                        </p>
                      ))
                  ) : (
                    <p>Open Team &amp; Staff to check assignments</p>
                  )}
                  {assignments &&
                    !assignments.some((row) => row.gateId === gate.gate_id) && (
                      <p>No staff assigned</p>
                    )}
                </div>
                <details className="advanced-details">
                  <summary>Advanced details</summary>Gate reference:{" "}
                  {gate.gate_id}
                </details>
              </li>
            ))}
        </ul>
      ) : (
        <p>No gates configured.</p>
      )}
      {detail.readiness.publish_blockers.length > 0 && (
        <div>
          <h4>Before publishing</h4>
          <ul>
            {detail.readiness.publish_blockers.map((blocker) => (
              <li key={blocker}>
                {readinessLabels[blocker] ??
                  "Event configuration is incomplete. Review Setup."}
              </li>
            ))}
          </ul>
        </div>
      )}
      {detail.readiness.live_blockers.length > 0 && (
        <div>
          <h4>Before starting the event</h4>
          <ul>
            {detail.readiness.live_blockers.map((blocker) => (
              <li key={blocker}>
                {readinessLabels[blocker] ??
                  "Event configuration is incomplete. Review Setup."}
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
