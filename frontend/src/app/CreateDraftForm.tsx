import { useEffect, useRef, useState } from "react";
import { createDraft, EventApiError } from "../services/events";

interface Props {
  csrf: string;
  onCreated: (eventId: string) => void;
  onSessionExpired: () => void;
  onForbidden: () => void;
}

interface Attempt {
  name: string;
  key: string;
}

export function CreateDraftForm({
  csrf,
  onCreated,
  onSessionExpired,
  onForbidden,
}: Props) {
  const [name, setName] = useState("");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [fieldError, setFieldError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (fieldError && !pending) input.current?.focus();
  }, [fieldError, pending]);

  async function send(next: Attempt) {
    setPending(true);
    setFeedback("");
    setFieldError("");
    try {
      const result = await createDraft(next.name, csrf, next.key);
      setAttempt(null);
      setName("");
      setFeedback(
        `Draft “${result.name}” created. Revision ${result.revision}.`,
      );
      onCreated(result.event_id);
    } catch (error) {
      if (error instanceof EventApiError && error.status === 401) {
        onSessionExpired();
        return;
      }
      if (error instanceof EventApiError && error.status === 403) {
        setAttempt(null);
        setFeedback(
          "Organizer access is no longer available. Refreshing your workspace.",
        );
        onForbidden();
      } else if (error instanceof EventApiError && error.status === 400) {
        setAttempt(null);
        setFieldError("Enter a nonblank event name of at most 200 characters.");
        setFeedback("Check the event name and try again.");
      } else if (
        error instanceof EventApiError &&
        error.code === "IDEMPOTENCY_CONFLICT"
      ) {
        setAttempt(null);
        setFeedback(
          "This draft request conflicts with a previous request. Refresh the event list before trying again.",
        );
      } else {
        setAttempt(next);
        const reference =
          error instanceof EventApiError && error.correlationId
            ? ` Reference: ${error.correlationId}.`
            : "";
        setFeedback(
          `The result is unknown. Retry the same draft request with its original key.${reference}`,
        );
      }
    } finally {
      setPending(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || [...name].length > 200) {
      setFieldError("Enter a nonblank event name of at most 200 characters.");
      setFeedback("Check the event name and try again.");
      return;
    }
    void send({ name: trimmed, key: crypto.randomUUID() });
  }

  return (
    <section
      id="create-draft"
      className="create-section"
      aria-labelledby="create-heading"
    >
      <div className="section-heading">
        <p className="eyebrow">START HERE</p>
        <h2 id="create-heading">Create a Draft</h2>
        <p>
          A name is enough to start. Your event remains a Draft until it is
          configured and published in a later step.
        </p>
      </div>
      <form className="draft-form" onSubmit={submit} noValidate>
        <label htmlFor="event-name">
          Event name <span aria-hidden="true">*</span>
        </label>
        <div className="draft-form-row">
          <input
            ref={input}
            id="event-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setFieldError("");
            }}
            required
            disabled={pending || attempt !== null}
            aria-invalid={fieldError ? "true" : undefined}
            aria-describedby={
              fieldError ? "event-name-error" : "event-name-help"
            }
          />
          <button type="submit" disabled={pending || attempt !== null}>
            {pending ? "Creating…" : "Create Draft"}
          </button>
        </div>
        <p id="event-name-help" className="field-help">
          Up to 200 characters. Only the name is required.
        </p>
        {fieldError && (
          <p id="event-name-error" className="field-error">
            {fieldError}
          </p>
        )}
        {attempt && (
          <button
            type="button"
            className="secondary-button"
            disabled={pending}
            onClick={() => void send(attempt)}
          >
            Retry same request
          </button>
        )}
        {feedback && (
          <p className="form-feedback" role="status" aria-live="polite">
            {feedback}
          </p>
        )}
      </form>
    </section>
  );
}
