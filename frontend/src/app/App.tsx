import { useEffect, useState } from "react";
import { currentActor, ProofError, type ActorState } from "../services/proof";
import { ProofEntry } from "./ProofEntry";
import { ThemeControl } from "./ThemeControl";
import { Workspace } from "./Workspace";

export function App() {
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
    <div className="app-frame">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            E
          </span>
          <span>Event Command Center</span>
        </div>
        <ThemeControl />
      </header>
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
    </div>
  );
}
