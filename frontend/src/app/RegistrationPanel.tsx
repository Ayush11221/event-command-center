import { IsoBuilding } from "../components/common/Iso";
import { QrCode } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ProofError } from "../services/proof";
import { subscribeAccountSession } from "../services/account-session";
import { getPublicDetail, type PublicEventItem } from "../services/discovery";
import { accessMessage } from "./auth-feedback";
import { publicEventTime } from "./PublicEventInfo";
import {
  participantSession,
  registrationRequest,
  type Registration,
  type Credential,
} from "../services/registrations";
import { ParticipantProof } from "./ParticipantProof";
import { OwnerCertificatePanel } from "./OwnerCertificatePanel";

const messages: Record<string, string> = {
  CAPACITY_FULL:
    "Registration capacity is full. A cancellation may free a place.",
  DUPLICATE_ACTIVE:
    "You already have an active registration. Refresh to recover it.",
  REGISTRATION_NOT_OPEN: "Registration has not opened yet.",
  REGISTRATION_CLOSED: "This event is not accepting registrations.",
  EVENT_CANCELLED: "This event has been cancelled.",
  CANCELLATION_CUTOFF_REACHED:
    "Cancellation is no longer available for this event.",
  ALREADY_CHECKED_IN:
    "Your registration can no longer be cancelled after check-in.",
  FRESH_GUEST_PROOF_REQUIRED:
    "Verify the same email or phone number again to cancel your registration.",
  CREDENTIAL_REVOKED:
    "This entry QR is no longer active. Refresh your registration.",
  CREDENTIAL_EXPIRED:
    "This entry QR has expired. Contact the organizer for help.",
  IDEMPOTENCY_CONFLICT:
    "The retry conflicts with an earlier request. Refresh your registration before trying again.",
};
export function RegistrationPanel({
  eventId,
  registrationId,
  privateProof,
  event,
}: {
  eventId?: string;
  registrationId?: string;
  privateProof?: () => string | null;
  event?: PublicEventItem;
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
  const [cancellationBlocked, setCancellationBlocked] = useState("");
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [recoveredEvent, setRecoveredEvent] = useState<PublicEventItem | null>(
    null,
  );
  const details = event ?? recoveredEvent;
  const inFlight = useRef(false),
    accessVersion = useRef(0);
  const expectedCsrf = useRef<string | null>(null);
  const expectedMode = useRef<"account" | "guest" | null>(null);
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
  useEffect(
    () =>
      subscribeAccountSession((change) => {
        if (change !== "expired" && change !== "signed-out") return;
        accessVersion.current += 1;
        setQr(null);
        setRow(null);
        setSession(null);
        setConfirm(false);
        setFresh(false);
        keys.current = {};
        setPhase("verify");
        setMessage(
          change === "expired"
            ? "Your session has expired. Sign in again to continue."
            : "You're signed out. Choose how to continue.",
        );
      }),
    [],
  );
  useEffect(() => {
    if (event || !row) return;
    const controller = new AbortController();
    void getPublicDetail(row.event_id, controller.signal)
      .then((detail) => {
        if (!controller.signal.aborted) setRecoveredEvent(detail);
      })
      .catch(() => {
        /* Registration recovery does not require public event visibility. */
      });
    return () => controller.abort();
  }, [event, row?.event_id]);
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
        keys.current = {};
        setMessage(accessMessage(error, session !== null));
        return;
      }
      if (error.code === "IDENTITY_CHANGED") {
        setSession(null);
        setRow(null);
        keys.current = {};
        setPhase("verify");
        setMessage(
          "Your sign-in has changed. Choose how to continue before viewing or changing a registration.",
        );
        return;
      }
      if (error.status === 403 || error.status === 404) {
        setSession(null);
        setRow(null);
        setPhase("lost");
        keys.current = {};
        setMessage(
          error.status === 403
            ? "You don't have permission to view or change this registration. You can use a different identity."
            : "Registration unavailable. Verify the email or phone number you used to register, or contact the organizer.",
        );
        return;
      }
      if (
        error.code === "CANCELLATION_CUTOFF_REACHED" ||
        error.code === "ALREADY_CHECKED_IN"
      )
        setCancellationBlocked(messages[error.code]);
      if (error.code === "DUPLICATE_ACTIVE") {
        setMessage("You already registered. Loading your registration…");
        setAttempt((value) => value + 1);
        return;
      }
      setMessage(
        messages[error.code] ??
          (error.status === 503
            ? "We couldn't verify your access right now. Please try again."
            : "We couldn't confirm the result. Retry your action or refresh your registration to check what happened."),
      );
    } else
      setMessage(
        "We couldn't confirm the result. Check your connection and try again.",
      );
    setPhase("error");
  }
  const path = () =>
    registrationId
      ? `/registrations/${encodeURIComponent(registrationId)}`
      : `/events/${encodeURIComponent(eventId!)}/registrations`;
  useEffect(() => {
    const signal = lifecycle.current!.signal;
    const version = accessVersion.current;
    let current = true;
    setPhase("loading");
    setQr(null);
    setConfirm(false);
    void participantSession()
      .then(async (actor) => {
        if (!current || signal.aborted || version !== accessVersion.current)
          return;
        if (expectedCsrf.current && actor.csrf !== expectedCsrf.current)
          throw new ProofError("IDENTITY_CHANGED", 409);
        const mode = actor.guest ? "guest" : "account";
        if (expectedMode.current && expectedMode.current !== mode)
          throw new ProofError("IDENTITY_CHANGED", 409);
        expectedMode.current = mode;
        expectedCsrf.current = actor.csrf;
        setSession(actor);
        const result = await registrationRequest<{
          registration: Registration | null;
        }>(path(), signal, undefined, privateProof?.());
        if (current && !signal.aborted && version === accessVersion.current) {
          setRow(result.registration);
          setPhase("ready");
          setFresh(false);
          setMessage("");
          heading.current?.focus();
        }
      })
      .catch((error) => {
        if (current && !signal.aborted && version === accessVersion.current)
          failure(error);
      });
    return () => {
      current = false;
    };
  }, [attempt, eventId, registrationId, privateProof]);
  async function command(action: "register" | "cancel") {
    if (
      !session ||
      !lifecycle.current ||
      lifecycle.current.signal.aborted ||
      inFlight.current
    )
      return;
    inFlight.current = true;
    const version = accessVersion.current;
    const signal = lifecycle.current.signal;
    setPhase(action === "register" ? "registering" : "cancelling");
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
      if (signal.aborted || version !== accessVersion.current) return;
      const current = await registrationRequest<{ registration: Registration }>(
        `/registrations/${result.registration.registration_id}`,
        signal,
      );
      if (!signal.aborted && version === accessVersion.current) {
        setRow(current.registration);
        setPhase("ready");
        setMessage(
          current.registration.state === "CANCELLED"
            ? "Registration cancelled. Your entry QR no longer works."
            : action === "register"
              ? "Registration successful."
              : "Your registration is up to date.",
        );
        keys.current = {};
        heading.current?.focus();
      }
    } catch (error) {
      if (!signal.aborted && version === accessVersion.current) failure(error);
    } finally {
      inFlight.current = false;
    }
  }
  async function showCredential() {
    if (
      !row ||
      !lifecycle.current ||
      lifecycle.current.signal.aborted ||
      inFlight.current
    )
      return;
    inFlight.current = true;
    const version = accessVersion.current;
    const signal = lifecycle.current.signal;
    setPhase("qr");
    setQr(null);
    setMessage("");
    try {
      const result = await registrationRequest<Credential>(
        `/registrations/${row.registration_id}/credential`,
        signal,
      );
      if (!signal.aborted && version === accessVersion.current) {
        setQr(result);
        setPhase("ready");
      }
    } catch (error) {
      if (!signal.aborted && version === accessVersion.current) failure(error);
    } finally {
      inFlight.current = false;
    }
  }
  if (!opened)
    return (
      <button type="button" onClick={() => setOpened(true)}>
        {row?.state === "REGISTERED" && row.relationship === "own"
          ? "View my registration"
          : details?.availability.policy_status === "CLOSED"
            ? "View registration"
            : "Register"}
      </button>
    );
  const registrationBusy = [
    "loading",
    "registering",
    "cancelling",
    "qr",
  ].includes(phase);
  const busy = registrationBusy || verificationBusy;
  return (
    <section
      className="registration-panel"
      aria-labelledby="participant-heading"
      aria-busy={busy}
    >
      <h2 id="participant-heading" ref={heading} tabIndex={-1}>
        Your registration
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
      {registrationBusy && (
        <p role="status">
          {phase === "registering"
            ? "Registering…"
            : phase === "cancelling"
              ? "Cancelling registration…"
              : phase === "qr"
                ? "Loading entry QR…"
                : "Loading registration…"}
        </p>
      )}
      {message && (
        <p role={phase === "ready" ? "status" : "alert"}>{message}</p>
      )}
      {phase === "verify" ? (
        <ParticipantProof
          fresh={fresh}
          onBusyChange={setVerificationBusy}
          onVerified={(mode) => {
            expectedMode.current = mode;
            expectedCsrf.current = null;
            keys.current = {};
            setAttempt((value) => value + 1);
          }}
        />
      ) : (
        <>
          {row && (
            <>
              {details ? (
                <div className="registration-event">
                  <h3>{details.name}</h3>
                  <p>
                    {publicEventTime(details.start_at, details.time_zone)} –{" "}
                    {publicEventTime(details.end_at, details.time_zone)}
                    {details.time_zone && ` · ${details.time_zone}`}
                  </p>
                </div>
              ) : (
                <p>
                  Open your event's original link for its name and schedule.
                </p>
              )}
              {row.relationship === "managed" && (
                <p>
                  This registration belongs to another participant. Your current
                  staff scope permits metadata access.
                </p>
              )}
              <p>
                Registration status:{" "}
                <strong
                  className={`reg-chip ${row.state === "CANCELLED" ? "is-cancelled" : "is-registered"}`}
                >
                  {row.state === "CANCELLED" ? "Cancelled" : "Registered"}
                </strong>
              </p>
              {row.state === "CANCELLED" && (
                <p>
                  Registration cancelled. The previous entry QR no longer works.
                </p>
              )}
              {session?.guest && row.relationship === "own" && (
                <p>
                  To return, save the View registration link or open this event
                  again. Verify the same email or phone number to view your
                  registration and entry QR. No account is needed.
                </p>
              )}
            </>
          )}
          {session && !row && (
            <p>
              {session.guest
                ? "Your contact is verified. You can register without an account."
                : "You're registering with your signed-in account."}
            </p>
          )}
          {session &&
            (!row ||
              (row.state === "CANCELLED" && row.relationship === "own")) &&
            eventId && (
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
                    The event is cancelled. This entry QR does not grant entry.
                  </p>
                )}
                <p>
                  Your entry QR is available below. Show it when you arrive.
                </p>
                <button disabled={busy} onClick={() => void showCredential()}>
                  <QrCode aria-hidden="true" className="size-4" />
                  Show entry QR
                </button>
                {cancellationBlocked ? (
                  <p>{cancellationBlocked}</p>
                ) : !confirm ? (
                  <button
                    disabled={busy}
                    className="secondary-button"
                    onClick={() => setConfirm(true)}
                  >
                    Cancel registration
                  </button>
                ) : (
                  <div className="notice confirm-panel is-danger">
                    <p>
                      Cancel your registration? Your entry QR will stop working
                      and your place will be released.
                    </p>
                    <button
                      disabled={busy}
                      className="danger-button"
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
            <figure
              className="entry-pass"
              data-event={details?.name ?? ""}
              onPointerMove={(event) => {
                if (event.pointerType === "touch") return;
                const box = event.currentTarget.getBoundingClientRect();
                const x = (event.clientX - box.left) / box.width - 0.5;
                const y = (event.clientY - box.top) / box.height - 0.5;
                event.currentTarget.style.setProperty("--ry", `${x * 14}deg`);
                event.currentTarget.style.setProperty("--rx", `${-y * 12}deg`);
                event.currentTarget.style.setProperty(
                  "--sx",
                  `${(x + 0.5) * 100}%`,
                );
              }}
              onPointerLeave={(event) => {
                event.currentTarget.style.setProperty("--ry", "0deg");
                event.currentTarget.style.setProperty("--rx", "0deg");
              }}
            >
              <IsoBuilding className="pass-art" />
              <span className="pass-sheen" aria-hidden="true" />
              <img
                className="participant-qr"
                src={`data:image/svg+xml,${encodeURIComponent(qr.qr_svg)}`}
                alt="Your entry QR"
              />
              <figcaption>
                Show this QR at the event entrance. Keep it private.
              </figcaption>
              <button className="secondary-button" onClick={() => setQr(null)}>
                Hide entry QR
              </button>
            </figure>
          )}
          {row && (
            <a href={`/registrations/${row.registration_id}`}>
              View registration
            </a>
          )}
          {row?.relationship === "own" && session && (
            <OwnerCertificatePanel
              registrationId={row.registration_id}
              registrationState={row.state}
              csrf={session.csrf}
              onOwnershipLost={failure}
            />
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
            Refresh registration
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy || lifecycle.current?.signal.aborted}
            onClick={() => {
              accessVersion.current += 1;
              setQr(null);
              setRow(null);
              setSession(null);
              setConfirm(false);
              setFresh(false);
              setMessage("");
              setPhase("verify");
              keys.current = {};
              setCancellationBlocked("");
            }}
          >
            Use a different identity
          </button>
        </>
      )}
      {eventId ? (
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            setOpened(false);
            setQr(null);
          }}
        >
          Back to event
        </button>
      ) : (
        <a
          className="participant-link"
          href={details ? `/events/${details.event_id}` : "/events"}
        >
          {details ? "Back to event" : "Browse events"}
        </a>
      )}
    </section>
  );
}
