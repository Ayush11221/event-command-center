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
import type { WorkspaceSection } from "./EventDetail";
import { formatEventTime, timeZoneLabel } from "../services/event-time";
import { humanLabel } from "./event-presentation";
import { AssignedGateContext } from "./AssignedGateContext";

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
  return `${formatEventTime(event.start_at, event.time_zone)} · ${timeZoneLabel(event.time_zone)}`;
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
  const [detailVisited, setDetailVisited] = useState(false);
  const [section, setSection] = useState<WorkspaceSection>("overview");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [accessError, setAccessError] = useState("");
  const generation = useRef(0);
  const refreshingRead = useRef(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigationButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setActor(initialActor);
  }, [initialActor]);

  const expireSession = useCallback(() => {
    rememberContext(null);
    onSessionExpired();
  }, [onSessionExpired]);

  const reload = useCallback(
    async (
      preferred: Pick<EventContext, "eventId" | "relationship"> | null,
      preserveForms = false,
    ) => {
      if (preserveForms && refreshingRead.current) return;
      refreshingRead.current = true;
      const current = ++generation.current;
      if (!preserveForms) setWorkspace({ phase: "loading" });
      else setRefreshing(true);
      setAccessError("");
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
        if (preserveForms) setRefreshToken((value) => value + 1);
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
        if (preserveForms) {
          setAccessError(
            "Your session could not be checked. Check the connection and retry.",
          );
          return;
        }
        setWorkspace({
          phase: "error",
          message: `The event workspace could not be loaded.${reference}`,
        });
      } finally {
        if (generation.current === current) {
          refreshingRead.current = false;
          setRefreshing(false);
        }
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
        void reload(rememberedContext(), true);
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
  const hasGateAssignment = actor.assignments.some(
    (assignment) => assignment.role === "GATE_SECURITY" && assignment.gate_id,
  );
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
      <div
        className="workspace-bar"
        role="region"
        aria-label="Current event and role"
      >
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
          ) : null}
          {workspace.phase === "ready" && selected ? (
            <p className="active-context">
              Event: {selected.name}{" "}
              <span>
                · Role:{" "}
                {selected.relationship === "owned"
                  ? "Organizer"
                  : "Event Admin"}
              </span>
            </p>
          ) : hasGateAssignment ? (
            <AssignedGateContext assignments={actor.assignments} />
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
              {hasGateAssignment && !selected
                ? "Your assigned event and gate are shown above. Open the scanner to check entries."
                : "Manage the event and role shown above. Choose a section to continue."}
            </p>
          </div>
          <button
            className="secondary-button"
            type="button"
            disabled={workspace.phase === "loading" || refreshing}
            onClick={() => void reload(selected ?? rememberedContext(), true)}
          >
            Refresh workspace
          </button>
        </div>
        {signOutError && (
          <p role="alert" className="notice critical">
            {signOutError}
          </p>
        )}
        {accessError && (
          <p role="alert" className="notice critical">
            {accessError}
          </p>
        )}
        {refreshing && <p role="status">Updating latest information…</p>}
        {workspace.phase === "loading" ? (
          <p role="status" className="notice">
            Loading workspace…
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
            {actor.assignments.some(
              (a) => a.role === "GATE_SECURITY" && a.gate_id,
            ) && <a href="/scanner">Scan entry QR at your assigned gate</a>}
            {actor.assignments.some((a) => a.role === "VOLUNTEER") && (
              <a href="/volunteer">My volunteer tasks</a>
            )}
            {(selected || actor.organizer_capable) && (
              <>
                <button
                  ref={navigationButton}
                  className="workspace-navigation-toggle secondary-button"
                  type="button"
                  aria-expanded={navigationOpen}
                  aria-controls="workspace-sections"
                  onClick={() => setNavigationOpen((value) => !value)}
                >
                  Sections ·{" "}
                  {detailOpen
                    ? {
                        overview: "Overview",
                        setup: "Setup",
                        registrations: "Registrations",
                        team: "Team & Staff",
                        gates: "Gates",
                      }[section]
                    : "My events"}
                </button>
                <nav
                  id="workspace-sections"
                  className={`workspace-nav${navigationOpen ? " is-open" : ""}`}
                  aria-label="Workspace navigation"
                  onClick={() => {
                    setNavigationOpen(false);
                    if (window.matchMedia?.("(max-width: 1023px)").matches)
                      navigationButton.current?.focus();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setNavigationOpen(false);
                      navigationButton.current?.focus();
                    }
                  }}
                >
                  <button
                    type="button"
                    className="text-button"
                    aria-current={!detailOpen ? "page" : undefined}
                    onClick={() => setDetailOpen(false)}
                  >
                    My events
                  </button>
                  {selected && (
                    <a
                      href={`/operations/${encodeURIComponent(selected.eventId)}`}
                    >
                      Live Operations
                    </a>
                  )}
                  {selected && (
                    <a
                      href={`/certificates/${encodeURIComponent(selected.eventId)}`}
                    >
                      Certificates
                    </a>
                  )}
                  {selected && (
                    <>
                      <a
                        href={`/tasks/${encodeURIComponent(selected.eventId)}`}
                      >
                        Volunteer tasks
                      </a>
                      <a
                        href={`/results/${encodeURIComponent(selected.eventId)}`}
                      >
                        Results
                      </a>
                      <a
                        href={`/audit/${encodeURIComponent(selected.eventId)}`}
                      >
                        Activity
                      </a>
                    </>
                  )}
                  {selected &&
                    (
                      [
                        ["overview", "Overview"],
                        ["setup", "Setup"],
                        ["registrations", "Registrations"],
                        ["team", "Team & Staff"],
                        ["gates", "Gates"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className="text-button"
                        aria-current={
                          detailOpen && section === value ? "page" : undefined
                        }
                        onClick={() => {
                          setSection(value);
                          setDetailVisited(true);
                          setDetailOpen(true);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  {showOwned && (
                    <a
                      href="#create-draft"
                      onClick={() => setDetailOpen(false)}
                    >
                      Create event
                    </a>
                  )}
                </nav>
              </>
            )}
            {workspace.contexts.length === 0 &&
              !actor.organizer_capable &&
              !hasGateAssignment && (
                <section className="notice" aria-label="No event context">
                  <h2>No event context</h2>
                  <p>
                    Your account is ready to register for events. You do not
                    currently have an Event management assignment.
                  </p>
                  <a href="/events">Browse public events</a>
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
                          setDetailVisited(true);
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
                          {humanLabel(event.state)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {workspace.assigned.length === 0 &&
              !actor.organizer_capable &&
              !hasGateAssignment &&
              !detailOpen && <p className="empty-state">No assigned events.</p>}
            {selected && detailVisited && (
              <div hidden={!detailOpen}>
                <EventDetail
                  key={contextKey(selected)}
                  context={selected}
                  csrf={actor.csrf_token}
                  section={section}
                  refreshToken={refreshToken}
                  onSectionChange={setSection}
                  onUpdated={(detail) =>
                    setWorkspace((current) =>
                      current.phase !== "ready"
                        ? current
                        : {
                            ...current,
                            owned: current.owned.map((item) =>
                              item.event_id === detail.event_id
                                ? {
                                    ...item,
                                    name: detail.name,
                                    state: detail.state,
                                    start_at: detail.start_at,
                                    end_at: detail.end_at,
                                    time_zone: detail.time_zone,
                                  }
                                : item,
                            ),
                            assigned: current.assigned.map((item) =>
                              item.event_id === detail.event_id
                                ? {
                                    ...item,
                                    name: detail.name,
                                    state: detail.state,
                                    start_at: detail.start_at,
                                    end_at: detail.end_at,
                                    time_zone: detail.time_zone,
                                  }
                                : item,
                            ),
                            contexts: current.contexts.map((item) =>
                              item.eventId === detail.event_id
                                ? {
                                    ...item,
                                    name: detail.name,
                                    state: detail.state,
                                  }
                                : item,
                            ),
                            selected:
                              current.selected?.eventId === detail.event_id
                                ? {
                                    ...current.selected,
                                    name: detail.name,
                                    state: detail.state,
                                  }
                                : current.selected,
                          },
                    )
                  }
                  onSessionExpired={expireSession}
                  onScopeLost={onScopeLost}
                />
              </div>
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
                    <h2 id="owned-heading">My events</h2>
                    <p>
                      Drafts remain private to management until you configure
                      and publish them.
                    </p>
                  </div>
                  {workspace.owned.length === 0 ? (
                    <div className="empty-state">
                      <h3>No events yet</h3>
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
                              {humanLabel(event.state)}
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
                  onCreated={(eventId) => {
                    setDetailVisited(true);
                    setDetailOpen(true);
                    setSection("setup");
                    void reload({ eventId, relationship: "owned" });
                  }}
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
