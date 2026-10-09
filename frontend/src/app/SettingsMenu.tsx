import { useEffect, useId, useRef, useState } from "react";
import { LogOut, Settings } from "lucide-react";
import { currentActor, logout, ProofError } from "../services/proof";
import { accountSignedOut } from "../services/account-session";
import { ThemeControl } from "./ThemeControl";
import { accessMessage } from "./auth-feedback";

type Account = "checking" | "signed-in" | "signed-out";

/**
 * Header settings: appearance for everyone, and Sign out when an account
 * session exists. Sign out always uses the CSRF token from a fresh session
 * read, so it stays correct after renewal or re-authentication.
 */
export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<Account>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    let active = true;
    setError("");
    setAccount("checking");
    Promise.resolve()
      .then(() => currentActor())
      .then((actor) => {
        if (active) setAccount(actor ? "signed-in" : "signed-out");
      })
      .catch(() => {
        if (active) setAccount("signed-out");
      });
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !panel.current?.contains(target) &&
        !trigger.current?.contains(target)
      )
        setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      active = false;
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      const actor = await currentActor();
      await logout(actor.csrf_token);
      setOpen(false);
      if (window.location.pathname !== "/") window.location.assign("/");
    } catch (failure) {
      if (failure instanceof ProofError && failure.status === 401) {
        // Already signed out server-side; reflect that everywhere.
        accountSignedOut();
        setOpen(false);
        if (window.location.pathname !== "/") window.location.assign("/");
      } else setError(accessMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-menu">
      <button
        ref={trigger}
        type="button"
        className="settings-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <Settings aria-hidden="true" className="size-4" />
        <span>Settings</span>
      </button>
      {open && (
        <div
          ref={panel}
          id={panelId}
          className="settings-panel"
          role="group"
          aria-label="Settings"
        >
          <p className="settings-label" id={`${panelId}-appearance`}>
            Appearance
          </p>
          <ThemeControl />
          {account === "signed-in" && (
            <>
              <hr />
              <button
                type="button"
                className="settings-signout"
                disabled={busy}
                onClick={() => void signOut()}
              >
                <LogOut aria-hidden="true" className="size-4" />
                {busy ? "Signing out…" : "Sign out"}
              </button>
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
