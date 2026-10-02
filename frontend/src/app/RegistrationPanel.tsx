import { useEffect, useRef, useState } from "react";
import { ProofError } from "../services/proof";
import {
  participantSession,
  registrationRequest,
  type Registration,
  type Credential,
} from "../services/registrations";
import { ParticipantProof } from "./ParticipantProof";

const messages: Record<string, string> = {
  CAPACITY_FULL:
    "Registration capacity is full. A cancellation may free a place.",
  DUPLICATE_ACTIVE:
    "You already have an active registration. Refresh to recover it.",
  REGISTRATION_NOT_OPEN: "Registration has not opened yet.",
  REGISTRATION_CLOSED: "This event is not accepting registrations.",
  EVENT_CANCELLED: "This event has been cancelled.",
  CANCELLATION_CUTOFF_REACHED: "The self-cancellation cutoff has passed.",
  ALREADY_CHECKED_IN: "This registration cannot be cancelled after check-in.",
  FRESH_GUEST_PROOF_REQUIRED: "Verify your guest contact again to cancel.",
  CREDENTIAL_REVOKED:
    "This credential is no longer active. Refresh your registration.",
  CREDENTIAL_EXPIRED: "This credential has expired.",
  IDEMPOTENCY_CONFLICT:
    "The retry conflicts with an earlier request. Refresh your registration before trying again.",
};
export function RegistrationPanel({
  eventId,
  registrationId,
  privateProof,
}: {
  eventId?: string;
  registrationId?: string;
  privateProof?: () => string | null;
}) {
  const [opened, setOpened] = useState(Boolean(registrationId)),
    [session, setSession] = useState<Awaited<
      ReturnType<typeof participantSession>
    > | null>(null),
    [row, setRow] = useState<Registration | null>(null),
    [qr, setQr] = useState<Credential | null>(null),
    [phase, setPhase] = useState("idle"),
    [message, setMessage] = useState(""),
    [confirm, setConfirm] = useState(false),
    [fresh, setFresh] = useState(false),
    [attempt, setAttempt] = useState(0);
  const lifecycle = useRef<AbortController | null>(null),
    keys = useRef<{ register?: string; cancel?: string }>({}),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    const clear = () => {
      controller.abort();
      setQr(null);
      setRow(null);
      setSession(null);
      setPhase("lost");
    };
    window.addEventListener("pagehide", clear);
    return () => {
      controller.abort();
      window.removeEventListener("pagehide", clear);
    };
  }, [eventId, registrationId]);
  function failure(error: unknown) {
    setQr(null);
    setConfirm(false);
    if (error instanceof ProofError) {
      if (error.code === "FRESH_GUEST_PROOF_REQUIRED") {
        setFresh(true);
        setPhase("verify");
        setMessage(messages[error.code]);
        return;
      }
      if (error.status === 401) {
        setSession(null);
        setRow(null);
        setPhase("verify");
        setMessage(
          "Your proof expired. Verify again to recover your registration.",
        );
        return;
      }
      if (error.status === 403 || error.status === 404) {
        setSession(null);
        setRow(null);
        setPhase("lost");
        setMessage(
          "Registration access is unavailable. Verify the correct identity or contact the organizer.",
        );
        return;
      }
      setMessage(
        messages[error.code] ??
          "The result is unknown. Retry with the same command or refresh to recover the current state.",
      );
    } else
      setMessage("The result is unknown. Check your connection and retry.");
    setPhase("error");
  }
  const path = () =>
    registrationId
      ? `/registrations/${encodeURIComponent(registrationId)}`
      : `/events/${encodeURIComponent(eventId!)}/registrations`;
  useEffect(() => {
    if (!opened) return;
    const signal = lifecycle.current!.signal;
    let current = true;
    setPhase("loading");
    setQr(null);
    setConfirm(false);
    void participantSession()
      .then(async (actor) => {
        if (!current || signal.aborted) return;
        setSession(actor);
        const result = await registrationRequest<{
          registration: Registration | null;
        }>(path(), signal, undefined, privateProof?.());
        if (current && !signal.aborted) {
          setRow(result.registration);
          setPhase("ready");
          setFresh(false);
          setMessage("");
          heading.current?.focus();
        }
      })
      .catch((error) => {
        if (current && !signal.aborted) failure(error);
      });
    return () => {
      current = false;
    };
  }, [opened, attempt, eventId, registrationId, privateProof]);
  async function command(action: "register" | "cancel") {
    if (!session || !lifecycle.current || lifecycle.current.signal.aborted)
      return;
    const signal = lifecycle.current.signal;
    setPhase("loading");
    setMessage("");
    setQr(null);
    setConfirm(false);
    keys.current[action] ??= crypto.randomUUID();
    try {
      const result = await registrationRequest<{ registration: Registration }>(
        action === "register"
          ? `/events/${encodeURIComponent(eventId!)}/registrations`
          : `/registrations/${row!.registration_id}/cancel`,
        signal,
        { csrf: session.csrf, key: keys.current[action]! },
        privateProof?.(),
      );
      // A replay may describe an older state; always recover the current record.
      const current = await registrationRequest<{ registration: Registration }>(
        `/registrations/${result.registration.registration_id}`,
        signal,
      );
      if (!signal.aborted) {
        setRow(current.registration);
        setPhase("ready");
        setMessage(
          action === "register"
            ? "Registration confirmed."
            : "Registration cancelled. Your credential is invalidated.",
        );
        keys.current = {};
        heading.current?.focus();
      }
    } catch (error) {
      if (!signal.aborted) failure(error);
    }
  }
  async function showCredential() {
    if (!row || !lifecycle.current) return;
    const signal = lifecycle.current.signal;
    setPhase("loading");
    setQr(null);
    setMessage("");
    try {
      const result = await registrationRequest<Credential>(
        `/registrations/${row.registration_id}/credential`,
        signal,
      );
      if (!signal.aborted) {
        setQr(result);
        setPhase("ready");
      }
    } catch (error) {
      if (!signal.aborted) failure(error);
    }
  }
  if (!opened)
    return (
      <button type="button" onClick={() => setOpened(true)}>
        Manage my registration
      </button>
    );
  const busy = phase === "loading";
  return (
    <section
      className="registration-panel"
      aria-labelledby="participant-heading"
      aria-busy={busy}
    >
      <h2 id="participant-heading" ref={heading} tabIndex={-1}>
        My registration
      </h2>
      {phase === "lost" && lifecycle.current?.signal.aborted && (
        <p role="status">
          This display was cleared. Reload the page to verify and recover it
          again.
        </p>
      )}
      {phase === "lost" && lifecycle.current?.signal.aborted && (
        <button type="button" onClick={() => window.location.reload()}>
          Reload registration view
        </button>
      )}
      {busy && <p role="status">Loading registration...</p>}
      {message && (
        <p role={phase === "ready" ? "status" : "alert"}>{message}</p>
      )}
      {phase === "verify" ? (
        <ParticipantProof
          fresh={fresh}
          onVerified={() => setAttempt((value) => value + 1)}
        />
      ) : (
        <>
          {row && (
            <>
              {row.relationship === "managed" && (
                <p>
                  This registration belongs to another participant. Your current
                  staff scope permits metadata access.
                </p>
              )}
              <p>
                Registration: <strong>{row.state}</strong>
              </p>
              <p>Event lifecycle: {row.event_state}</p>
              <a href={`/registrations/${row.registration_id}`}>
                Recover this registration
              </a>
            </>
          )}
          {session && (!row || row.state === "CANCELLED") && eventId && (
            <button disabled={busy} onClick={() => void command("register")}>
              {row ? "Register again" : "Confirm registration"}
            </button>
          )}
          {session &&
            row?.state === "REGISTERED" &&
            row.relationship === "own" && (
              <>
                {row.event_state === "CANCELLED" && (
                  <p>
                    The event is cancelled. This credential does not grant
                    entry.
                  </p>
                )}
                <button disabled={busy} onClick={() => void showCredential()}>
                  View my QR credential
                </button>
                {!confirm ? (
                  <button
                    disabled={busy}
                    className="secondary-button"
                    onClick={() => setConfirm(true)}
                  >
                    Cancel my registration
                  </button>
                ) : (
                  <div className="notice">
                    <p>
                      Cancel this registration and invalidate its QR credential?
                    </p>
                    <button
                      disabled={busy}
                      onClick={() => void command("cancel")}
                    >
                      Confirm cancellation
                    </button>
                    <button
                      disabled={busy}
                      className="secondary-button"
                      onClick={() => setConfirm(false)}
                    >
                      Keep registration
                    </button>
                  </div>
                )}
              </>
            )}
          {qr && (
            <figure>
              <img
                className="participant-qr"
                src={`data:image/svg+xml,${encodeURIComponent(qr.qr_svg)}`}
                alt="Your registration QR credential"
              />
              <figcaption>
                Keep this credential private. It identifies this registration
                only.
              </figcaption>
              <button className="secondary-button" onClick={() => setQr(null)}>
                Hide credential
              </button>
            </figure>
          )}
          <button
            disabled={
              busy || (phase === "lost" && lifecycle.current?.signal.aborted)
            }
            className="secondary-button"
            onClick={() => {
              setRow(null);
              setAttempt((value) => value + 1);
            }}
          >
            Refresh my registration
          </button>
        </>
      )}
    </section>
  );
}
