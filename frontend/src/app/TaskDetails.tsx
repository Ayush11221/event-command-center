import { useState } from "react";
import type { Task } from "../services/event-review";
import type { StaffAssignment } from "../services/staff";
import {
  eventTimeInput,
  formatEventTime,
  serializeEventTime,
} from "../services/event-time";
import { humanLabel } from "./event-presentation";
export function TaskForm({
  task,
  onSave,
  busy,
  timeZone = null,
  volunteers = [],
}: {
  task?: Task;
  onSave: (body: Record<string, unknown>) => void;
  busy: boolean;
  timeZone?: string | null;
  volunteers?: StaffAssignment[];
}) {
  const [title, setTitle] = useState(task?.title ?? ""),
    [instructions, setInstructions] = useState(task?.instructions ?? ""),
    [location, setLocation] = useState(task?.location ?? ""),
    [starts, setStarts] = useState(
      eventTimeInput(task?.starts_at ?? null, timeZone),
    ),
    [ends, setEnds] = useState(eventTimeInput(task?.ends_at ?? null, timeZone)),
    [volunteer, setVolunteer] = useState(task?.assigned_volunteer_id ?? "");
  const [timeError, setTimeError] = useState("");
  return (
    <form
      className="certificate-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (task && (task.starts_at || task.ends_at) && !timeZone) {
          setTimeError(
            "The event time zone must be confirmed before editing this schedule.",
          );
          return;
        }
        try {
          onSave({
            title,
            instructions,
            location: location.trim() || null,
            starts_at: starts
              ? serializeEventTime(starts, timeZone ?? "")
              : null,
            ends_at: ends ? serializeEventTime(ends, timeZone ?? "") : null,
            ...(!task ? { assigned_volunteer_id: volunteer.trim() } : {}),
          });
        } catch (error) {
          setTimeError((error as Error).message);
        }
      }}
    >
      <fieldset disabled={busy}>
        <label>
          Title
          <input
            required
            value={title}
            maxLength={320}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Instructions
          <textarea
            required
            value={instructions}
            maxLength={8000}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </label>
        <label>
          Location (optional)
          <input
            value={location}
            maxLength={480}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        <label>
          Starts (event time, optional)
          <input
            type="datetime-local"
            value={starts}
            onChange={(e) => setStarts(e.target.value)}
          />
        </label>
        <label>
          Ends (event time, optional)
          <input
            type="datetime-local"
            value={ends}
            onChange={(e) => setEnds(e.target.value)}
          />
        </label>
        {!task && (
          <label>
            Volunteer
            <select
              required
              value={volunteer}
              onChange={(e) => setVolunteer(e.target.value)}
            >
              <option value="">Choose a team volunteer</option>
              {volunteers.map((row) => (
                <option key={row.id} value={row.userId}>
                  {row.email ?? "Verified volunteer"}
                </option>
              ))}
            </select>
          </label>
        )}
        {timeError && <p role="alert">{timeError}</p>}
      </fieldset>
      <button disabled={busy}>{task ? "Save details" : "Create task"}</button>
    </form>
  );
}
export function TaskDetails({
  task,
  staff,
  busy,
  mutate,
  timeZone = null,
  volunteers = [],
}: {
  task: Task;
  staff: boolean;
  timeZone?: string | null;
  volunteers?: StaffAssignment[];
  busy: boolean;
  mutate: (
    action: "EDIT" | "ASSIGN" | "STATUS" | "CANCEL",
    body: Record<string, unknown>,
  ) => void;
}) {
  const [who, setWho] = useState(""),
    [reason, setReason] = useState("");
  const mutable = task.status === "ASSIGNED" || task.status === "IN_PROGRESS";
  return (
    <section aria-label="Task details">
      <h2>{task.title}</h2>
      <p>
        <strong>{humanLabel(task.status)}</strong>
      </p>
      <p className="task-instructions">{task.instructions}</p>
      <p>{task.location ?? "No location specified"}</p>
      <p>
        {task.starts_at
          ? staff
            ? formatEventTime(task.starts_at, timeZone)
            : new Date(task.starts_at).toLocaleString()
          : "No start time"}{" "}
        ·{" "}
        {task.ends_at
          ? staff
            ? formatEventTime(task.ends_at, timeZone)
            : new Date(task.ends_at).toLocaleString()
          : "No end time"}
      </p>
      {staff && (
        <>
          <p>
            Volunteer:{" "}
            {volunteers.find((row) => row.userId === task.assigned_volunteer_id)
              ?.email ?? "Assigned volunteer"}
          </p>
          <details className="advanced-details">
            <summary>Advanced details</summary>Volunteer reference:{" "}
            {task.assigned_volunteer_id}
          </details>
        </>
      )}
      {staff && mutable && (
        <TaskForm
          key={task.updated_at + task.id + timeZone}
          task={task}
          busy={busy}
          timeZone={timeZone}
          volunteers={volunteers}
          onSave={(b) => mutate("EDIT", b)}
        />
      )}{" "}
      {staff && task.status === "ASSIGNED" && (
        <form
          className="certificate-form"
          onSubmit={(e) => {
            e.preventDefault();
            mutate("ASSIGN", { assigned_volunteer_id: who.trim() });
          }}
        >
          <label>
            New volunteer
            <select
              required
              value={who}
              onChange={(e) => setWho(e.target.value)}
            >
              <option value="">Choose a team volunteer</option>
              {volunteers.map((row) => (
                <option key={row.id} value={row.userId}>
                  {row.email ?? "Verified volunteer"}
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy}>Reassign task</button>
        </form>
      )}
      {staff && mutable && (
        <form
          className="certificate-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) mutate("CANCEL", { reason });
          }}
        >
          <label>
            Cancellation reason
            <textarea
              required
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button disabled={busy || !reason.trim()}>Cancel task</button>
        </form>
      )}
      {!staff && mutable && (
        <button
          disabled={busy}
          onClick={() =>
            mutate("STATUS", {
              status: task.status === "ASSIGNED" ? "IN_PROGRESS" : "COMPLETED",
            })
          }
        >
          {task.status === "ASSIGNED" ? "Start task" : "Complete task"}
        </button>
      )}
      {task.status === "CANCELLED" && staff && (
        <>
          <p>Cancellation reason: {task.cancellation_reason}</p>
          <p>Cancelled on {formatEventTime(task.cancelled_at, timeZone)}</p>
          <details className="advanced-details">
            <summary>Advanced details</summary>Cancelled by reference:{" "}
            {task.cancelled_by_user_id}
          </details>
        </>
      )}
      {!mutable && <p>This task is read-only.</p>}
    </section>
  );
}
