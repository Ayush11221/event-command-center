import { GuidedTour, WORKSPACE_TOUR } from "./GuidedTour";
import { EventCampus } from "./EventCampus";
import { Accent, IsoBuilding } from "../components/common/Iso";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  EventApiError,
  listAllEvents,
  type ManagementEvent,
} from "../services/events";
import { currentActor, ProofError, type ActorState } from "../services/proof";
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
import { NavIndicator } from "../components/common/motion";
import { CommandPalette, type Command } from "./CommandPalette";
import {
  Award,
  CalendarRange,
  Compass,
  ChartColumn,
  LayoutGrid,
  Search,
  ChevronDown,
  History,
  ListChecks,
  Plus,
  Radio,
  RefreshCw,
  ScanLine,
} from "lucide-react";

interface Props {
  initialActor: ActorState;
  onSessionExpired: () => void;
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

export function Workspace({ initialActor, onSessionExpired }: Props) {
  const [actor, setActor] = useState(initialActor);
  const [workspace, setWorkspace] = useState<WorkspaceState>({
    phase: "loading",
  });
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [touring, setTouring] = useState(false);
  // The create form only renders once the event detail is closed, so the
  // jump has to happen after that render (a plain #anchor would miss it).
  const [createRequest, setCreateRequest] = useState(0);
  useEffect(() => {
    if (!createRequest) return;
    const form = document.getElementById("create-draft");
    form?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    form
      ?.querySelector<HTMLInputElement>("input")
      ?.focus({ preventScroll: true });
  }, [createRequest]);
  const openCreate = () => {
    setDetailOpen(false);
    setCreateRequest((value) => value + 1);
    window.history.replaceState(null, "", "#create-draft");
  };
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  const commands: Command[] = [];
  if (workspace.phase === "ready") {
    const open = (value: WorkspaceSection) => () => {
      setSection(value);
      setDetailVisited(true);
      setDetailOpen(true);
    };
    if (selected || actor.organizer_capable)
      commands.push({
        id: "my-events",
        label: "My events",
        group: "Sections",
        Icon: LayoutGrid,
        run: () => setDetailOpen(false),
      });
    if (selected) {
      (
        [
          ["overview", "Overview"],
          ["setup", "Setup"],
          ["registrations", "Registrations"],
          ["team", "Team & Staff"],
          ["gates", "Gates"],
        ] as const
      ).forEach(([value, label]) =>
        commands.push({
          id: `section-${value}`,
          label,
          group: "Sections",
          Icon: LayoutGrid,
          run: open(value),
        }),
      );
      const id = encodeURIComponent(selected.eventId);
      (
        [
          ["operations", "Live Operations", Radio],
          ["certificates", "Certificates", Award],
          ["tasks", "Volunteer tasks", ListChecks],
          ["results", "Results", ChartColumn],
          ["audit", "Activity", History],
        ] as const
      ).forEach(([path, label, Icon]) =>
        commands.push({
          id: `page-${path}`,
          label,
          group: "Pages",
          Icon,
          run: () => window.location.assign(`/${path}/${id}`),
        }),
      );
    }
    if (hasGateAssignment)
      commands.push({
        id: "scanner",
        label: "Gate scanner",
        group: "Pages",
        Icon: ScanLine,
        run: () => window.location.assign("/scanner"),
      });
    if (showOwned)
      commands.push({
        id: "create",
        label: "Create event",
        group: "Actions",
        Icon: Plus,
        run: openCreate,
      });
    workspace.contexts
      .filter(
        (context) => !selected || contextKey(context) !== contextKey(selected),
      )
      .forEach((context) =>
        commands.push({
          id: `context-${contextKey(context)}`,
          label: `${context.name} — ${context.relationship === "owned" ? "Organizer" : "Event Admin"}`,
          group: "Switch event",
          Icon: CalendarRange,
          run: () => void reload(context),
        }),
      );
  }
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
          {workspace.phase === "ready" && commands.length > 0 && (
            <button
              className="secondary-button palette-trigger"
              type="button"
              aria-keyshortcuts="Control+K Meta+K"
              onClick={() => setPaletteOpen(true)}
            >
              <Search aria-hidden="true" className="size-4" />
              Quick actions
              <kbd aria-hidden="true">{isMac ? "⌘K" : "Ctrl K"}</kbd>
            </button>
          )}
        </div>
      </div>
      <main className="page-shell workspace-main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">EVENT MANAGEMENT</p>
            <h1>
              Event <Accent>workspace</Accent>
            </h1>
            <p>
              {hasGateAssignment && !selected
                ? "Your assigned event and gate are shown above. Open the scanner to check entries."
                : "Manage the event and role shown above. Choose a section to continue."}
            </p>
          </div>
          <div className="page-heading-actions">
            {workspace.phase === "ready" && (
              <button
                className="text-button"
                type="button"
                onClick={() => setTouring(true)}
              >
                <Compass aria-hidden="true" className="size-4" />
                Take the tour
              </button>
            )}
            <button
              className="secondary-button"
              type="button"
              disabled={workspace.phase === "loading" || refreshing}
              onClick={() => void reload(selected ?? rememberedContext(), true)}
            >
              <RefreshCw
                aria-hidden="true"
                className={refreshing ? "size-4 animate-spin" : "size-4"}
              />
              Refresh workspace
            </button>
          </div>
        </div>
        {accessError && (
          <p role="alert" className="notice critical">
            {accessError}
          </p>
        )}
        {refreshing && <p role="status">Updating latest information…</p>}
        {workspace.phase === "loading" ? (
          <p role="status" className="notice is-loading">
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
            ) && (
              <a href="/scanner">
                <ScanLine aria-hidden="true" className="size-4" />
                Scan entry QR at your assigned gate
              </a>
            )}
            {actor.assignments.some((a) => a.role === "VOLUNTEER") && (
              <a href="/volunteer">
                <ListChecks aria-hidden="true" className="size-4" />
                My volunteer tasks
              </a>
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
                  <ChevronDown
                    aria-hidden="true"
                    className={`size-4 transition-transform duration-200 ${navigationOpen ? "rotate-180" : ""}`}
                  />
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
                  <div className="nav-tabs">
                    <button
                      type="button"
                      className="text-button"
                      aria-current={!detailOpen ? "page" : undefined}
                      onClick={() => setDetailOpen(false)}
                    >
                      {!detailOpen && <NavIndicator id="workspace-section" />}
                      <span className="nav-label">My events</span>
                    </button>
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
                          {detailOpen && section === value && (
                            <NavIndicator id="workspace-section" />
                          )}
                          <span className="nav-label">{label}</span>
                        </button>
                      ))}
                  </div>
                  {(selected || showOwned) && (
                    <div className="nav-links">
                      {selected && (
                        <>
                          <a
                            className="nav-link-live"
                            href={`/operations/${encodeURIComponent(selected.eventId)}`}
                          >
                            <Radio aria-hidden="true" className="size-4" />
                            Live Operations
                          </a>
                          <a
                            href={`/certificates/${encodeURIComponent(selected.eventId)}`}
                          >
                            <Award aria-hidden="true" className="size-4" />
                            Certificates
                          </a>
                          <a
                            href={`/tasks/${encodeURIComponent(selected.eventId)}`}
                          >
                            <ListChecks aria-hidden="true" className="size-4" />
                            Volunteer tasks
                          </a>
                          <a
                            href={`/results/${encodeURIComponent(selected.eventId)}`}
                          >
                            <ChartColumn
                              aria-hidden="true"
                              className="size-4"
                            />
                            Results
                          </a>
                          <a
                            href={`/audit/${encodeURIComponent(selected.eventId)}`}
                          >
                            <History aria-hidden="true" className="size-4" />
                            Activity
                          </a>
                        </>
                      )}
                      {showOwned && (
                        <a
                          className="nav-link-create"
                          href="#create-draft"
                          onClick={(event) => {
                            event.preventDefault();
                            openCreate();
                          }}
                        >
                          <Plus aria-hidden="true" className="size-4" />
                          Create event
                        </a>
                      )}
                    </div>
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
                        <span className="event-row-title">
                          <IsoBuilding
                            tone={`state-${event.state.toLowerCase()}`}
                          />
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
              </section>
            )}
            {workspace.assigned.length === 0 &&
              !actor.organizer_capable &&
              !hasGateAssignment &&
              !detailOpen && <p className="empty-state">No assigned events.</p>}
            {selected && detailVisited && (
              <div className="workspace-panel" hidden={!detailOpen}>
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
                  <EventCampus
                    events={workspace.owned}
                    selectedId={
                      selected?.relationship === "owned"
                        ? selected.eventId
                        : null
                    }
                    onOpen={(eventId) =>
                      void reload({ eventId, relationship: "owned" })
                    }
                  />
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
                              <IsoBuilding
                                tone={`state-${event.state.toLowerCase()}`}
                              />
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
      {touring && (
        <GuidedTour steps={WORKSPACE_TOUR} onClose={() => setTouring(false)} />
      )}
      {paletteOpen && commands.length > 0 && (
        <CommandPalette
          commands={commands}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </>
  );
}
