import { useEffect, useRef, useState } from "react";
import { type ActorState } from "../services/proof";
import { ReviewEntry } from "./ReviewEntry";
import { TaskDetails, TaskForm } from "./TaskDetails";
import { listStaff, type StaffAssignment } from "../services/staff";
import { humanLabel } from "./event-presentation";
import { useEventInformation } from "./useEventInformation";
import { EventInformation } from "./EventInformation";
import {
  tasksPath,
  reviewRequest,
  reviewMessage,
  outcomeUnknown,
  type Command,
  type Task,
  type TaskList,
  type TaskResponse,
} from "../services/event-review";
export function TasksPage({
  eventId,
  taskId,
  staff = false,
}: {
  eventId: string;
  taskId?: string;
  staff?: boolean;
}) {
  return (
    <ReviewEntry title={staff ? "Volunteer tasks" : "My tasks"}>
      {(actor, fail) => (
        <TaskWorkspace
          eventId={eventId}
          initialId={taskId}
          staff={staff}
          actor={actor}
          fail={fail}
        />
      )}
    </ReviewEntry>
  );
}
function TaskWorkspace({
  eventId,
  initialId,
  staff,
  actor,
  fail,
}: {
  eventId: string;
  initialId?: string;
  staff: boolean;
  actor: ActorState;
  fail: (e: unknown) => void;
}) {
  const [list, setList] = useState<TaskList | null>(null),
    [selected, setSelected] = useState<{ task: Task; etag: string } | null>(
      null,
    ),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [stale, setStale] = useState(false),
    [pending, setPending] = useState<{ path: string; command: Command } | null>(
      null,
    ),
    [cursor, setCursor] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0);
  const lifecycle = useRef(new AbortController()),
    epoch = useRef(0);
  const base = tasksPath(eventId);
  const information = useEventInformation(staff ? eventId : null);
  const [volunteers, setVolunteers] = useState<StaffAssignment[]>([]);
  const [teamError, setTeamError] = useState("");
  useEffect(() => {
    if (!staff) return;
    const controller = new AbortController();
    setTeamError("");
    void listStaff(eventId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setVolunteers(
            data.assignments.filter((row) => row.role === "VOLUNTEER"),
          );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setTeamError(
            "The team list could not be loaded. Refresh tasks before assigning a volunteer.",
          );
      });
    return () => controller.abort();
  }, [staff, eventId, attempt]);
  function error(e: unknown) {
    setMessage(reviewMessage(e));
    if (e instanceof Error && e.message === "VERSION_CONFLICT") setStale(true);
    fail(e);
  }
  useEffect(() => {
    const c = new AbortController();
    lifecycle.current = c;
    const version = ++epoch.current;
    setList(null);
    setSelected(null);
    setStale(false);
    setMessage("");
    void (async () => {
      const r = await reviewRequest<TaskList>(
        `${base}?view=${staff ? "manage" : "own"}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        c.signal,
      );
      if (c.signal.aborted || version !== epoch.current) return;
      setList(r.data);
      if (initialId) {
        const d = await reviewRequest<TaskResponse>(
          `${base}/${encodeURIComponent(initialId)}`,
          c.signal,
        );
        if (!c.signal.aborted && version === epoch.current) {
          if (!d.etag) throw new Error("Missing task revision");
          setSelected({ task: d.data.task, etag: d.etag });
        }
      }
    })().catch((e) => {
      if (!c.signal.aborted && version === epoch.current) error(e);
    });
    const clear = () => {
      c.abort();
      epoch.current++;
      setList(null);
      setSelected(null);
      setPending(null);
    };
    window.addEventListener("pagehide", clear);
    return () => {
      c.abort();
      epoch.current++;
      window.removeEventListener("pagehide", clear);
    };
  }, [base, staff, cursor, attempt, initialId]);
  async function select(id: string) {
    const version = ++epoch.current;
    setSelected(null);
    setMessage("");
    try {
      const r = await reviewRequest<TaskResponse>(
        `${base}/${encodeURIComponent(id)}`,
        lifecycle.current.signal,
      );
      if (version === epoch.current && !lifecycle.current.signal.aborted) {
        if (!r.etag) throw new Error("Missing task revision");
        setStale(false);
        setSelected({ task: r.data.task, etag: r.etag });
      }
    } catch (e) {
      if (version === epoch.current && !lifecycle.current.signal.aborted)
        error(e);
    }
  }
  async function send(operation: { path: string; command: Command }) {
    setBusy(true);
    setMessage("");
    const version = epoch.current;
    let acknowledged = false;
    try {
      const r = await reviewRequest<TaskResponse>(
        operation.path,
        lifecycle.current.signal,
        operation.command,
      );
      if (version !== epoch.current || lifecycle.current.signal.aborted) return;
      if (!r.etag) throw new Error("Missing task revision");
      acknowledged = true;
      setSelected({ task: r.data.task, etag: r.etag });
      setPending(null);
      setMessage("Task saved.");
      const fresh = await reviewRequest<TaskList>(
        `${base}?view=${staff ? "manage" : "own"}`,
        lifecycle.current.signal,
      );
      if (version === epoch.current && !lifecycle.current.signal.aborted)
        setList(fresh.data);
    } catch (e) {
      if (version === epoch.current && !lifecycle.current.signal.aborted) {
        setPending(!acknowledged && outcomeUnknown(e) ? operation : null);
        error(e);
      }
    } finally {
      if (version === epoch.current) setBusy(false);
    }
  }
  function mutate(
    action: "EDIT" | "ASSIGN" | "STATUS" | "CANCEL",
    body: Record<string, unknown>,
  ) {
    if (!selected) return;
    void send({
      path: `${base}/${selected.task.id}${action === "EDIT" ? "" : action === "ASSIGN" ? "/assignee" : action === "STATUS" ? "/status" : "/cancel"}`,
      command: {
        method: action === "CANCEL" ? "POST" : "PATCH",
        body,
        csrf: actor.csrf_token,
        key: crypto.randomUUID(),
        etag: selected.etag,
      },
    });
  }
  return (
    <>
      {staff && (
        <>
          <a href="/">Back to event workspace</a>
          <EventInformation information={information} />
        </>
      )}
      {teamError && <p role="alert">{teamError}</p>}
      <button
        disabled={busy}
        onClick={() => {
          setCursor(null);
          setAttempt((a) => a + 1);
        }}
      >
        Refresh tasks
      </button>
      {message && <p role="status">{message}</p>}
      {pending && (
        <button disabled={busy} onClick={() => void send(pending)}>
          Retry same command
        </button>
      )}
      {!list && !message && <p role="status">Loading tasks…</p>}
      {list && (
        <>
          <h2>{list.event.event_name}</h2>
          {!list.items.length ? (
            <p>No tasks in this view.</p>
          ) : (
            <ul className="event-list">
              {list.items.map((t) => (
                <li key={t.id}>
                  {staff ? (
                    <button
                      disabled={busy || !!pending}
                      onClick={() => void select(t.id)}
                    >
                      {t.title} · {humanLabel(t.status)}
                    </button>
                  ) : (
                    <a
                      href={`/volunteer/${encodeURIComponent(eventId)}/tasks/${encodeURIComponent(t.id)}`}
                    >
                      {t.title} · {humanLabel(t.status)}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          {list.next_cursor && (
            <button
              disabled={busy || !!pending}
              onClick={() => setCursor(list.next_cursor)}
            >
              Next tasks
            </button>
          )}
        </>
      )}
      {staff && list && !pending && information.detail && (
        <section aria-label="Create task">
          <h2>Create task</h2>
          <p>
            Choose an account already granted the Volunteer role for this event.
          </p>
          <TaskForm
            busy={busy || stale}
            timeZone={information.detail?.time_zone ?? null}
            volunteers={volunteers}
            onSave={(body) =>
              void send({
                path: base,
                command: {
                  method: "POST",
                  body,
                  csrf: actor.csrf_token,
                  key: crypto.randomUUID(),
                },
              })
            }
          />
        </section>
      )}
      {selected && (
        <TaskDetails
          key={selected.task.id}
          task={selected.task}
          staff={staff}
          busy={busy || stale || !!pending || (staff && !information.detail)}
          timeZone={information.detail?.time_zone ?? null}
          volunteers={volunteers}
          mutate={mutate}
        />
      )}
    </>
  );
}
export function VolunteerEntry() {
  return (
    <ReviewEntry title="My volunteer assignments">
      {(actor) => {
        const events = [
          ...new Set(
            actor.assignments
              .filter((a) => a.role === "VOLUNTEER")
              .map((a) => a.event_id),
          ),
        ];
        return events.length ? (
          <ul>
            {events.map((id, i) => (
              <li key={id}>
                <a href={`/volunteer/${encodeURIComponent(id)}/tasks`}>
                  View assigned event {i + 1} tasks
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p>No current Volunteer assignment.</p>
        );
      }}
    </ReviewEntry>
  );
}
