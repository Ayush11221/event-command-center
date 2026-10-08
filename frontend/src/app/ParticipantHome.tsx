import { useRef, useState } from "react";
import { logout, type ActorState } from "../services/proof";
import { accessMessage } from "./auth-feedback";
export function ParticipantHome({
  actor,
  onSignedOut,
}: {
  actor: ActorState;
  onSignedOut: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  return (
    <main className="page-shell participant-home">
      <p className="eyebrow">YOU'RE SIGNED IN</p>
      <h1>Find your next event</h1>
      <p>
        Your account is ready. Browse events, register, and show your entry QR
        when you arrive.
      </p>
      <a className="participant-link" href="/events">
        Browse events
      </a>
      <h2>Already registered?</h2>
      <p>
        Open your event and choose View my registration to find your entry QR.
        You can also use a saved registration link.
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={async () => {
          if (pending.current) return;
          pending.current = true;
          setBusy(true);
          setError("");
          try {
            await logout(actor.csrf_token);
            onSignedOut();
          } catch (failure) {
            setError(accessMessage(failure));
          } finally {
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </main>
  );
}
