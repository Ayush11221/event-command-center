import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { currentActor, ProofError, type ActorState } from "../services/proof";
import {
  scannerScope,
  submitScan,
  type ScanCommand,
  type ScanResult,
} from "../services/scanning";

const messages = {
  ACCEPTED: "Check-in accepted. Entry permitted.",
  INVALID_CREDENTIAL: "Invalid credential for this event. Entry not permitted.",
  EXPIRED_CREDENTIAL: "Credential expired. Entry not permitted.",
  CANCELLED_CREDENTIAL:
    "Registration or credential cancelled. Entry not permitted.",
  ALREADY_CHECKED_IN: "Already checked in. Duplicate entry not permitted.",
  REGISTRATION_UNAVAILABLE:
    "Check-in is unavailable. The event must be Live with a valid registration.",
};
export function GateScanner() {
  const [actor, setActor] = useState<ActorState | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const scopeLost = useCallback(() => {
    setActor(null);
    setError(
      "Scanner access lost. Hold entry and recheck your session and gate assignment.",
    );
  }, []);
  useEffect(() => {
    let active = true;
    void currentActor()
      .then((value) => {
        if (active) {
          setActor(value);
          setChecking(false);
        }
      })
      .catch((failure: unknown) => {
        if (!active) return;
        setError(
          failure instanceof ProofError && failure.status === 401
            ? "Sign in with a Gate/Security account to scan."
            : "Session unavailable. Hold entry and retry the session check.",
        );
        setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  const gates =
    actor?.assignments.filter((a) => a.role === "GATE_SECURITY" && a.gate_id) ??
    [];
  return (
    <main className="page-shell scanner-page">
      <h1>Gate scanner</h1>
      <p>
        Check-in for your assigned gate. Entry requires an accepted server
        decision.
      </p>
      {checking ? (
        <p role="status">Checking scanner access...</p>
      ) : error ? (
        <>
          <p role="alert">{error}</p>
          <a href="/">Sign in at the event workspace</a>
          <button
            type="button"
            onClick={() => {
              setChecking(true);
              setError("");
              setAttempt((v) => v + 1);
            }}
          >
            Retry session check
          </button>
        </>
      ) : !gates.length ? (
        <p role="alert">
          Scanner access requires a current Gate/Security assignment. Organizer,
          Event Admin and Volunteer roles alone cannot scan.
        </p>
      ) : (
        <ScannerPanel actor={actor!} gates={gates} onScopeLost={scopeLost} />
      )}
    </main>
  );
}
function ScannerPanel({
  actor,
  gates,
  onScopeLost,
}: {
  actor: ActorState;
  gates: ActorState["assignments"];
  onScopeLost: () => void;
}) {
  const [gateIndex, setGateIndex] = useState(0);
  const [scope, setScope] = useState<"checking" | "ready" | "error">(
    "checking",
  );
  const [scopeAttempt, setScopeAttempt] = useState(0);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");
  const [retryable, setRetryable] = useState(false);
  const pending = useRef<ScanCommand | null>(null);
  const controller = useRef<AbortController | null>(null);
  const gate = gates[gateIndex];
  const eventId = gate.event_id,
    gateId = gate.gate_id!;
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    setScope("checking");
    setToken("");
    setResult(null);
    setError("");
    pending.current = null;
    void scannerScope(eventId, gateId, abort.signal)
      .then(() => {
        if (active) setScope("ready");
      })
      .catch((failure: unknown) => {
        if (!active) return;
        if (
          failure instanceof ProofError &&
          [401, 403, 404].includes(failure.status)
        )
          onScopeLost();
        else setScope("error");
      });
    const hide = () => {
      controller.current?.abort();
      pending.current = null;
      setToken("");
      setResult(null);
      onScopeLost();
    };
    window.addEventListener("pagehide", hide);
    return () => {
      active = false;
      abort.abort();
      controller.current?.abort();
      pending.current = null;
      window.removeEventListener("pagehide", hide);
    };
  }, [eventId, gateId, scopeAttempt, onScopeLost]);
  async function send(command: ScanCommand) {
    const abort = new AbortController();
    controller.current = abort;
    pending.current = command;
    setToken("");
    setBusy(true);
    setResult(null);
    setError("");
    setRetryable(false);
    try {
      const response = await submitScan(
        command,
        actor.csrf_token,
        abort.signal,
      );
      if (abort.signal.aborted) return;
      pending.current = null;
      setResult(response);
    } catch (failure) {
      if (abort.signal.aborted) return;
      if (
        failure instanceof ProofError &&
        [401, 403, 404].includes(failure.status)
      ) {
        pending.current = null;
        onScopeLost();
        return;
      }
      const retry =
        !(failure instanceof ProofError) ||
        failure.status === 0 ||
        failure.status >= 500;
      setRetryable(retry);
      setError(
        retry
          ? "Decision unknown. Hold entry. Retry this same scan to recover its server result."
          : failure instanceof ProofError && failure.status === 409
            ? "Scan retry conflicts with the original command. Hold entry and start a new scan."
            : failure instanceof ProofError && failure.status === 410
              ? "Scan replay expired. Hold entry and start a new scan."
              : "Scan request was not accepted. Hold entry and check the input.",
      );
      if (!retry) pending.current = null;
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (scope !== "ready" || busy || pending.current || !token.trim()) return;
    void send({
      scan_id: crypto.randomUUID(),
      event_id: eventId,
      gate_id: gateId,
      credential: token.trim(),
    });
  }
  return (
    <section aria-label="Check-in station">
      <label className="scanner-context">
        Assigned gate
        <select
          value={gateIndex}
          disabled={busy || !!pending.current}
          onChange={(e) => setGateIndex(Number(e.target.value))}
        >
          {gates.map((g, index) => (
            <option key={g.id} value={index}>
              Event {g.event_id} / Gate {g.gate_id}
            </option>
          ))}
        </select>
      </label>
      <dl className="scanner-identifiers">
        <dt>Event</dt>
        <dd>{eventId}</dd>
        <dt>Gate</dt>
        <dd>{gateId}</dd>
      </dl>
      {scope === "checking" ? (
        <p role="status">Verifying gate context...</p>
      ) : scope === "error" ? (
        <>
          <p role="alert">Gate context unavailable. Hold entry.</p>
          <button type="button" onClick={() => setScopeAttempt((v) => v + 1)}>
            Retry gate check
          </button>
        </>
      ) : (
        <form onSubmit={submit} className="scanner-form" aria-busy={busy}>
          <label htmlFor="scan-token">QR credential</label>
          <p id="scan-help">
            Scan or paste the opaque QR token. Do not enter participant contact
            information.
          </p>
          <input
            id="scan-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            maxLength={128}
            aria-describedby="scan-help"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={busy || !!pending.current}
          />
          <button
            type="submit"
            disabled={busy || !!pending.current || !token.trim()}
          >
            Check in
          </button>
        </form>
      )}
      {busy && <p role="status">Checking credential. Hold entry...</p>}
      {result && (
        <div
          className={
            result.decision === "ACCEPTED"
              ? "scanner-result scanner-accepted"
              : "scanner-result scanner-rejected"
          }
          role="status"
          aria-live="polite"
        >
          <h2>
            {result.decision === "ACCEPTED"
              ? "Accepted"
              : result.reason === "ALREADY_CHECKED_IN"
                ? "Duplicate"
                : "Rejected"}
          </h2>
          <p>{messages[result.reason]}</p>
          <p>
            Server decision: {new Date(result.decided_at).toLocaleString()}
            {result.replayed ? " (recovered result)" : ""}
          </p>
        </div>
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          {retryable && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (pending.current) void send(pending.current);
              }}
            >
              Retry same scan
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              pending.current = null;
              setError("");
              setRetryable(false);
              setResult(null);
            }}
          >
            Start new scan
          </button>
        </div>
      )}
    </section>
  );
}
