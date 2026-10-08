import { useEffect, useRef, useState } from "react";
import {
  EventApiError,
  getEventDetail,
  transitionEvent,
  type ManagementDetail,
  type TransitionBody,
} from "../services/events";
import { formatEventTime } from "../services/event-time";
import {
  humanLabel,
  readinessLabels,
  registrationStatus,
} from "./event-presentation";

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
  registeredCount?: number | null;
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
  registeredCount,
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
        `Event is now ${humanLabel(result.state)}. Updating latest information.`,
      );
      await refresh(signal);
      if (!signal.aborted)
        setFeedback(
          `Event is now ${humanLabel(result.state)}. Latest information updated.`,
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
          `The event status change is confirmed, but current detail could not be refreshed. Retry loading detail.${reference}`,
        );
      } else if (
        error instanceof EventApiError &&
        [400, 409, 422].includes(error.status)
      ) {
        setAttempt(null);
        setRefreshRequired(true);
        setFeedback(
          (error.code === "MISSING_CONFIGURED_GATE"
            ? readinessLabels.CONFIGURED_GATE_REQUIRED
            : error.code === "VALIDATION"
              ? "The status change was rejected. Review the cancellation reason or event setup, then reload current detail."
              : error.code === "INVALID_TRANSITION"
                ? "This event status change is no longer available. Reload current detail."
                : error.code === "IDEMPOTENCY_CONFLICT"
                  ? "This request conflicts with a previous request. Reload current detail."
                  : "Event data changed. Reload current detail before proceeding.") +
            reference,
        );
      } else {
        setAttempt(next);
        setFeedback(
          `The status change result is unknown. Retry the same request to confirm the outcome.${reference}`,
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
          "Event status and registration information updated. Review before proceeding.",
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
        Event status and registration
      </h3>
      <dl className="event-detail-fields">
        <div>
          <dt>Event status</dt>
          <dd>{humanLabel(detail.state)}</dd>
        </div>
        <div>
          <dt>Registration</dt>
          <dd>{registrationStatus(detail, registeredCount)}</dd>
        </div>
        <div>
          <dt>Registration opens</dt>
          <dd>
            {detail.availability.opens_at
              ? formatEventTime(detail.availability.opens_at, detail.time_zone)
              : "On publication"}
          </dd>
        </div>
        <div>
          <dt>Registration closes</dt>
          <dd>
            {detail.availability.closes_at
              ? formatEventTime(detail.availability.closes_at, detail.time_zone)
              : "Not configured"}
          </dd>
        </div>
      </dl>
      {detail.availability.reasons.length > 0 && (
        <ul>
          {detail.availability.reasons.map((value) => (
            <li key={value}>{reasonLabels[value]}</li>
          ))}
        </ul>
      )}
      <p>
        Available places are checked in Registrations. Registration closes when
        the event becomes live.
      </p>
      <p className="freshness">
        Registration information confirmed{" "}
        {formatEventTime(detail.availability.as_of, detail.time_zone)}.
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
                  ? "Updating event status…"
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
                Keep current status
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
                      <ul>
                        {(control.action === "PUBLISH"
                          ? detail.readiness.publish_blockers
                          : detail.readiness.live_blockers
                        ).map((reason) => (
                          <li key={reason}>
                            {readinessLabels[reason] ??
                              "Review the event setup before continuing."}
                          </li>
                        ))}
                      </ul>
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
          {busy ? "Confirming event status…" : "Retry same status request"}
        </button>
      )}
      {refreshRequired && (
        <button
          ref={reloadButton}
          type="button"
          disabled={busy}
          onClick={() => void reload()}
        >
          {busy ? "Loading current detail…" : "Reload event status"}
        </button>
      )}
    </section>
  );
}
