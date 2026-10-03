import { useState } from "react";
import type { Task } from "../services/event-review";
const localTime = (value: string | null) =>
  value
    ? new Date(
        new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000,
      )
        .toISOString()
        .slice(0, 16)
    : "";
export function TaskForm({
  task,
  onSave,
  busy,
}: {
  task?: Task;
  onSave: (body: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState(task?.title ?? ""),
    [instructions, setInstructions] = useState(task?.instructions ?? ""),
    [location, setLocation] = useState(task?.location ?? ""),
    [starts, setStarts] = useState(localTime(task?.starts_at ?? null)),
    [ends, setEnds] = useState(localTime(task?.ends_at ?? null)),
    [volunteer, setVolunteer] = useState(task?.assigned_volunteer_id ?? "");
  return (
    <form
      className="certificate-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          title,
          instructions,
          location: location.trim() || null,
          starts_at: starts ? new Date(starts).toISOString() : null,
          ends_at: ends ? new Date(ends).toISOString() : null,
          ...(!task ? { assigned_volunteer_id: volunteer.trim() } : {}),
        });
      }}
    >
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
        Starts (local time, optional)
        <input
          type="datetime-local"
          value={starts}
          onChange={(e) => setStarts(e.target.value)}
        />
      </label>
      <label>
        Ends (local time, optional)
        <input
          type="datetime-local"
          value={ends}
          onChange={(e) => setEnds(e.target.value)}
        />
      </label>
      {!task && (
        <label>
          Volunteer account ID
          <input
            required
            value={volunteer}
            onChange={(e) => setVolunteer(e.target.value)}
          />
        </label>
      )}
      <button disabled={busy}>{task ? "Save details" : "Create task"}</button>
    </form>
  );
}
export function TaskDetails({
  task,
  staff,
  busy,
  mutate,
}: {
  task: Task;
  staff: boolean;
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
        <strong>{task.status}</strong>
      </p>
      <p className="task-instructions">{task.instructions}</p>
      <p>{task.location ?? "No location specified"}</p>
      <p>
        {task.starts_at
          ? new Date(task.starts_at).toLocaleString()
          : "No start time"}{" "}
        ·{" "}
        {task.ends_at ? new Date(task.ends_at).toLocaleString() : "No end time"}
      </p>
      {staff && <p>Assigned account: {task.assigned_volunteer_id}</p>}
      {staff && mutable && (
        <TaskForm
          key={task.updated_at + task.id}
          task={task}
          busy={busy}
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
            New volunteer account ID
            <input
              required
              value={who}
              onChange={(e) => setWho(e.target.value)}
            />
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
          <p>
            Cancelled by {task.cancelled_by_user_id} at{" "}
            {new Date(task.cancelled_at!).toLocaleString()}
          </p>
        </>
      )}
      {!mutable && <p>This task is read-only.</p>}
    </section>
  );
}
