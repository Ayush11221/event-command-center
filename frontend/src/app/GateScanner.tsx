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
import { CameraCapture } from "./CameraCapture";
import type { ScannerScope } from "../services/scanning";

const messages = {
  ACCEPTED: "Entry allowed",
  INVALID_CREDENTIAL: "QR code not recognized",
  EXPIRED_CREDENTIAL: "QR code expired",
  CANCELLED_CREDENTIAL: "Registration cancelled",
  ALREADY_CHECKED_IN: "Already checked in",
  REGISTRATION_UNAVAILABLE: "Entry is not currently open",
};
export function GateScanner() {
  const [actor, setActor] = useState<ActorState | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const scopeLost = useCallback(() => {
    setActor(null);
    setError(
      "Scanner access lost. You are not assigned to this gate or your session has ended. Hold entry and recheck your access.",
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
      <a href="/">Back to event workspace</a>
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
  const [labels, setLabels] = useState<Record<string, ScannerScope>>({});
  const controller = useRef<AbortController | null>(null);
  const manual = useRef<HTMLDetailsElement>(null);
  const manualInput = useRef<HTMLInputElement>(null);
  const capture = useRef<HTMLDivElement>(null);
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
    setBusy(false);
    void scannerScope(eventId, gateId, abort.signal)
      .then((context) => {
        if (active) {
          setLabels((current) => ({ ...current, [gate.id]: context }));
          setScope("ready");
        }
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
  }, [eventId, gateId, gate.id, scopeAttempt, onScopeLost]);
  useEffect(() => {
    const abort = new AbortController();
    void Promise.allSettled(
      gates
        .filter((assignment) => assignment.id !== gates[0].id)
        .map(async (assignment) => {
          const value = await scannerScope(
            assignment.event_id,
            assignment.gate_id!,
            abort.signal,
          );
          if (!abort.signal.aborted)
            setLabels((current) => ({ ...current, [assignment.id]: value }));
        }),
    );
    return () => abort.abort();
  }, [gates]);
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
          ? "Couldn't confirm this scan. Check your connection and try again. Decision unknown. Hold entry. Retry this same scan to recover its server result."
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
    scan(token.trim());
  }
  function scan(value: string) {
    if (
      scope !== "ready" ||
      pending.current ||
      (controller.current && !controller.current.signal.aborted && busy)
    )
      return;
    if (!value || value.length > 128) {
      setResult(null);
      setError(
        "This QR code cannot be read as an entry code. Use the attendee's entry QR.",
      );
      setRetryable(false);
      return;
    }
    void send({
      scan_id: crypto.randomUUID(),
      event_id: eventId,
      gate_id: gateId,
      credential: value,
    });
  }
  return (
    <section aria-label="Check-in station">
      {gates.length > 1 && (
        <label className="scanner-context">
          Assigned gate
          <select
            value={gateIndex}
            disabled={busy || !!pending.current}
            onChange={(e) => setGateIndex(Number(e.target.value))}
          >
            {gates.map((g, index) => (
              <option key={g.id} value={index}>
                {labels[g.id]
                  ? `${labels[g.id].event_name} / ${labels[g.id].gate_label}`
                  : `Assigned gate ${index + 1} — checking name`}
              </option>
            ))}
          </select>
        </label>
      )}
      <dl className="scanner-identifiers">
        <dt>Event</dt>
        <dd>{labels[gate.id]?.event_name ?? "Checking event name…"}</dd>
        <dt>Role</dt>
        <dd>Gate / Security</dd>
        <dt>Gate</dt>
        <dd>{labels[gate.id]?.gate_label ?? "Checking gate name…"}</dd>
      </dl>
      {busy && <p role="status">Confirming entry. Hold entry…</p>}
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
            {result.reason === "CANCELLED_CREDENTIAL" &&
            result.registration_status !== "CANCELLED"
              ? "QR code cancelled"
              : messages[result.reason]}
          </h2>
          <p>
            {result.decision === "ACCEPTED"
              ? "Registration confirmed. Participant checked in."
              : result.reason === "INVALID_CREDENTIAL"
                ? "This QR code cannot be used here. Use the entry QR for this event. Hold entry."
                : "Entry not permitted. Hold entry."}
          </p>
          {result.replayed && <p>Recovered result.</p>}
          <p>Ready for the next person. Move this QR code out of view.</p>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setToken("");
              if (manual.current) manual.current.open = false;
              capture.current?.focus();
            }}
          >
            Scan next person
          </button>
        </div>
      )}
      {error && (
        <div className="scanner-result" role="alert">
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
          {!retryable && (
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
          )}
        </div>
      )}
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
        <>
          <div ref={capture} tabIndex={-1}>
            <CameraCapture
              key={`${eventId}:${gateId}`}
              onDetect={scan}
              blocked={busy || !!pending.current}
              onManualEntry={() => {
                if (manual.current) manual.current.open = true;
                manualInput.current?.focus();
              }}
            />
          </div>
          <details ref={manual} className="scanner-manual">
            <summary>Enter QR code manually</summary>
            <form onSubmit={submit} className="scanner-form" aria-busy={busy}>
              <label htmlFor="scan-token">Entry QR code</label>
              <p id="scan-help">
                Paste the entry QR value if the camera is unavailable. Do not
                enter attendee contact information.
              </p>
              <input
                ref={manualInput}
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
          </details>
        </>
      )}
    </section>
  );
}
