import { useEffect, useState } from "react";
import { checkHealth } from "../services/health";

type HealthState = "loading" | "available" | "unavailable";

export function App() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<HealthState>("loading");

  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    checkHealth(controller.signal)
      .then(() => {
        if (!controller.signal.aborted) setState("available");
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("unavailable");
      });
    return () => controller.abort();
  }, [attempt]);

  return (
    <main className="shell">
      <h1>Developer bootstrap</h1>
      <p className="intro">
        This verifies the local frontend and API process. The Event Command
        Center is not implemented yet.
      </p>

      <section className="status-section" aria-labelledby="api-heading">
        <h2 id="api-heading">API process</h2>
        {state === "unavailable" ? (
          <p className="status status-error" role="alert">
            Unavailable. The API process could not be reached.
          </p>
        ) : (
          <p className="status" role="status" aria-live="polite">
            {state === "loading"
              ? "Checking API process…"
              : "Available. API process is responding."}
          </p>
        )}
        <button
          type="button"
          disabled={state === "loading"}
          onClick={() => setAttempt((value) => value + 1)}
        >
          Retry check
        </button>
        <p className="note">
          This is process liveness only. It does not verify a database or any
          product workflow.
        </p>
      </section>
    </main>
  );
}
