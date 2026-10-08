import { useCallback, useEffect, useRef, useState } from "react";
import {
  EventApiError,
  getEventDetail,
  type ManagementDetail,
} from "../services/events";
import { formatEventTime, timeZoneLabel } from "../services/event-time";
import type { StaffList } from "../services/staff";
import type { OperationsSnapshot } from "../services/occupancy";
import type { EventContext } from "./contexts";
import { EditEventForm } from "./EditEventForm";
import { EventRegistrations } from "./EventRegistrations";
import { GatePanel } from "./GatePanel";
import { LifecyclePanel } from "./LifecyclePanel";
import { PrivateLinkPanel } from "./PrivateLinkPanel";
import { TeamPanel } from "./TeamPanel";
import { humanLabel } from "./event-presentation";

export type WorkspaceSection =
  "overview" | "setup" | "registrations" | "team" | "gates";
interface Props {
  context: EventContext;
  csrf?: string;
  section?: WorkspaceSection;
  refreshToken?: number;
  onSectionChange?: (section: WorkspaceSection) => void;
  onUpdated?: (detail: ManagementDetail) => void;
  onSessionExpired: () => void;
  onScopeLost: () => void;
}
type DetailState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; detail: ManagementDetail };

export function EventDetail({
  context,
  csrf,
  section,
  refreshToken = 0,
  onSectionChange,
  onUpdated,
  onSessionExpired,
  onScopeLost,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [localSection, setLocalSection] =
    useState<WorkspaceSection>("overview");
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DetailState>({ phase: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [team, setTeam] = useState<StaffList | null>(null);
  const [registrations, setRegistrations] = useState<OperationsSnapshot | null>(
    null,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const currentRead = useRef<AbortController | null>(null);
  const version = useRef(0);
  const ready = useRef(false);
  const latestDetail = useRef<ManagementDetail | null>(null);
  const updated = useRef(onUpdated);
  updated.current = onUpdated;
  const { eventId, relationship } = context;
  const active = section ?? localSection;
  useEffect(() => {
    if (active === "setup") setEditing(true);
  }, [active]);
  const confirmedTeam = useCallback((data: StaffList) => setTeam(data), []);
  const confirmedCount = useCallback(
    (data: OperationsSnapshot | null) => setRegistrations(data),
    [],
  );
  const acceptCurrent = useCallback((detail: ManagementDetail) => {
    if (
      latestDetail.current?.event_id === detail.event_id &&
      latestDetail.current.revision > detail.revision
    )
      return;
    latestDetail.current = detail;
    version.current += 1;
    currentRead.current?.abort();
    ready.current = true;
    setRefreshing(false);
    setState({ phase: "ready", detail });
    updated.current?.(detail);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    currentRead.current = controller;
    const readVersion = ++version.current;
    if (!ready.current) setState({ phase: "loading" });
    else setRefreshing(true);
    setRefreshError("");
    void getEventDetail(eventId, controller.signal)
      .then((detail) => {
        if (controller.signal.aborted || readVersion !== version.current)
          return;
        if (
          latestDetail.current?.event_id === detail.event_id &&
          latestDetail.current.revision > detail.revision
        ) {
          setRefreshing(false);
          return;
        }
        latestDetail.current = detail;
        ready.current = true;
        setState({ phase: "ready", detail });
        setRefreshing(false);
        updated.current?.(detail);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || readVersion !== version.current)
          return;
        setRefreshing(false);
        if (error instanceof EventApiError && error.status === 401) {
          onSessionExpired();
          return;
        }
        if (
          error instanceof EventApiError &&
          [403, 404].includes(error.status)
        ) {
          onScopeLost();
          return;
        }
        const reference =
          error instanceof EventApiError && error.correlationId
            ? ` Reference: ${error.correlationId}.`
            : "";
        const message = `Event details could not be updated. Check the connection and retry.${reference}`;
        if (ready.current) setRefreshError(message);
        else setState({ phase: "error", message });
      });
    return () => controller.abort();
  }, [eventId, attempt, refreshToken, onSessionExpired, onScopeLost]);
  useEffect(() => {
    if (state.phase === "ready") heading.current?.focus();
  }, [state.phase]);
  if (state.phase === "loading")
    return (
      <p role="status" className="notice">
        Loading event detail…
      </p>
    );
  if (state.phase === "error")
    return (
      <div role="alert" className="notice critical">
        <p>{state.message}</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Retry event detail
        </button>
      </div>
    );
  const { detail } = state;
  const canEdit =
    detail.permitted_actions.includes("EDIT_EVENT") &&
    (detail.state === "DRAFT" || detail.state === "PUBLISHED");
  const common = {
    detail,
    csrf,
    onCurrent: acceptCurrent,
    onSessionExpired,
    onScopeLost,
  };
  const showEditor = editing || active === "setup";
  return (
    <section
      id="event-detail"
      aria-labelledby="event-detail-heading"
      className="event-section"
    >
      <div className="page-heading">
        <div>
          <h2 id="event-detail-heading" ref={heading} tabIndex={-1}>
            {detail.name}
          </h2>
          <p>
            Status: {humanLabel(detail.state)} · Role:{" "}
            {relationship === "owned" ? "Organizer" : "Event Admin"}
          </p>
          <p>{timeZoneLabel(detail.time_zone)}</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={refreshing}
          onClick={() => setAttempt((value) => value + 1)}
        >
          Reload detail
        </button>
      </div>
      {refreshing && <p role="status">Updating latest information…</p>}
      {refreshError && (
        <p role="alert">{refreshError} Your entered values have been kept.</p>
      )}
      <div hidden={active !== "overview"}>
        <h3>Event details</h3>
        <dl className="event-detail-fields">
          {[
            ["Description", detail.description ?? "Not configured"],
            ["Public location", detail.public_location ?? "Not configured"],
            ["Event image", detail.image_url ?? "Not configured"],
            ["Category", detail.category ?? "Not configured"],
            ["Tags", detail.tags.join(", ") || "None"],
            [
              "Event access",
              detail.visibility === "PUBLIC"
                ? "Public"
                : detail.visibility === "PRIVATE"
                  ? "Invitation"
                  : "Not configured",
            ],
            [
              "Event starts",
              formatEventTime(detail.start_at, detail.time_zone),
            ],
            ["Event ends", formatEventTime(detail.end_at, detail.time_zone)],
            [
              "Registration limit",
              detail.registration_capacity ?? "Not configured",
            ],
            [
              "Registration opens",
              detail.registration_opens_at
                ? formatEventTime(
                    detail.registration_opens_at,
                    detail.time_zone,
                  )
                : "On publication",
            ],
            [
              "Registration closes",
              formatEventTime(
                detail.registration_closes_at ?? detail.start_at,
                detail.time_zone,
              ),
            ],
            [
              "Participants can cancel until",
              formatEventTime(
                detail.registration_cancellation_cutoff_at,
                detail.time_zone,
              ),
            ],
            ["Check-out", detail.checkout_enabled ? "Enabled" : "Disabled"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <LifecyclePanel
          {...common}
          owner={relationship === "owned"}
          registeredCount={
            registrations?.event_state === detail.state &&
            registrations.capacity === detail.registration_capacity
              ? registrations.registered
              : null
          }
        />
        {csrf && canEdit && (
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setLocalSection("setup");
              onSectionChange?.("setup");
            }}
          >
            Edit event
          </button>
        )}
      </div>
      <div hidden={active !== "setup"}>
        <h3>Setup</h3>
        {csrf && showEditor && (canEdit || editing) ? (
          <EditEventForm
            {...common}
            csrf={csrf}
            owner={relationship === "owned"}
            editable={canEdit}
          />
        ) : (
          <p>Setup is read-only in the event's current status.</p>
        )}
        <PrivateLinkPanel {...common} owner={relationship === "owned"} />
      </div>
      <div hidden={active !== "registrations"}>
        {csrf && (
          <EventRegistrations
            detail={detail}
            refreshToken={refreshToken}
            onSessionExpired={onSessionExpired}
            onScopeLost={onScopeLost}
            onCount={confirmedCount}
          />
        )}
      </div>
      <div hidden={active !== "gates"}>
        <GatePanel {...common} assignments={team?.assignments} />
      </div>
      <div hidden={active !== "team"}>
        {csrf && (
          <TeamPanel
            key={`team:${detail.event_id}`}
            detail={detail}
            csrf={csrf}
            onLoaded={confirmedTeam}
            refreshToken={refreshToken}
            onSessionExpired={onSessionExpired}
            onScopeLost={onScopeLost}
          />
        )}
      </div>
      <p className="freshness">
        Confirmed {formatEventTime(detail.as_of, detail.time_zone)}.
      </p>
      <details className="advanced-details">
        <summary>Advanced details</summary>
        <dl className="event-detail-fields">
          <div>
            <dt>Event reference</dt>
            <dd>{detail.event_id}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{detail.revision}</dd>
          </div>
          <div>
            <dt>Internal state</dt>
            <dd>{detail.state}</dd>
          </div>
          <div>
            <dt>Support reference</dt>
            <dd>{detail.correlation_id}</dd>
          </div>
        </dl>
      </details>
    </section>
  );
}
