import { useCallback, useEffect, useState } from "react";
import { currentActor, ProofError, type ActorState } from "../services/proof";
import { subscribeAccountSession } from "../services/account-session";
import { ProofEntry } from "./ProofEntry";
import { ThemeControl } from "./ThemeControl";
import { Workspace } from "./Workspace";
import { PublicCatalog } from "./PublicCatalog";
import { PublicEventDetail } from "./PublicEventDetail";
import { PrivateEventDetail } from "./PrivateEventDetail";
import type { PrivateEntry } from "./private-entry";
import { RegistrationPanel } from "./RegistrationPanel";
import { GateScanner } from "./GateScanner";
import { OccupancyPage } from "./OccupancyPage";
import { CertificatesPage } from "./CertificatesPage";
import { TasksPage, VolunteerEntry } from "./TasksPage";
import { ResultsPage } from "./ResultsPage";
import { AuditPage } from "./AuditPage";
import { ParticipantHome } from "./ParticipantHome";
import { accessMessage } from "./auth-feedback";

function ManagementEntry() {
  const [session, setSession] = useState<
    | { state: "checking" }
    | { state: "anonymous"; expired?: boolean }
    | { state: "error"; message: string }
    | { state: "authenticated"; actor: ActorState; expired?: boolean }
  >({ state: "checking" });

  const expire = useCallback(() => {
    setSession((current) =>
      current.state === "authenticated"
        ? { ...current, expired: true }
        : { state: "anonymous", expired: true },
    );
  }, []);
  const signedOut = useCallback(() => setSession({ state: "anonymous" }), []);

  useEffect(
    () =>
      subscribeAccountSession((event) => {
        if (event === "expired") expire();
        if (event === "signed-out") signedOut();
      }),
    [expire, signedOut],
  );

  useEffect(() => {
    let current = true;
    currentActor()
      .then((actor) => {
        if (current) setSession({ state: "authenticated", actor });
      })
      .catch((error: unknown) => {
        if (!current) return;
        setSession(
          error instanceof ProofError && error.status === 401
            ? { state: "anonymous", expired: error.code === "SESSION_EXPIRED" }
            : { state: "error", message: accessMessage(error) },
        );
      });
    return () => {
      current = false;
    };
  }, []);

  return (
    <>
      {session.state === "checking" ? (
        <main className="page-shell">
          <p role="status">Checking your session…</p>
        </main>
      ) : session.state === "error" ? (
        <main className="page-shell">
          <h1>Access unavailable</h1>
          <p role="alert">{session.message}</p>
          <button
            type="button"
            onClick={() => {
              setSession({ state: "checking" });
              void currentActor()
                .then((actor) => setSession({ state: "authenticated", actor }))
                .catch((error: unknown) => {
                  setSession(
                    error instanceof ProofError && error.status === 401
                      ? {
                          state: "anonymous",
                          expired: error.code === "SESSION_EXPIRED",
                        }
                      : { state: "error", message: accessMessage(error) },
                  );
                });
            }}
          >
            Try again
          </button>
        </main>
      ) : session.state === "anonymous" ? (
        <ProofEntry
          expired={session.expired}
          onAccountAuthenticated={(actor) =>
            setSession({ state: "authenticated", actor })
          }
        />
      ) : (
        <>
          {session.expired && (
            <ProofEntry
              expired
              onAccountAuthenticated={(actor) =>
                setSession({ state: "authenticated", actor })
              }
            />
          )}
          <div
            hidden={session.expired}
            inert={session.expired}
            key={session.actor.user_id}
          >
            {session.actor.organizer_capable ||
            session.actor.assignments.length > 0 ? (
              <Workspace
                initialActor={session.actor}
                onSessionExpired={expire}
                onSignedOut={signedOut}
              />
            ) : (
              <ParticipantHome actor={session.actor} onSignedOut={signedOut} />
            )}
          </div>
        </>
      )}
    </>
  );
}

function AccountSessionNotice() {
  const [message, setMessage] = useState("");
  useEffect(
    () =>
      subscribeAccountSession((event) => {
        setMessage(
          event === "expired"
            ? "Your session has expired. Sign in again to continue."
            : event === "unavailable"
              ? "We couldn't verify your access right now. Please try again."
              : event === "renewed"
                ? ""
                : "You signed out.",
        );
      }),
    [],
  );
  return message ? (
    <p className="notice page-shell" role="status" aria-live="polite">
      {message}
    </p>
  ) : null;
}

export function App({ privateEntry }: { privateEntry?: PrivateEntry } = {}) {
  const path = window.location.pathname;
  const scanner = /^\/scanner\/?$/.test(path);
  const operations = path.match(/^\/operations\/([^/]+)\/?$/)?.[1];
  const certificates = path.match(/^\/certificates\/([0-9a-f-]+)\/?$/i)?.[1];
  const taskEvent = path.match(/^\/tasks\/([0-9a-f-]+)\/?$/i)?.[1];
  const resultEvent = path.match(/^\/results\/([0-9a-f-]+)\/?$/i)?.[1];
  const auditEvent = path.match(/^\/audit\/([0-9a-f-]+)\/?$/i)?.[1];
  const volunteerRoute = path.match(
    /^\/volunteer(?:\/([0-9a-f-]+)\/tasks(?:\/([0-9a-f-]+))?)?\/?$/i,
  );
  const catalog = /^\/events\/?$/.test(path);
  const privatePage = /^\/private\/?$/.test(path);
  const detail = path.match(/^\/events\/([^/]+)\/?$/);
  const registration = path.match(/^\/registrations\/([0-9a-f-]+)\/?$/i)?.[1];
  let eventId = detail?.[1];
  if (eventId) {
    try {
      eventId = decodeURIComponent(eventId);
    } catch {
      /* Malformed IDs receive the same public unavailable response. */
    }
  }
  useEffect(() => {
    document.title = `${taskEvent ? "Volunteer tasks" : resultEvent ? "Results" : auditEvent ? "Activity" : volunteerRoute ? "My tasks" : certificates ? "Certificates" : operations ? "Live Operations" : scanner ? "Gate scanner" : registration ? "Registration recovery" : privatePage ? "Private event detail" : catalog ? "Public events" : eventId ? "Public event detail" : "Event workspace"} · Event Command Center`;
  }, [
    catalog,
    eventId,
    privatePage,
    registration,
    scanner,
    operations,
    certificates,
    taskEvent,
    resultEvent,
    auditEvent,
    volunteerRoute?.[0],
  ]);
  return (
    <div className="app-frame">
      <button
        type="button"
        className="skip-link"
        onClick={() => {
          const main = document.querySelector("main");
          if (main) {
            main.tabIndex = -1;
            main.focus();
          }
        }}
      >
        Skip to main content
      </button>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            E
          </span>
          <span>Event Command Center</span>
        </div>
        <nav className="entry-nav" aria-label="Primary navigation">
          <a
            href="/events"
            aria-current={catalog || detail ? "page" : undefined}
          >
            Public events
          </a>
          {volunteerRoute ? (
            <a href="/volunteer">My tasks</a>
          ) : (
            <>
              <a href="/">Event workspace</a>
              {(scanner ||
                operations ||
                certificates ||
                taskEvent ||
                resultEvent ||
                auditEvent) && (
                <a href="/scanner" aria-current={scanner ? "page" : undefined}>
                  Gate scanner
                </a>
              )}
            </>
          )}
        </nav>
        <ThemeControl />
      </header>
      <AccountSessionNotice />
      {taskEvent ? (
        <TasksPage key={taskEvent} eventId={taskEvent} staff />
      ) : resultEvent ? (
        <ResultsPage key={resultEvent} eventId={resultEvent} />
      ) : auditEvent ? (
        <AuditPage key={auditEvent} eventId={auditEvent} />
      ) : volunteerRoute ? (
        volunteerRoute[1] ? (
          <TasksPage
            key={volunteerRoute[0]}
            eventId={volunteerRoute[1]}
            taskId={volunteerRoute[2]}
          />
        ) : (
          <VolunteerEntry />
        )
      ) : certificates ? (
        <CertificatesPage key={certificates} eventId={certificates} />
      ) : operations ? (
        <OccupancyPage key={operations} eventId={operations} />
      ) : scanner ? (
        <GateScanner />
      ) : registration ? (
        <main className="page-shell public-page">
          <h1>View your registration</h1>
          <RegistrationPanel registrationId={registration} />
        </main>
      ) : privatePage ? (
        <PrivateEventDetail entry={privateEntry} />
      ) : catalog ? (
        <PublicCatalog />
      ) : eventId ? (
        <PublicEventDetail key={eventId} eventId={eventId} />
      ) : (
        <ManagementEntry />
      )}
    </div>
  );
}
