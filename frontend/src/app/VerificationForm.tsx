import { useEffect, useId, useRef, useState } from "react";
import { challenge, ProofError, verify } from "../services/proof";
import { verificationMessage } from "./auth-feedback";
type Mode = "account" | "guest";
type Channel = "EMAIL" | "PHONE";
function maskedContact(contact: string, channel: Channel) {
  if (channel === "PHONE") return `•••• ${contact.slice(-4)}`;
  const [name, domain] = contact.split("@");
  return `${name.slice(0, 1)}••••@${domain}`;
}
export function VerificationForm({
  mode,
  onVerified,
  beforeGuestRequest,
  onBusyChange,
  resetVersion = 0,
}: {
  mode: Mode;
  onVerified: () => void | Promise<void>;
  beforeGuestRequest?: () => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  resetVersion?: number;
}) {
  const id = useId();
  const [channel, setChannel] = useState<Channel>("EMAIL");
  const [contact, setContact] = useState(""),
    [code, setCode] = useState("");
  const [stage, setStage] = useState<"contact" | "code" | "verified">(
    "contact",
  );
  const [pending, setPending] = useState<"send" | "verify" | "continue" | null>(
    null,
  );
  const [error, setError] = useState(""),
    [locked, setLocked] = useState(false);
  const [now, setNow] = useState(Date.now),
    [expiresAt, setExpiresAt] = useState(0);
  // Cooldowns survive back/change-contact actions in memory only.
  const deadlines = useRef(new Map<string, number>());
  const inFlight = useRef(false),
    mounted = useRef(true);
  const codeInput = useRef<HTMLInputElement>(null),
    contactInput = useRef<HTMLInputElement>(null);
  const previousStage = useRef(stage);
  const key = `${channel}:${contact.trim().toLowerCase()}`;
  const resendIn = Math.max(
    0,
    Math.ceil(((deadlines.current.get(key) ?? 0) - now) / 1000),
  );
  const expiresIn = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const expired = stage === "code" && expiresIn === 0;
  const busy = pending !== null;
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    mounted.current = true;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const clearCode = () => setCode("");
    window.addEventListener("pagehide", clearCode);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      window.removeEventListener("pagehide", clearCode);
    };
  }, []);
  useEffect(() => {
    setStage("contact");
    setChannel("EMAIL");
    setCode("");
    setError("");
    setLocked(false);
  }, [mode, resetVersion]);
  useEffect(() => {
    if (stage === "code" && !busy && !expired && !locked)
      codeInput.current?.focus();
    if (stage === "contact" && stage !== previousStage.current)
      contactInput.current?.focus();
    previousStage.current = stage;
  }, [stage, busy, expired, locked]);
  async function send() {
    if (inFlight.current || resendIn > 0) return;
    inFlight.current = true;
    setPending("send");
    setError("");
    const startedAt = Date.now();
    try {
      if (mode === "guest") await beforeGuestRequest?.();
      await challenge(mode, channel, contact.trim());
      if (!mounted.current) return;
      deadlines.current.set(key, startedAt + 60_000);
      setNow(Date.now());
      setExpiresAt(startedAt + 300_000);
      setCode("");
      setLocked(false);
      setStage("code");
      codeInput.current?.focus();
    } catch (failure) {
      if (!mounted.current) return;
      if (failure instanceof ProofError && failure.status === 429) {
        deadlines.current.set(key, Date.now() + 60_000);
        setNow(Date.now());
      }
      setError(verificationMessage(failure, true));
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(null);
    }
  }
  async function complete() {
    try {
      await onVerified();
    } catch {
      if (mounted.current)
        setError(
          "Your contact is verified. We couldn't continue right now. Select Continue to try again.",
        );
    }
  }
  async function submitCode() {
    if (inFlight.current || expired || locked || !/^\d{6}$/.test(code)) return;
    inFlight.current = true;
    setPending("verify");
    setError("");
    try {
      if (mode === "guest") await beforeGuestRequest?.();
      await verify(mode, channel, contact.trim(), code);
      if (!mounted.current) return;
      setCode("");
      setStage("verified");
      await complete();
    } catch (failure) {
      if (!mounted.current) return;
      setCode("");
      setLocked(failure instanceof ProofError && failure.status === 429);
      setError(verificationMessage(failure, false));
      codeInput.current?.focus();
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(null);
    }
  }
  return (
    <div className="verification-flow" aria-busy={busy}>
      {stage === "contact" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {mode === "guest" && (
            <label htmlFor={`${id}-channel`}>
              Receive your code by
              <select
                id={`${id}-channel`}
                value={channel}
                disabled={busy}
                onChange={(event) => {
                  setChannel(event.target.value as Channel);
                  setContact("");
                  setError("");
                }}
              >
                <option value="EMAIL">Email</option>
                <option value="PHONE">Phone</option>
              </select>
            </label>
          )}
          <label htmlFor={`${id}-contact`}>
            {channel === "EMAIL" ? "Email address" : "Phone number"}
          </label>
          <input
            id={`${id}-contact`}
            ref={contactInput}
            type={channel === "EMAIL" ? "email" : "tel"}
            inputMode={channel === "EMAIL" ? "email" : "tel"}
            autoComplete={channel === "EMAIL" ? "email" : "tel"}
            value={contact}
            required
            disabled={busy}
            aria-describedby={error ? `${id}-error` : undefined}
            aria-invalid={Boolean(error)}
            onChange={(event) => {
              setContact(event.target.value);
              setError("");
            }}
          />
          <button type="submit" disabled={busy || resendIn > 0}>
            {pending === "send"
              ? "Sending code…"
              : resendIn > 0
                ? `Send code in ${resendIn}s`
                : "Continue"}
          </button>
        </form>
      ) : stage === "code" ? (
        <>
          <h3>
            {channel === "EMAIL" ? "Check your email" : "Check your messages"}
          </h3>
          <p id={`${id}-help`} role="status">
            Enter the 6-digit verification code for{" "}
            <strong>{maskedContact(contact.trim(), channel)}</strong>.
          </p>
          <p className="field-help">
            The code may take a moment to arrive. Check your spam folder if
            you're using email.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitCode();
            }}
          >
            <label htmlFor={`${id}-code`}>Verification code</label>
            <input
              id={`${id}-code`}
              ref={codeInput}
              className="verification-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              required
              disabled={busy || expired || locked}
              aria-invalid={Boolean(error)}
              aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              onPaste={(event) => {
                event.preventDefault();
                setCode(
                  event.clipboardData
                    .getData("text")
                    .replace(/\D/g, "")
                    .slice(0, 6),
                );
              }}
            />
            <p
              className="verification-timer"
              role={expired ? "status" : undefined}
            >
              {expired
                ? "This code has expired. Request a new code."
                : `Code expires in ${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, "0")}`}
            </p>
            <button
              type="submit"
              disabled={busy || expired || locked || code.length !== 6}
            >
              {pending === "verify" ? "Verifying…" : "Verify and continue"}
            </button>
          </form>
          <div className="verification-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy || resendIn > 0}
              onClick={() => void send()}
            >
              {pending === "send"
                ? "Sending code…"
                : resendIn > 0
                  ? `Resend code in ${resendIn}s`
                  : "Resend code"}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                setStage("contact");
                setCode("");
                setError("");
                setLocked(false);
              }}
            >
              {channel === "EMAIL" ? "Change email" : "Change phone number"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p role="status">Verification successful. You can continue.</p>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (inFlight.current) return;
              inFlight.current = true;
              setPending("continue");
              setError("");
              await complete();
              inFlight.current = false;
              if (mounted.current) setPending(null);
            }}
          >
            {pending ? "Continuing…" : "Continue"}
          </button>
        </>
      )}
      {error && (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
      {pending && (
        <p className="visually-hidden" role="status">
          {pending === "send"
            ? "Sending verification code"
            : pending === "verify"
              ? "Verifying code"
              : "Continuing"}
        </p>
      )}
    </div>
  );
}
