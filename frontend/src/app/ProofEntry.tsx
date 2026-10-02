import { useState } from "react";
import {
  challenge,
  currentActor,
  currentGuest,
  ProofError,
  verify,
  type ActorState,
} from "../services/proof";

interface Props {
  onAccountAuthenticated: (actor: ActorState) => void;
}

export function ProofEntry({ onAccountAuthenticated }: Props) {
  const [mode, setMode] = useState<"account" | "guest">("account");
  const [channel, setChannel] = useState<"EMAIL" | "PHONE">("EMAIL");
  const [contact, setContact] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<
    "idle" | "sending" | "code" | "verifying"
  >("idle");
  const [feedback, setFeedback] = useState("");

  function describeError(error: unknown) {
    if (!(error instanceof ProofError))
      return "The result is unknown. Check the connection before retrying.";
    if (error.status === 429)
      return "Too many attempts. Wait before trying again.";
    if (error.status === 401)
      return "The code or session is invalid or expired.";
    if (error.status === 403) return "This action is not permitted.";
    return "The result is unknown. Check the connection before retrying.";
  }

  async function submitChallenge(event: React.FormEvent) {
    event.preventDefault();
    setPending("sending");
    setFeedback("");
    try {
      await challenge(mode, channel, contact);
      setPending("code");
      setFeedback(
        "If this contact is eligible, a verification code has been sent.",
      );
    } catch (error) {
      setPending("idle");
      setFeedback(describeError(error));
    }
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    setPending("verifying");
    setFeedback("");
    try {
      await verify(mode, channel, contact, code);
      if (mode === "account") onAccountAuthenticated(await currentActor());
      else {
        await currentGuest();
        setFeedback("Guest contact verified for a limited time.");
      }
      setCode("");
      setPending("idle");
    } catch (error) {
      setPending("code");
      setFeedback(describeError(error));
    }
  }

  return (
    <main className="page-shell entry-layout">
      <div className="entry-intro">
        <p className="eyebrow">ACCOUNT ACCESS</p>
        <h1>Sign in to your event workspace</h1>
        <p>
          Verify your provisioned account to manage the events you own. Guest
          contact proof remains separate from event management.
        </p>
      </div>
      <section className="entry-panel" aria-labelledby="proof-heading">
        <h2 id="proof-heading">Identity proof</h2>
        <form onSubmit={submitChallenge}>
          <label htmlFor="proof-mode">Proof type</label>
          <select
            id="proof-mode"
            value={mode}
            onChange={(event) => {
              setMode(event.target.value as "account" | "guest");
              setPending("idle");
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
              setPending("idle");
              setCode("");
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
            disabled={pending === "sending" || pending === "verifying"}
          >
            {pending === "sending" ? "Requesting…" : "Request code"}
          </button>
        </form>
        {(pending === "code" || pending === "verifying") && (
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
            <button type="submit" disabled={pending === "verifying"}>
              {pending === "verifying" ? "Verifying…" : "Verify code"}
            </button>
          </form>
        )}
        {feedback && (
          <p className="form-feedback" role="status" aria-live="polite">
            {feedback}
          </p>
        )}
      </section>
    </main>
  );
}
