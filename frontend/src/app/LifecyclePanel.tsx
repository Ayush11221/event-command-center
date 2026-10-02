import { useEffect, useRef, useState } from "react";
import {
  EventApiError,
  getEventDetail,
  transitionEvent,
  type ManagementDetail,
  type TransitionBody,
} from "../services/events";

const controls = [
  {
    action: "PUBLISH",
    target: "PUBLISHED",
    label: "Publish event",
    from: ["DRAFT"],
  },
  {
    action: "LIVE",
    target: "LIVE",
    label: "Start live event",
    from: ["PUBLISHED"],
  },
  {
    action: "COMPLETE",
    target: "COMPLETED",
    label: "Complete event",
    from: ["LIVE"],
  },
  {
    action: "CANCEL",
    target: "CANCELLED",
    label: "Cancel event",
    from: ["DRAFT", "PUBLISHED", "LIVE"],
  },
] as const;
const reasonLabels = {
  NOT_OPEN_YET: "The configured opening time has not been reached.",
  SCHEDULED_CLOSE_REACHED:
    "The scheduled registration closing time has been reached.",
  MANUALLY_CLOSED: "Registration is manually closed.",
};
interface Props {
  detail: ManagementDetail;
  owner: boolean;
  csrf?: string;
  onCurrent: (detail: ManagementDetail) => void;
  onSessionExpired: () => void;
  onScopeLost: () => void;
}
interface Attempt {
  body: TransitionBody;
  revision: number;
  key: string;
}

export function LifecyclePanel({
  detail,
  owner,
  csrf,
  onCurrent,
  onSessionExpired,
  onScopeLost,
}: Props) {
  const [selected, setSelected] = useState<(typeof controls)[number] | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [feedback, setFeedback] = useState("");
  const controller = useRef<AbortController | null>(null);
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const reloadButton = useRef<HTMLButtonElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!busy) {
      if (attempt) retryButton.current?.focus();
      else if (refreshRequired) reloadButton.current?.focus();
    }
  }, [attempt, refreshRequired, busy]);
  useEffect(() => {
    if (selected?.target === "CANCELLED") reasonInput.current?.focus();
    else if (selected) confirmationHeading.current?.focus();
  }, [selected]);
  const canMutate = owner && !!csrf;
  function denied(error: unknown) {
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
    setSelected(null);
    setAttempt(null);
    heading.current?.focus();
  }
  async function send(next: Attempt) {
    if (busy || !canMutate) return;
    controller.current = new AbortController();
    const signal = controller.current.signal;
    setBusy(true);
    setFeedback("");
    let confirmed = false;
    try {
      const result = await transitionEvent(
        detail.event_id,
        next.body,
        next.revision,
        csrf!,
        next.key,
        signal,
      );
      if (signal.aborted) return;
      confirmed = true;
      setAttempt(null);
      setSelected(null);
      setReason("");
      setRefreshRequired(true);
      setFeedback(
        `Lifecycle changed to ${result.state}. Revision ${result.revision}. Refreshing current detail.`,
      );
      await refresh(signal);
      if (!signal.aborted)
        setFeedback(
          `Lifecycle changed to ${result.state}. Current detail refreshed.`,
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
          `The lifecycle change is confirmed, but current detail could not be refreshed. Retry loading detail.${reference}`,
        );
      } else if (
        error instanceof EventApiError &&
        [400, 409, 422].includes(error.status)
      ) {
        setAttempt(null);
        setRefreshRequired(true);
        setFeedback(
          (error.code === "MISSING_CONFIGURED_GATE"
            ? "A configured gate is required. Reload current detail to review blockers."
            : error.code === "VALIDATION"
              ? "The lifecycle request was rejected. Review the cancellation reason or event configuration, then reload current detail."
              : error.code === "INVALID_TRANSITION"
                ? "This lifecycle transition is no longer permitted. Reload current detail."
                : error.code === "IDEMPOTENCY_CONFLICT"
                  ? "This request conflicts with a previous request. Reload current detail."
                  : "Event data changed. Reload current detail before proceeding.") +
            reference,
        );
      } else {
        setAttempt(next);
        setFeedback(
          `The lifecycle result is unknown. Retry the same request to confirm the outcome.${reference}`,
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
          "Current lifecycle and availability refreshed. Review before proceeding.",
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
    <section
      className="lifecycle-panel"
      aria-labelledby="lifecycle-panel-heading"
    >
      <h3 id="lifecycle-panel-heading" ref={heading} tabIndex={-1}>
        Lifecycle and registration policy
      </h3>
      <dl className="event-detail-fields">
        <div>
          <dt>Lifecycle state</dt>
          <dd>{detail.state}</dd>
        </div>
        <div>
          <dt>Registration policy status</dt>
          <dd>{detail.availability.policy_status}</dd>
        </div>
        <div>
          <dt>Policy opening time</dt>
          <dd>
            {detail.availability.opens_at
              ? new Date(detail.availability.opens_at).toLocaleString()
              : "On publication"}
          </dd>
        </div>
        <div>
          <dt>Policy closing time</dt>
          <dd>
            {detail.availability.closes_at
              ? new Date(detail.availability.closes_at).toLocaleString()
              : "Not configured"}
          </dd>
        </div>
      </dl>
      <p className="notice">
        {detail.state === "PUBLISHED"
          ? "Published lifecycle permits registration only when registration policy is OPEN."
          : `The ${detail.state} lifecycle prevents new registration independently of registration policy status.`}
      </p>
      {detail.availability.reasons.length > 0 ? (
        <ul>
          {detail.availability.reasons.map((value) => (
            <li key={value}>{reasonLabels[value]}</li>
          ))}
        </ul>
      ) : (
        <p>No registration policy closure reasons apply.</p>
      )}
      <p>
        Participant registration is unavailable. Policy OPEN describes
        configuration only.
      </p>
      <p className="freshness">
        Policy confirmed {new Date(detail.availability.as_of).toLocaleString()}.
      </p>
      {feedback && (
        <p
          id="lifecycle-feedback"
          className="notice"
          role={attempt || refreshRequired ? "alert" : "status"}
        >
          {feedback}
        </p>
      )}
      {canMutate &&
        !attempt &&
        !refreshRequired &&
        (selected ? (
          <form
            aria-labelledby="lifecycle-confirmation-heading"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              if (!detail.permitted_actions.includes(selected.action)) {
                setRefreshRequired(true);
                return;
              }
              if (selected.target === "CANCELLED" && !reason.trim()) {
                setReasonError(true);
                setFeedback("Enter a nonblank cancellation reason.");
                reasonInput.current?.focus();
                return;
              }
              void send({
                body: {
                  target_state: selected.target,
                  ...(selected.target === "CANCELLED"
                    ? { reason: reason.trim() }
                    : {}),
                },
                revision: detail.revision,
                key: crypto.randomUUID(),
              });
            }}
          >
            <h4
              id="lifecycle-confirmation-heading"
              ref={confirmationHeading}
              tabIndex={-1}
            >
              {selected.target === "CANCELLED"
                ? "Confirm cancellation. This event cannot be reopened."
                : `Confirm: ${selected.label}.`}
            </h4>
            {selected.target === "CANCELLED" && (
              <label className="field">
                Cancellation reason
                <textarea
                  ref={reasonInput}
                  value={reason}
                  aria-invalid={reasonError || undefined}
                  aria-describedby={
                    reasonError ? "lifecycle-feedback" : undefined
                  }
                  disabled={busy}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setReasonError(false);
                  }}
                />
              </label>
            )}
            <div className="lifecycle-actions">
              <button type="submit" disabled={busy}>
                {busy
                  ? "Changing lifecycle…"
                  : `Confirm ${selected.label.toLowerCase()}`}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  setSelected(null);
                  setFeedback("");
                  heading.current?.focus();
                }}
              >
                Keep current lifecycle
              </button>
            </div>
          </form>
        ) : (
          <div className="lifecycle-actions">
            {controls
              .filter(
                (control) =>
                  detail.permitted_actions.includes(control.action) &&
                  (control.from as readonly string[]).includes(detail.state),
              )
              .map((control) => {
                const blocked =
                  control.action === "PUBLISH"
                    ? detail.readiness.publish_blockers.length > 0
                    : control.action === "LIVE"
                      ? detail.readiness.live_blockers.length > 0
                      : false;
                return (
                  <div key={control.action}>
                    <button
                      type="button"
                      disabled={busy || blocked}
                      onClick={() => {
                        setSelected(control);
                        setReasonError(false);
                        setFeedback("");
                      }}
                    >
                      {control.label}
                    </button>
                    {blocked && (
                      <p>
                        Resolve the{" "}
                        {control.action === "PUBLISH" ? "Publish" : "Live"}{" "}
                        blockers shown in readiness.
                      </p>
                    )}
                  </div>
                );
              })}
          </div>
        ))}
      {canMutate && attempt && (
        <button
          ref={retryButton}
          type="button"
          disabled={busy}
          onClick={() => void send(attempt)}
        >
          {busy ? "Confirming lifecycle…" : "Retry same lifecycle request"}
        </button>
      )}
      {refreshRequired && (
        <button
          ref={reloadButton}
          type="button"
          disabled={busy}
          onClick={() => void reload()}
        >
          {busy ? "Loading current detail…" : "Reload lifecycle detail"}
        </button>
      )}
    </section>
  );
}
