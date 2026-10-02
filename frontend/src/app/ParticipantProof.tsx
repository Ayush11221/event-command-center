import { useState } from "react";
import { challenge, verify, ProofError } from "../services/proof";
export function ParticipantProof({
  onVerified,
  fresh = false,
}: {
  onVerified: () => void;
  fresh?: boolean;
}) {
  const [mode, setMode] = useState<"account" | "guest">("guest"),
    [channel, setChannel] = useState<"EMAIL" | "PHONE">("EMAIL"),
    [contact, setContact] = useState(""),
    [code, setCode] = useState(""),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="registration-proof"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          if (sent) {
            await verify(fresh ? "guest" : mode, channel, contact, code);
            setCode("");
            onVerified();
          } else {
            await challenge(fresh ? "guest" : mode, channel, contact);
            setSent(true);
          }
        } catch (failure) {
          setError(
            failure instanceof ProofError && failure.status === 429
              ? "Wait before requesting or trying another code."
              : "Verification failed. Check your code and connection, then retry.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        {fresh
          ? "Verify the same guest contact again before cancelling."
          : "Verify your identity to register or recover your registration."}
      </p>
      {!fresh && (
        <label>
          Identity
          <select
            disabled={busy}
            value={mode}
            onChange={(event) => {
              setMode(event.target.value as typeof mode);
              setSent(false);
              setCode("");
            }}
          >
            <option value="guest">Guest OTP</option>
            <option value="account">Existing account</option>
          </select>
        </label>
      )}
      <label>
        Contact channel
        <select
          disabled={busy || sent}
          value={channel}
          onChange={(event) => setChannel(event.target.value as typeof channel)}
        >
          <option value="EMAIL">Email</option>
          <option value="PHONE">Phone</option>
        </select>
      </label>
      <label>
        {channel === "EMAIL" ? "Email address" : "Phone number"}
        <input
          required
          disabled={busy || sent}
          type={channel === "EMAIL" ? "email" : "tel"}
          autoComplete={channel === "EMAIL" ? "email" : "tel"}
          value={contact}
          onChange={(event) => setContact(event.target.value)}
        />
      </label>
      {sent && (
        <>
          <p role="status">If eligible, a code has been sent.</p>
          <label>
            Verification code
            <input
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              disabled={busy}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <button disabled={busy}>
        {busy
          ? "Working..."
          : sent
            ? "Verify identity"
            : "Send verification code"}
      </button>
      {sent && (
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => {
            setSent(false);
            setCode("");
          }}
        >
          Use another contact or resend
        </button>
      )}
    </form>
  );
}
