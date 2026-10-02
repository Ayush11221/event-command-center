import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  editEvent,
  EventApiError,
  getEventDetail,
  type EventEdit,
  type ManagementDetail,
} from "../services/events";

const publicFields = [
  ["name", "Name", "text"],
  ["description", "Description", "textarea"],
  ["public_location", "Public location", "text"],
  ["image_url", "Image reference (HTTPS)", "url"],
  ["category", "Category", "text"],
  ["tags", "Tags (one per line)", "textarea"],
] as const;
const organizerFields = [
  ["start_at", "Start (ISO 8601 with offset)", "text"],
  ["end_at", "End (ISO 8601 with offset)", "text"],
  ["time_zone", "Time zone (IANA)", "text"],
  ["visibility", "Visibility", "select"],
  ["registration_capacity", "Configured registration capacity", "number"],
  [
    "registration_opens_at",
    "Registration opening time (ISO 8601 with offset)",
    "text",
  ],
  [
    "registration_closes_at",
    "Registration closing time (ISO 8601 with offset)",
    "text",
  ],
  [
    "registration_cancellation_cutoff_at",
    "Cancellation cutoff (ISO 8601 with offset)",
    "text",
  ],
  [
    "registration_manually_closed",
    "Manual registration closure configured",
    "checkbox",
  ],
  ["checkout_enabled", "Checkout configured", "checkbox"],
] as const;
type Field = keyof EventEdit;
type Values = Partial<Record<Field, string | boolean>>;
function sameValue(field: string, left: unknown, right: unknown): boolean {
  if (
    field.endsWith("_at") &&
    typeof left === "string" &&
    typeof right === "string"
  )
    return (
      Number.isFinite(Date.parse(left)) &&
      Date.parse(left) === Date.parse(right)
    );
  return JSON.stringify(left) === JSON.stringify(right);
}
function initialValues(detail: ManagementDetail): Values {
  return Object.fromEntries(
    [...publicFields, ...organizerFields].map(([field]) => [
      field,
      field === "tags" ? detail.tags.join("\n") : (detail[field] ?? ""),
    ]),
  );
}
function patch(
  values: Values,
  baseline: ManagementDetail,
  owner: boolean,
): EventEdit {
  const result: Record<string, unknown> = {};
  for (const [field, , type] of [
    ...publicFields,
    ...(owner ? organizerFields : []),
  ]) {
    const raw = values[field];
    const value =
      type === "checkbox"
        ? raw
        : field === "tags"
          ? String(raw)
              .split("\n")
              .filter((tag) => tag.trim())
              .map((tag) => tag.trim())
          : field === "registration_capacity"
            ? raw === ""
              ? null
              : Number(raw)
            : String(raw).trim() || null;
    if (!sameValue(field, value, baseline[field])) result[field] = value;
  }
  return result as EventEdit;
}
interface Props {
  detail: ManagementDetail;
  owner: boolean;
  csrf: string;
  onCurrent: (detail: ManagementDetail) => void;
  onSessionExpired: () => void;
  onScopeLost: () => void;
}

export function EditEventForm({
  detail,
  owner,
  csrf,
  onCurrent,
  onSessionExpired,
  onScopeLost,
}: Props) {
  const [baseline, setBaseline] = useState(detail);
  const [values, setValues] = useState(() => initialValues(detail));
  const [busy, setBusy] = useState(false);
  const [reconcile, setReconcile] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldError, setFieldError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const fields = [...publicFields, ...(owner ? organizerFields : [])];
  const pending = useRef<EventEdit>({});
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (fieldError && !busy)
      document.getElementById(`edit-${fieldError}`)?.focus();
  }, [fieldError, busy]);

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
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || reconcile) return;
    const body = patch(values, baseline, owner);
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
      setBaseline(saved);
      setValues(initialValues(saved));
      onCurrent(saved);
      setMessage("Changes saved.");
    } catch (error) {
      if (signal.aborted || denied(error)) return;
      const reference =
        error instanceof EventApiError && error.correlationId
          ? ` Reference: ${error.correlationId}.`
          : "";
      if (error instanceof EventApiError && error.status === 400) {
        const field = String(error.details?.field ?? "");
        setFieldError(fields.some(([key]) => key === field) ? field : "");
        setMessage(
          `Check the event configuration${field && fields.some(([key]) => key === field) ? `: ${fields.find(([key]) => key === field)![1]}` : ""}.${reference}`,
        );
      } else {
        setReconcile(true);
        setMessage(
          (error instanceof EventApiError && error.status === 409
            ? "Event data changed."
            : error instanceof EventApiError && error.status === 422
              ? "Event can no longer be edited in its current state."
              : "The save result could not be confirmed.") +
            ` Load current detail before reviewing or saving again.${reference}`,
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
      const confirmed = Object.entries(pending.current).every(
        ([field, value]) => sameValue(field, current[field as Field], value),
      );
      setBaseline(current);
      onCurrent(current);
      setReconcile(false);
      setValues((previous) =>
        confirmed
          ? initialValues(current)
          : {
              ...initialValues(current),
              ...Object.fromEntries(
                Object.keys(pending.current).map((field) => [
                  field,
                  previous[field as Field],
                ]),
              ),
            },
      );
      setMessage(
        confirmed
          ? "Changes confirmed in current detail."
          : `Current revision ${current.revision} loaded. Your entered values are retained. Review them against the current detail before saving.`,
      );
    } catch (error) {
      if (signal.aborted || denied(error)) return;
      setMessage(
        "Current detail could not be loaded. Retry loading it; the edit has not been resubmitted.",
      );
    } finally {
      if (!signal.aborted) setBusy(false);
    }
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
          ? "Configure your Draft or Published event."
          : "Edit the public details of your assigned event."}{" "}
        Only changed fields are saved.
      </p>
      <fieldset disabled={busy || reconcile}>
        <legend>
          {owner ? "Organizer configuration" : "Public event details"}
        </legend>
        {fields.map(([field, label, type]) => (
          <label key={field} htmlFor={`edit-${field}`}>
            <span>{label}</span>
            {type === "textarea" ? (
              <textarea
                id={`edit-${field}`}
                value={String(values[field])}
                aria-invalid={fieldError === field}
                aria-describedby={
                  fieldError === field ? "edit-feedback" : undefined
                }
                onChange={(event) =>
                  setValues({ ...values, [field]: event.target.value })
                }
              />
            ) : type === "select" ? (
              <select
                id={`edit-${field}`}
                value={String(values[field])}
                aria-invalid={fieldError === field}
                aria-describedby={
                  fieldError === field ? "edit-feedback" : undefined
                }
                onChange={(event) =>
                  setValues({ ...values, [field]: event.target.value })
                }
              >
                <option value="">Not configured</option>
                <option value="PUBLIC">Public</option>
                <option value="PRIVATE">Private</option>
              </select>
            ) : (
              <input
                id={`edit-${field}`}
                type={type}
                required={field === "name"}
                min={type === "number" ? 1 : undefined}
                max={type === "number" ? 2147483647 : undefined}
                checked={
                  type === "checkbox" ? Boolean(values[field]) : undefined
                }
                value={type === "checkbox" ? undefined : String(values[field])}
                aria-invalid={fieldError === field}
                aria-describedby={
                  fieldError === field ? "edit-feedback" : undefined
                }
                onChange={(event) =>
                  setValues({
                    ...values,
                    [field]:
                      type === "checkbox"
                        ? event.target.checked
                        : event.target.value,
                  })
                }
              />
            )}
          </label>
        ))}
        <button type="submit">{busy ? "Saving…" : "Save changes"}</button>
      </fieldset>
      {message && (
        <p
          id="edit-feedback"
          role={fieldError || reconcile ? "alert" : "status"}
          className="notice"
        >
          {message}
        </p>
      )}
      {reconcile && (
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
