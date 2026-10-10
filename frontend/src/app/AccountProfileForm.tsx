import { useEffect, useRef, useState, type FormEvent } from "react";
import { currentActor, type ActorState } from "../services/proof";
import { ProofError } from "../services/proof";
import { accountProfile, saveAccountProfile } from "../services/profile";
import { accessMessage } from "./auth-feedback";

export function AccountProfileForm({
  actor,
  onComplete,
}: {
  actor: ActorState;
  onComplete: (actor: ActorState) => void;
}) {
  const [name, setName] = useState(actor.display_name ?? "");
  const [email, setEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [organization, setOrganization] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (loaded) nameInput.current?.focus();
  }, [loaded]);
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setLoaded(false);
    setError("");
    void accountProfile(abort.signal)
      .then((profile) => {
        if (abort.signal.aborted) return;
        setName(profile.display_name ?? "");
        setEmail(profile.verified_email);
        setLoading(false);
        setPhone(profile.phone_number ?? "");
        setOrganization(profile.organization ?? "");
        setAffiliation(profile.affiliation_id ?? "");
        setLoaded(true);
      })
      .catch((failure) => {
        if (!abort.signal.aborted) {
          setError(accessMessage(failure));
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [actor.user_id, attempt]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !loaded ||
      loading ||
      submitting.current ||
      !name.trim() ||
      !phone.trim() ||
      !organization.trim() ||
      !controller.current
    )
      return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const signal = controller.current.signal;
    try {
      await saveAccountProfile(
        {
          display_name: name.trim(),
          phone_number: phone.trim(),
          organization: organization.trim(),
          affiliation_id: affiliation.trim() || null,
        },
        actor.csrf_token,
        signal,
      );
      const refreshed = await currentActor();
      if (!signal.aborted && refreshed.user_id === actor.user_id)
        onComplete(refreshed);
      else if (!signal.aborted)
        setError("Your sign-in changed. Sign in again to continue.");
    } catch (failure) {
      if (!signal.aborted)
        setError(
          failure instanceof ProofError && failure.status === 400
            ? "Check your name, contact number, and organization. Use 7–15 digits for the contact number."
            : accessMessage(failure),
        );
    } finally {
      submitting.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <section
      className="entry-panel verification-flow"
      aria-labelledby="profile-heading"
    >
      <h2 id="profile-heading">Your details</h2>
      <p>Confirm your details to continue.</p>
      {loading ? (
        <p role="status">Loading your details…</p>
      ) : (
        loaded && (
          <form onSubmit={submit} aria-busy={busy}>
            {email && (
              <label>
                Verified email
                <input
                  type="email"
                  value={email}
                  readOnly
                  autoComplete="email"
                />
              </label>
            )}
            <label>
              Full name
              <input
                ref={nameInput}
                name="display_name"
                autoComplete="name"
                maxLength={100}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              Contact number
              <input
                type="tel"
                name="phone_number"
                autoComplete="tel"
                maxLength={25}
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              College or organization
              <input
                name="organization"
                autoComplete="organization"
                placeholder="Independent, if not applicable"
                maxLength={120}
                required
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              Student or employee ID (optional)
              <input
                name="affiliation_id"
                maxLength={64}
                value={affiliation}
                onChange={(e) => setAffiliation(e.target.value)}
                disabled={busy}
              />
            </label>
            <p className="field-help">
              Used for later identification. Contact number and affiliation are
              self-reported.
            </p>
            <button
              type="submit"
              disabled={
                busy || !name.trim() || !phone.trim() || !organization.trim()
              }
            >
              {busy ? "Saving…" : "Save and continue"}
            </button>
          </form>
        )
      )}
      {error && (
        <>
          <p role="alert">{error}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => setAttempt((v) => v + 1)}
          >
            Reload your details
          </button>
        </>
      )}
    </section>
  );
}
