import { useEffect, useState } from "react";
import { currentActor, ProofError, type ActorState } from "../services/proof";
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

function ManagementEntry() {
  const [session, setSession] = useState<
    | { state: "checking" }
    | { state: "anonymous" }
    | { state: "error" }
    | { state: "authenticated"; actor: ActorState }
  >({ state: "checking" });

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
            ? { state: "anonymous" }
            : { state: "error" },
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
          <h1>Session unavailable</h1>
          <p role="alert">
            Your session could not be checked. Check the connection and retry.
          </p>
          <button
            type="button"
            onClick={() => {
              setSession({ state: "checking" });
              void currentActor()
                .then((actor) => setSession({ state: "authenticated", actor }))
                .catch((error: unknown) => {
                  setSession(
                    error instanceof ProofError && error.status === 401
                      ? { state: "anonymous" }
                      : { state: "error" },
                  );
                });
            }}
          >
            Retry session check
          </button>
        </main>
      ) : session.state === "anonymous" ? (
        <ProofEntry
          onAccountAuthenticated={(actor) =>
            setSession({ state: "authenticated", actor })
          }
        />
      ) : (
        <Workspace
          initialActor={session.actor}
          onSessionExpired={() => setSession({ state: "anonymous" })}
          onSignedOut={() => setSession({ state: "anonymous" })}
        />
      )}
    </>
  );
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
    document.title = `${taskEvent ? "Volunteer tasks" : resultEvent ? "Completed event results" : auditEvent ? "Event audit evidence" : volunteerRoute ? "My tasks" : certificates ? "Certificates" : operations ? "Attendance and occupancy" : scanner ? "Gate scanner" : registration ? "Registration recovery" : privatePage ? "Private event detail" : catalog ? "Public events" : eventId ? "Public event detail" : "Event workspace"} · Event Command Center`;
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
              <a href="/scanner" aria-current={scanner ? "page" : undefined}>
                Gate scanner
              </a>
            </>
          )}
        </nav>
        <ThemeControl />
      </header>
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
          <h1>Registration recovery</h1>
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
