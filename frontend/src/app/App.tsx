import { useEffect, useState } from "react";
import { checkHealth } from "../services/health";
import {
  challenge,
  currentActor,
  currentGuest,
  logout,
  ProofError,
  verify,
  type ActorState,
} from "../services/proof";

type HealthState = "loading" | "available" | "unavailable";

export function App() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<HealthState>("loading");
  const [mode, setMode] = useState<"account" | "guest">("account");
  const [channel, setChannel] = useState<"EMAIL" | "PHONE">("EMAIL");
  const [contact, setContact] = useState("");
  const [code, setCode] = useState("");
  const [proofState, setProofState] = useState<
    "idle" | "sending" | "pending" | "verifying" | "verified" | "error"
  >("idle");
  const [codeRequested, setCodeRequested] = useState(false);
  const [actor, setActor] = useState<ActorState | null>(null);
  const [feedback, setFeedback] = useState("");

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

  useEffect(() => {
    let active = true;
    currentActor()
      .then((value) => {
        if (active) {
          setActor(value);
          setProofState("verified");
        }
      })
      .catch((error: unknown) => {
        if (active && !(error instanceof ProofError && error.status === 401))
          setFeedback(
            "Session status is unknown. Check your connection before continuing.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  function describeError(error: unknown) {
    if (!(error instanceof ProofError))
      return "The result is unknown. Please check your connection before retrying.";
    if (error.status === 429)
      return "Too many attempts. Wait before trying again.";
    if (error.status === 401)
      return "The code or session is invalid or expired.";
    if (error.status === 403) return "This action is not permitted.";
    return "The result is unknown. Please check your connection before retrying.";
  }

  async function submitChallenge(event: React.FormEvent) {
    event.preventDefault();
    setProofState("sending");
    setCodeRequested(false);
    setFeedback("");
    try {
      await challenge(mode, channel, contact);
      setCodeRequested(true);
      setProofState("pending");
      setFeedback(
        "If this contact is eligible, a verification code has been sent.",
      );
    } catch (error) {
      setProofState("error");
      setFeedback(describeError(error));
    }
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setProofState("verifying");
    setFeedback("");
    try {
      await verify(mode, channel, contact, code);
      if (mode === "account") setActor(await currentActor());
      else await currentGuest();
      setProofState("verified");
      setCodeRequested(false);
      setCode("");
      setFeedback(
        mode === "account"
          ? "Account session verified."
          : "Guest contact verified for a limited time.",
      );
    } catch (error) {
      setProofState("error");
      setFeedback(describeError(error));
    }
  }

  async function endSession() {
    if (!actor) return;
    try {
      await logout(actor.csrf_token);
      setActor(null);
      setProofState("idle");
      setFeedback("Signed out of this session.");
    } catch (error) {
      if (error instanceof ProofError && error.status === 401) {
        setActor(null);
        setProofState("idle");
      }
      setFeedback(describeError(error));
    }
  }

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

      <section
        className="status-section proof-section"
        aria-labelledby="proof-heading"
      >
        <h2 id="proof-heading">Identity proof</h2>
        <p className="note">
          This Slice 2 foundation verifies a provisioned account or guest
          contact. Event workflows are not available here.
        </p>
        {actor ? (
          <div>
            <p role="status">
              Account session active. Organizer capability:{" "}
              {actor.organizer_capable ? "yes" : "no"}.
            </p>
            <p className="note">
              Current event assignments: {actor.assignments.length}. No event
              management is available on this screen.
            </p>
            <button type="button" onClick={endSession}>
              Sign out of this session
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={submitChallenge}>
              <label htmlFor="proof-mode">Proof type</label>
              <select
                id="proof-mode"
                value={mode}
                onChange={(event) => {
                  setMode(event.target.value as "account" | "guest");
                  setProofState("idle");
                  setCodeRequested(false);
                  setCode("");
                  setFeedback("");
                }}
              >
                <option value="account">Provisioned account</option>
                <option value="guest">Guest contact</option>
              </select>
              <label htmlFor="proof-channel">Contact channel</label>
              <select
                id="proof-channel"
                value={channel}
                onChange={(event) => {
                  setChannel(event.target.value as "EMAIL" | "PHONE");
                  setCodeRequested(false);
                  setCode("");
                  setProofState("idle");
                  setFeedback("");
                }}
              >
                <option value="EMAIL">Email</option>
                <option value="PHONE">Phone</option>
              </select>
              <label htmlFor="proof-contact">
                {channel === "EMAIL" ? "Email address" : "Phone number"}
              </label>
              <input
                id="proof-contact"
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                autoComplete={channel === "EMAIL" ? "email" : "tel"}
                required
              />
              <button
                type="submit"
                disabled={
                  proofState === "sending" || proofState === "verifying"
                }
              >
                Request code
              </button>
            </form>
            {codeRequested && (
              <form onSubmit={submitCode}>
                <label htmlFor="proof-code">Six-digit code</label>
                <input
                  id="proof-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  required
                />
                <button type="submit" disabled={proofState === "verifying"}>
                  Verify code
                </button>
              </form>
            )}
          </>
        )}
        {feedback && (
          <p role="status" aria-live="polite">
            {feedback}
          </p>
        )}
      </section>
    </main>
  );
}
