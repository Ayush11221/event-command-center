import { useCallback, useEffect, useRef, useState } from "react";
import {
  EventApiError,
  listAllEvents,
  type ManagementEvent,
} from "../services/events";
import {
  currentActor,
  logout,
  ProofError,
  type ActorState,
} from "../services/proof";
import {
  contextKey,
  contextsFromLists,
  rememberContext,
  rememberedContext,
  selectAuthorizedContext,
  type EventContext,
} from "./contexts";
import { CreateDraftForm } from "./CreateDraftForm";
import { EventDetail } from "./EventDetail";

interface Props {
  initialActor: ActorState;
  onSessionExpired: () => void;
  onSignedOut: () => void;
}

type WorkspaceState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | {
      phase: "ready";
      owned: ManagementEvent[];
      assigned: ManagementEvent[];
      contexts: EventContext[];
      selected: EventContext | null;
      asOf: string;
    };

function schedule(event: ManagementEvent): string {
  if (!event.start_at) return "Schedule not set";
  try {
    return (
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        ...(event.time_zone ? { timeZone: event.time_zone } : {}),
      }).format(new Date(event.start_at)) +
      (event.time_zone ? ` · ${event.time_zone}` : "")
    );
  } catch {
    return "Schedule unavailable";
  }
}

function stateLabel(state: ManagementEvent["state"]): string {
  return state.charAt(0) + state.slice(1).toLowerCase();
}

export function Workspace({
  initialActor,
  onSessionExpired,
  onSignedOut,
}: Props) {
  const [actor, setActor] = useState(initialActor);
  const [workspace, setWorkspace] = useState<WorkspaceState>({
    phase: "loading",
  });
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const generation = useRef(0);

  const expireSession = useCallback(() => {
    rememberContext(null);
    onSessionExpired();
  }, [onSessionExpired]);

  const reload = useCallback(
    async (
      preferred: Pick<EventContext, "eventId" | "relationship"> | null,
    ) => {
      const current = ++generation.current;
      setWorkspace({ phase: "loading" });
      try {
        const fresh = await currentActor();
        const [owned, assigned] = await Promise.all([
          fresh.organizer_capable
            ? listAllEvents("owned")
            : Promise.resolve([]),
          fresh.assignments.some((item) => item.role === "EVENT_ADMIN")
            ? listAllEvents("assigned").catch((error: unknown) => {
                if (error instanceof EventApiError && error.status === 403)
                  return [];
                throw error;
              })
            : Promise.resolve([]),
        ]);
        if (generation.current !== current) return;
        const contexts = contextsFromLists(owned, assigned);
        const selected = selectAuthorizedContext(contexts, preferred);
        rememberContext(selected);
        setActor(fresh);
        setWorkspace({
          phase: "ready",
          owned,
          assigned,
          contexts,
          selected,
          asOf: new Date().toISOString(),
        });
      } catch (error) {
        if (generation.current !== current) return;
        if (
          (error instanceof ProofError || error instanceof EventApiError) &&
          error.status === 401
        ) {
          rememberContext(null);
          expireSession();
          return;
        }
        const reference =
          error instanceof EventApiError && error.correlationId
            ? ` Reference: ${error.correlationId}.`
            : "";
        setWorkspace({
          phase: "error",
          message: `The event workspace could not be loaded.${reference}`,
        });
      }
    },
    [expireSession],
  );

  useEffect(() => {
    void reload(rememberedContext());
    return () => {
      generation.current += 1;
    };
  }, [reload]);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible")
        void reload(rememberedContext());
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  async function signOut() {
    setSigningOut(true);
    setSignOutError("");
    try {
      await logout(actor.csrf_token);
      onSignedOut();
    } catch (error) {
      if (error instanceof ProofError && error.status === 401) expireSession();
      else
        setSignOutError(
          "Sign out could not be confirmed. Check your connection and retry.",
        );
    } finally {
      setSigningOut(false);
    }
  }

  const selected = workspace.phase === "ready" ? workspace.selected : null;
  const showOwned =
    workspace.phase === "ready" &&
    (selected?.relationship === "owned" ||
      (!selected && actor.organizer_capable));

  const onScopeLost = useCallback(() => {
    rememberContext(null);
    setDetailOpen(false);
    void reload(null);
  }, [reload]);

  return (
    <>
      <div className="workspace-bar">
        <div className="workspace-bar-inner">
          <span className="workspace-label">WORKSPACE</span>
          {workspace.phase === "ready" && workspace.contexts.length > 1 ? (
            <label className="context-switcher">
              <span>Event and role</span>
              <select
                value={selected ? contextKey(selected) : ""}
                onChange={(event) => {
                  const chosen = workspace.contexts.find(
                    (context) => contextKey(context) === event.target.value,
                  );
                  if (chosen) void reload(chosen);
                }}
              >
                {workspace.contexts.map((context) => (
                  <option key={contextKey(context)} value={contextKey(context)}>
                    {context.name} —{" "}
                    {context.relationship === "owned"
                      ? "Organizer"
                      : "Event Admin"}
                  </option>
                ))}
              </select>
            </label>
          ) : workspace.phase === "ready" && selected ? (
            <p className="active-context">
              {selected.name}{" "}
              <span>
                ·{" "}
                {selected.relationship === "owned"
                  ? "Organizer"
                  : "Event Admin"}
              </span>
            </p>
          ) : (
            <span className="active-context">No active event</span>
          )}
          <button
            className="text-button"
            type="button"
            disabled={signingOut}
            onClick={() => void signOut()}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
      <main className="page-shell workspace-main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">EVENT MANAGEMENT</p>
            <h1>Event workspace</h1>
            <p>
              Work in the Event and Role context shown above. Access is checked
              with the server whenever the workspace refreshes.
            </p>
          </div>
          <button
            className="secondary-button"
            type="button"
            disabled={workspace.phase === "loading"}
            onClick={() => void reload(selected ?? rememberedContext())}
          >
            Refresh access
          </button>
        </div>
        {signOutError && (
          <p role="alert" className="notice critical">
            {signOutError}
          </p>
        )}
        {workspace.phase === "loading" ? (
          <p role="status" className="notice">
            Loading authorized events…
          </p>
        ) : workspace.phase === "error" ? (
          <div className="notice critical" role="alert">
            <p>{workspace.message}</p>
            <button
              type="button"
              onClick={() => void reload(rememberedContext())}
            >
              Retry event list
            </button>
          </div>
        ) : (
          <>
            {(selected || actor.organizer_capable) && (
              <nav className="workspace-nav" aria-label="Workspace navigation">
                <button
                  type="button"
                  className="text-button"
                  aria-current={!detailOpen ? "page" : undefined}
                  onClick={() => setDetailOpen(false)}
                >
                  {showOwned ? "Owned events" : "Assigned events"}
                </button>
                {selected && (
                  <button
                    type="button"
                    className="text-button"
                    aria-current={detailOpen ? "page" : undefined}
                    onClick={() => setDetailOpen(true)}
                  >
                    Event setup
                  </button>
                )}
                {showOwned && (
                  <a href="#create-draft" onClick={() => setDetailOpen(false)}>
                    Create Draft
                  </a>
                )}
              </nav>
            )}
            {workspace.contexts.length === 0 && !actor.organizer_capable && (
              <section className="notice" aria-label="No event context">
                <h2>No event context</h2>
                <p>You do not currently have an Event management assignment.</p>
              </section>
            )}
            {selected?.relationship === "assigned" && !detailOpen && (
              <section className="notice" aria-label="Event Admin context">
                <h2>Assigned events</h2>
                <p>
                  Events you are currently authorized to manage as Event Admin.
                </p>
                <ul className="event-list">
                  {workspace.assigned.map((event) => (
                    <li key={event.event_id}>
                      <button
                        type="button"
                        className="event-row"
                        onClick={() => {
                          setDetailOpen(true);
                          void reload({
                            eventId: event.event_id,
                            relationship: "assigned",
                          });
                        }}
                      >
                        <span className="event-row-title">{event.name}</span>
                        <span className="event-row-date">
                          {schedule(event)}
                        </span>
                        <span
                          className={`state-pill state-${event.state.toLowerCase()}`}
                        >
                          {stateLabel(event.state)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {workspace.assigned.length === 0 &&
              !actor.organizer_capable &&
              !detailOpen && <p className="empty-state">No assigned events.</p>}
            {detailOpen && selected && (
              <EventDetail
                key={contextKey(selected)}
                context={selected}
                onSessionExpired={expireSession}
                onScopeLost={onScopeLost}
              />
            )}
            {showOwned && !detailOpen && (
              <>
                <section
                  id="owned-events"
                  className="event-section"
                  aria-labelledby="owned-heading"
                >
                  <div className="section-heading">
                    <p className="eyebrow">YOUR EVENTS</p>
                    <h2 id="owned-heading">Owned events</h2>
                    <p>
                      Drafts remain private to management until you configure
                      and publish them.
                    </p>
                  </div>
                  {workspace.owned.length === 0 ? (
                    <div className="empty-state">
                      <h3>No owned events yet</h3>
                      <p>
                        Create a Draft to start an event. Only you can manage
                        events you own.
                      </p>
                    </div>
                  ) : (
                    <ul className="event-list">
                      {workspace.owned.map((event) => (
                        <li key={event.event_id}>
                          <button
                            type="button"
                            className="event-row"
                            aria-current={
                              selected?.eventId === event.event_id &&
                              selected.relationship === "owned"
                                ? "true"
                                : undefined
                            }
                            onClick={() =>
                              void reload({
                                eventId: event.event_id,
                                relationship: "owned",
                              })
                            }
                          >
                            <span className="event-row-title">
                              {event.name}
                            </span>
                            <span className="event-row-date">
                              {schedule(event)}
                            </span>
                            <span
                              className={`state-pill state-${event.state.toLowerCase()}`}
                            >
                              {stateLabel(event.state)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="freshness">
                    Access checked {new Date(workspace.asOf).toLocaleString()}.
                  </p>
                </section>
                <CreateDraftForm
                  csrf={actor.csrf_token}
                  onCreated={(eventId) =>
                    void reload({ eventId, relationship: "owned" })
                  }
                  onSessionExpired={onSessionExpired}
                  onForbidden={() => void reload(rememberedContext())}
                />
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}
