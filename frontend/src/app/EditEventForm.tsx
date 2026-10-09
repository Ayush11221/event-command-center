import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  editEvent,
  EventApiError,
  getEventDetail,
  type EventEdit,
  type ManagementDetail,
} from "../services/events";
import {
  changedEventFields,
  eventFormPatch,
  eventFormValues,
  EventFormError,
  sameEventValue,
  type EventField,
  type EventFormValues,
} from "../services/event-form";
import {
  formatEventTime,
  timeZoneLabel,
  timeZoneOptions,
} from "../services/event-time";
import { EventDateTimeControls } from "./EventDateTimeControls";

const groups = [
  {
    label: "Basic details",
    owner: false,
    fields: [
      ["name", "Event name", "text"],
      ["description", "Description", "textarea"],
      ["public_location", "Public location", "text"],
      ["image_url", "Event image URL (HTTPS)", "url"],
      ["category", "Category", "text"],
      ["tags", "Tags (one per line)", "textarea"],
    ],
  },
  {
    label: "Schedule",
    owner: true,
    fields: [
      ["time_zone", "Time zone", "zone"],
      ["start_at", "Event starts", "date"],
      ["end_at", "Event ends", "date"],
    ],
  },
  {
    label: "Registration",
    owner: true,
    fields: [
      ["registration_capacity", "Registration limit", "number"],
      ["registration_opens_at", "Registration opens", "date"],
      ["registration_closes_at", "Registration closes", "date"],
      [
        "registration_cancellation_cutoff_at",
        "Participants can cancel until",
        "date",
      ],
      [
        "registration_manually_closed",
        "Close registration manually",
        "checkbox",
      ],
    ],
  },
  {
    label: "Access",
    owner: true,
    fields: [["visibility", "Event access", "access"]],
  },
  {
    label: "Operations",
    owner: true,
    fields: [["checkout_enabled", "Enable check-out", "checkbox"]],
  },
] as const;
const labels = Object.fromEntries(
  groups.flatMap((group) =>
    group.fields.map(([field, label]) => [field, label]),
  ),
);
interface Props {
  detail: ManagementDetail;
  owner: boolean;
  csrf: string;
  editable?: boolean;
  onCurrent: (detail: ManagementDetail) => void;
  onSessionExpired: () => void;
  onScopeLost: () => void;
}

export function EditEventForm({
  detail,
  owner,
  csrf,
  editable = true,
  onCurrent,
  onSessionExpired,
  onScopeLost,
}: Props) {
  const [baseline, setBaseline] = useState(detail);
  const [values, setValues] = useState(() => eventFormValues(detail));
  const [busy, setBusy] = useState(false);
  const [reconcile, setReconcile] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldError, setFieldError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<EventEdit>({});
  const changed = changedEventFields(values, baseline, owner);
  const dirty = changed.length > 0;
  const changedElsewhere = detail.revision > baseline.revision;
  const needsReview = reconcile || (changedElsewhere && dirty);
  const disabled = busy || needsReview || !editable;
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (changedElsewhere && !dirty && !busy && !reconcile) {
      setBaseline(detail);
      setValues(eventFormValues(detail));
    }
  }, [detail, changedElsewhere, dirty, busy, reconcile]);
  useLayoutEffect(() => {
    if (fieldError && !busy)
      document.getElementById(`edit-${fieldError}`)?.focus();
  }, [fieldError, busy]);

  function denied(error: unknown): boolean {
    if (error instanceof EventApiError && error.status === 401) {
      onSessionExpired();
      return true;
    }
    if (error instanceof EventApiError && [403, 404].includes(error.status)) {
      onScopeLost();
      return true;
    }
    return false;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || changedElsewhere) return;
    let body: EventEdit;
    try {
      body = eventFormPatch(values, baseline, owner);
    } catch (error) {
      if (error instanceof EventFormError) {
        setFieldError(error.field);
        setMessage(`${labels[error.field]}: ${error.message}`);
      }
      return;
    }
    if (!Object.keys(body).length) {
      setMessage("No changes to save.");
      return;
    }
    pending.current = body;
    controller.current = new AbortController();
    const signal = controller.current.signal;
    setBusy(true);
    setMessage("");
    setFieldError("");
    try {
      const saved = await editEvent(
        baseline.event_id,
        baseline.revision,
        body,
        csrf,
        signal,
      );
      if (signal.aborted) return;
      pending.current = {};
      setBaseline(saved);
      setValues(eventFormValues(saved));
      onCurrent(saved);
      setMessage("Changes saved.");
    } catch (error) {
      if (signal.aborted || denied(error)) return;
      const reference =
        error instanceof EventApiError && error.correlationId
          ? ` Reference: ${error.correlationId}.`
          : "";
      if (error instanceof EventApiError && error.status === 400) {
        pending.current = {};
        const field = String(error.details?.field ?? "");
        setFieldError(field in labels ? field : "");
        setMessage(
          `Check the event configuration${field in labels ? `: ${labels[field]}` : ""}.${reference}`,
        );
      } else {
        setReconcile(true);
        setMessage(
          (error instanceof EventApiError && error.status === 409
            ? "This event was changed elsewhere."
            : error instanceof EventApiError && error.status === 422
              ? "Event can no longer be edited in its current state."
              : "The save result could not be confirmed.") +
            ` Review the latest event before saving again.${reference}`,
        );
      }
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  async function reviewCurrent() {
    if (busy) return;
    controller.current = new AbortController();
    const signal = controller.current.signal;
    setBusy(true);
    try {
      const current = await getEventDetail(baseline.event_id, signal);
      if (signal.aborted) return;
      const attempted = Object.entries(pending.current);
      const confirmed =
        attempted.length > 0 &&
        attempted.every(([field, value]) =>
          sameEventValue(field, current[field as EventField], value),
        );
      const retained = new Set(changed);
      if (retained.has("time_zone"))
        for (const field of [
          "start_at",
          "end_at",
          "registration_opens_at",
          "registration_closes_at",
          "registration_cancellation_cutoff_at",
        ] as const)
          retained.add(field);
      setValues((previous) =>
        confirmed
          ? eventFormValues(current)
          : ({
              ...eventFormValues(current),
              ...Object.fromEntries(
                [...retained].map((field) => [field, previous[field]]),
              ),
            } as EventFormValues),
      );
      setBaseline(current);
      onCurrent(current);
      setReconcile(false);
      pending.current = {};
      setMessage(
        confirmed
          ? "Changes confirmed in current detail."
          : "Latest event loaded. Your entered values are retained. Review them against the latest details before saving.",
      );
    } catch (error) {
      if (!signal.aborted && !denied(error))
        setMessage(
          "Current detail could not be loaded. Retry loading it; the edit has not been resubmitted.",
        );
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  function update(field: EventField, value: string | boolean) {
    setValues((previous) => ({ ...previous, [field]: value }));
    setFieldError("");
    setMessage("");
  }
  return (
    <form
      className="event-edit-form"
      onSubmit={(event) => void submit(event)}
      aria-label="Edit event"
    >
      <h3>Edit event</h3>
      <p>
        {owner
          ? "Set up your event before publishing or starting it."
          : "Edit the public details of your assigned event."}
      </p>
      {!editable && (
        <p role="alert">
          {dirty
            ? "This event can no longer be edited. Your draft is retained for review."
            : "This event can no longer be edited in its current status."}
        </p>
      )}
      {needsReview && (
        <div role={reconcile ? undefined : "alert"} className="notice">
          <strong>Needs review</strong>
          <p>
            This event was changed elsewhere, or the last save needs
            confirmation. Review the latest version before saving. Your draft
            has been kept.
          </p>
          {changedElsewhere && (
            <dl className="event-detail-fields">
              {changed.map((field) => (
                <div key={field}>
                  <dt>Latest {labels[field]?.toLowerCase()}</dt>
                  <dd>
                    {field.endsWith("_at")
                      ? formatEventTime(
                          detail[field] as string | null,
                          detail.time_zone,
                        )
                      : field === "time_zone"
                        ? timeZoneLabel(detail.time_zone)
                        : String(detail[field] ?? "Not configured")}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
      {groups
        .filter((group) => owner || !group.owner)
        .map((group) => (
          <fieldset key={group.label} disabled={disabled}>
            <legend>{group.label}</legend>
            {group.label === "Schedule" && (
              <p className="form-group-help">
                New events use India Standard Time (IST, UTC+05:30). Existing
                event time zones are retained. Changing the time zone keeps the
                entered clock times in the new zone and changes their saved
                timestamps.
              </p>
            )}
            {group.label === "Registration" && (
              <p className="form-group-help">
                If no opening time is set, registration opens on publication. If
                no closing time is set, it closes when the event starts.
                Registration also closes when the event becomes live.
              </p>
            )}
            {group.label === "Operations" && (
              <p className="form-group-help">
                Configure gates in the Gates section.
              </p>
            )}
            {group.fields.map(([field, label, type]) => {
              const id = `edit-${field}`,
                invalid = fieldError === field,
                describedBy = invalid ? "edit-feedback" : undefined;
              if (type === "date")
                return (
                  <EventDateTimeControls
                    key={field}
                    id={id}
                    label={label}
                    value={String(values[field])}
                    onChange={(value) => update(field, value)}
                    invalid={invalid}
                    describedBy={describedBy}
                  />
                );
              return (
                <div key={field} className="event-form-field">
                  <label htmlFor={id}>{label}</label>
                  {type === "textarea" ? (
                    <textarea
                      id={id}
                      value={String(values[field])}
                      aria-invalid={invalid}
                      aria-describedby={describedBy}
                      onChange={(event) => update(field, event.target.value)}
                    />
                  ) : type === "zone" || type === "access" ? (
                    <select
                      id={id}
                      value={String(values[field])}
                      aria-invalid={invalid}
                      aria-describedby={describedBy}
                      onChange={(event) => update(field, event.target.value)}
                    >
                      {(type !== "zone" || !values.time_zone) && (
                        <option value="">Not configured</option>
                      )}
                      {type === "zone" ? (
                        <>
                          {timeZoneOptions(baseline.time_zone ?? "").map(
                            (zone) => (
                              <option key={zone} value={zone}>
                                {timeZoneLabel(zone)}
                              </option>
                            ),
                          )}
                        </>
                      ) : (
                        <>
                          <option value="PUBLIC">Public</option>
                          <option value="PRIVATE">Invitation</option>
                        </>
                      )}
                    </select>
                  ) : (
                    <input
                      id={id}
                      type={type}
                      required={field === "name"}
                      min={type === "number" ? 1 : undefined}
                      max={type === "number" ? 2147483647 : undefined}
                      checked={
                        type === "checkbox" ? Boolean(values[field]) : undefined
                      }
                      value={
                        type === "checkbox" ? undefined : String(values[field])
                      }
                      aria-invalid={invalid}
                      aria-describedby={describedBy}
                      onChange={(event) =>
                        update(
                          field,
                          type === "checkbox"
                            ? event.target.checked
                            : event.target.value,
                        )
                      }
                    />
                  )}
                </div>
              );
            })}
          </fieldset>
        ))}
      <button type="submit" disabled={disabled || changedElsewhere}>
        {busy ? "Saving…" : "Save changes"}
      </button>
      {message && (
        <p
          id="edit-feedback"
          role={fieldError || reconcile ? "alert" : "status"}
          className="notice"
        >
          {message}
        </p>
      )}
      {needsReview && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void reviewCurrent()}
        >
          {busy ? "Loading current detail…" : "Load current detail"}
        </button>
      )}
    </form>
  );
}
