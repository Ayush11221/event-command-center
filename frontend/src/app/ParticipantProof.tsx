import { useEffect, useRef, useState } from "react";
import {
  currentActor,
  currentGuest,
  logout,
  ProofError,
  type ActorState,
} from "../services/proof";
import { accessMessage } from "./auth-feedback";
import { VerificationForm } from "./VerificationForm";
import { AccountProfileForm } from "./AccountProfileForm";
export function ParticipantProof({
  onVerified,
  fresh = false,
  onBusyChange,
}: {
  onVerified: (mode: "account" | "guest") => void;
  fresh?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [mode, setMode] = useState<"account" | "guest" | null>(
    fresh ? "guest" : null,
  );
  const [account, setAccount] = useState<ActorState | null>(null);
  const [verifiedAccount, setVerifiedAccount] = useState<ActorState | null>(
    null,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [resetVersion, setResetVersion] = useState(0);
  const switching = useRef(false);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  async function requireGuestChoice() {
    try {
      const actor = await currentActor();
      setAccount(actor);
      throw new ProofError("ACCOUNT_SWITCH_REQUIRED", 409);
    } catch (failure) {
      // Expiry or an access-store failure never authorizes switching identities.
      if (
        !(failure instanceof ProofError) ||
        failure.code !== "UNAUTHENTICATED" ||
        failure.status !== 401
      )
        throw failure;
    }
  }
  async function signOut() {
    if (!account || switching.current) return;
    switching.current = true;
    setBusy(true);
    setError("");
    try {
      await logout(account.csrf_token);
      await requireGuestChoice();
      setAccount(null);
      setResetVersion((value) => value + 1);
    } catch (failure) {
      setError(accessMessage(failure));
    } finally {
      switching.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="registration-proof">
      {fresh && (
        <p>
          Verify the same email or phone number again to cancel your
          registration.
        </p>
      )}
      {account ? (
        <div className="notice">
          <h3>You're signed in to an account</h3>
          <p>
            To continue without an account, sign out first. Registrations made
            with your account will stay with that account.
          </p>
          <button type="button" disabled={busy} onClick={() => void signOut()}>
            {busy ? "Signing out…" : "Sign out and continue without an account"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => onVerified("account")}
          >
            Keep using my account
          </button>
          {error && <p role="alert">{error}</p>}
        </div>
      ) : mode === null ? (
        <>
          <h3>How would you like to register?</h3>
          <div className="registration-choices">
            <div>
              <button type="button" onClick={() => setMode("account")}>
                Sign in or create an account
              </button>
              <p>Use an account to manage your registrations.</p>
            </div>
            <div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setMode("guest")}
              >
                Continue without an account
              </button>
              <p>
                Verify your email or phone number without creating an account.
              </p>
            </div>
          </div>
        </>
      ) : null}
      {verifiedAccount && (
        <AccountProfileForm
          actor={verifiedAccount}
          onComplete={() => onVerified("account")}
        />
      )}
      <div
        hidden={account !== null || mode === null || verifiedAccount !== null}
      >
        <h3>
          {mode === "account"
            ? "Sign in or create an account"
            : "Continue without an account"}
        </h3>
        <VerificationForm
          mode={mode ?? "account"}
          resetVersion={resetVersion}
          onBusyChange={setBusy}
          beforeGuestRequest={requireGuestChoice}
          onVerified={async () => {
            if (mode === "guest") {
              await requireGuestChoice();
              await currentGuest();
              onVerified("guest");
            } else setVerifiedAccount(await currentActor());
          }}
        />
        {!fresh && (
          <button
            type="button"
            disabled={busy}
            className="text-button"
            onClick={() => setMode(null)}
          >
            Back to registration options
          </button>
        )}
      </div>
    </div>
  );
}
