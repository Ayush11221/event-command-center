import { useEffect, useRef, useState } from "react";
import { EventApiError } from "../services/events";
import {
  prepareEvent,
  type EventCreationAttempt,
} from "../services/prepare-event";
import {
  DEFAULT_EVENT_TIME_ZONE,
  serializeEventTime,
  timeZoneLabel,
} from "../services/event-time";
import { EventDateTimeControls } from "./EventDateTimeControls";

interface Props {
  csrf: string;
  onCreated: (eventId: string) => void;
  onSessionExpired: () => void;
  onForbidden: () => void;
}

export function CreateDraftForm({
  csrf,
  onCreated,
  onSessionExpired,
  onForbidden,
}: Props) {
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [capacity, setCapacity] = useState("100");
  const [location, setLocation] = useState("");
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [attempt, setAttempt] = useState<EventCreationAttempt | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [fieldError, setFieldError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const locked = pending || attempt !== null;

  useEffect(() => {
    if (fieldError && !pending) input.current?.focus();
  }, [fieldError, pending]);
  useEffect(() => {
    if (attempt && !pending) retryButton.current?.focus();
  }, [attempt, pending]);

  async function send(next: EventCreationAttempt) {
    setPending(true);
    setFeedback("");
    setFieldError("");
    try {
      const eventId = await prepareEvent(next, csrf);
      setAttempt(null);
      setName("");
      setStart("");
      setEnd("");
      setLocation("");
      setCapacity("100");
      setVisibility("PUBLIC");
      setFeedback(
        "Draft “" +
          next.name +
          "” created with your dates, registration limit and Gate 1. Publish it when ready.",
      );
      onCreated(eventId);
    } catch (error) {
      if (error instanceof EventApiError && error.status === 401) {
        onSessionExpired();
        return;
      }
      if (error instanceof EventApiError && error.status === 403) {
        setAttempt(next.eventId ? next : null);
        setFeedback(
          "Organizer access is no longer available. Refreshing your workspace.",
        );
        onForbidden();
      } else if (next.eventId) {
        setAttempt(next);
        setFeedback(
          "Your draft was saved, but setup could not be confirmed. Retry to finish the same draft, or open the saved draft to review it.",
        );
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
          "This request conflicts with an earlier request. Refresh the event list before trying again.",
        );
      } else {
        setAttempt(next);
        setFeedback(
          "The result is unknown. Retry this request to confirm it without creating a duplicate.",
        );
      }
    } finally {
      setPending(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (locked) return;
    const trimmed = name.trim();
    if (!trimmed || [...name].length > 200) {
      setFieldError("Enter a nonblank event name of at most 200 characters.");
      return;
    }
    try {
      const startAt = serializeEventTime(start, DEFAULT_EVENT_TIME_ZONE);
      const endAt = serializeEventTime(end, DEFAULT_EVENT_TIME_ZONE);
      if (!startAt || !endAt)
        throw new Error(
          "Choose a start date and time, and an end date and time.",
        );
      if (endAt <= startAt)
        throw new Error("The event must end after it starts.");
      const limit = Number(capacity);
      if (
        !/^\d+$/.test(capacity) ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 2147483647
      )
        throw new Error(
          "Enter a registration limit between 1 and 2,147,483,647.",
        );
      if ([...location.trim()].length > 500)
        throw new Error("Keep the location to 500 characters or fewer.");
      void send({
        name: trimmed,
        key: crypto.randomUUID(),
        gateKey: crypto.randomUUID(),
        settings: {
          start_at: startAt,
          end_at: endAt,
          time_zone: DEFAULT_EVENT_TIME_ZONE,
          registration_capacity: limit,
          visibility,
          public_location: location.trim() || null,
        },
      });
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Check the event details.",
      );
    }
  }

  return (
    <section
      id="create-draft"
      className="create-section"
      aria-labelledby="create-heading"
    >
      <div className="section-heading">
        <p className="eyebrow">START HERE</p>
        <h2 id="create-heading">Create an event</h2>
        <p>
          Fill in the essentials. We save a draft and add Gate 1 for entry
          scanning.
        </p>
      </div>
      <form
        className="draft-form simple-create-form"
        onSubmit={submit}
        noValidate
      >
        <fieldset disabled={locked}>
          <label htmlFor="event-name">
            <span>
              Event name <span aria-hidden="true">*</span>
            </span>
            <input
              ref={input}
              id="event-name"
              value={name}
              required
              onChange={(event) => {
                setName(event.target.value);
                setFieldError("");
              }}
              aria-invalid={fieldError ? "true" : undefined}
              aria-describedby={fieldError ? "event-name-error" : undefined}
            />
          </label>
          {fieldError && (
            <p id="event-name-error" className="field-error">
              {fieldError}
            </p>
          )}
          <p className="form-group-help">
            All times use {timeZoneLabel(DEFAULT_EVENT_TIME_ZONE)}.
          </p>
          <EventDateTimeControls
            id="create-start"
            label="Event starts"
            step={60}
            value={start}
            onChange={setStart}
          />
          <EventDateTimeControls
            id="create-end"
            label="Event ends"
            step={60}
            value={end}
            onChange={setEnd}
          />
          <label htmlFor="create-capacity">
            Registration limit
            <input
              id="create-capacity"
              type="number"
              min="1"
              max="2147483647"
              step="1"
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
            />
          </label>
          <label htmlFor="create-location">
            Location (optional)
            <input
              id="create-location"
              value={location}
              maxLength={500}
              placeholder="e.g. College auditorium"
              onChange={(event) => setLocation(event.target.value)}
            />
          </label>
          <details className="advanced-details">
            <summary>Event access (optional)</summary>
            <label htmlFor="create-access">
              Who can find this event?
              <select
                id="create-access"
                value={visibility}
                onChange={(event) =>
                  setVisibility(event.target.value as "PUBLIC" | "PRIVATE")
                }
              >
                <option value="PUBLIC">Public — listed in Public events</option>
                <option value="PRIVATE">
                  Invitation only — share a private event link
                </option>
              </select>
            </label>
          </details>
        </fieldset>
        <p className="field-help">
          Next: assign your gate staff, publish to accept registrations, then
          Start live event to open admission. Extra settings are in Setup.
        </p>
        <button type="submit" disabled={locked}>
          {pending ? "Creating…" : "Create event"}
        </button>
        {attempt && (
          <>
            <button
              ref={retryButton}
              type="button"
              className="secondary-button"
              disabled={pending}
              onClick={() => void send(attempt)}
            >
              Retry same request
            </button>
            {attempt.eventId && (
              <button
                type="button"
                className="secondary-button"
                disabled={pending}
                onClick={() => onCreated(attempt.eventId!)}
              >
                Open saved draft
              </button>
            )}
          </>
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
