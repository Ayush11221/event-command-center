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
    document.title = `${scanner ? "Gate scanner" : registration ? "Registration recovery" : privatePage ? "Private event detail" : catalog ? "Public events" : eventId ? "Public event detail" : "Event workspace"} · Event Command Center`;
  }, [catalog, eventId, privatePage, registration, scanner]);
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
          <a href="/">Event workspace</a>
          <a href="/scanner" aria-current={scanner ? "page" : undefined}>
            Gate scanner
          </a>
        </nav>
        <ThemeControl />
      </header>
      {scanner ? (
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
