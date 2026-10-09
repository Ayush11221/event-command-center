import { CapacityMeter } from "../components/common/CapacityMeter";
import { useEffect, useRef, useState } from "react";
import { EventApiError, type ManagementDetail } from "../services/events";
import { getOperations, type OperationsSnapshot } from "../services/occupancy";
import {
  registrationRequest,
  type Registration,
} from "../services/registrations";
import { ProofError } from "../services/proof";
import { formatEventTime } from "../services/event-time";
import { humanLabel, registrationStatus } from "./event-presentation";

export function EventRegistrations({
  detail,
  refreshToken,
  onSessionExpired,
  onScopeLost,
  onCount,
}: {
  detail: ManagementDetail;
  refreshToken: number;
  onSessionExpired: () => void;
  onScopeLost: () => void;
  onCount?: (snapshot: OperationsSnapshot | null) => void;
}) {
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [countError, setCountError] = useState("");
  const [reference, setReference] = useState("");
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const lookup = useRef<AbortController | null>(null);
  const { event_id: eventId, revision } = detail;
  useEffect(() => {
    const controller = new AbortController();
    setCountError("");
    setSnapshot(null);
    void getOperations(eventId, controller.signal)
      .then((current) => {
        if (!controller.signal.aborted) setSnapshot(current);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof EventApiError && error.status === 401)
          onSessionExpired();
        else if (
          error instanceof EventApiError &&
          [403, 404].includes(error.status)
        )
          onScopeLost();
        else
          setCountError(
            "Available places could not be checked. Retry to get the latest registration count.",
          );
      });
    return () => controller.abort();
  }, [eventId, revision, refreshToken, attempt, onSessionExpired, onScopeLost]);
  useEffect(() => () => lookup.current?.abort(), []);
  const current =
    snapshot?.event_state === detail.state &&
    snapshot.capacity === detail.registration_capacity
      ? snapshot
      : null;
  useEffect(() => {
    onCount?.(current);
  }, [current, onCount]);
  async function read() {
    if (busy) return;
    lookup.current = new AbortController();
    const signal = lookup.current.signal;
    setBusy(true);
    setRegistration(null);
    setMessage("");
    try {
      const result = await registrationRequest<{ registration: Registration }>(
        `/registrations/${encodeURIComponent(reference.trim())}`,
        signal,
      );
      if (signal.aborted) return;
      if (result.registration.event_id !== eventId)
        setMessage("This registration is not part of this event.");
      else setRegistration(result.registration);
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof ProofError && error.status === 401)
        onSessionExpired();
      else
        setMessage(
          error instanceof ProofError && error.status === 404
            ? "This registration is unavailable for this event or your access."
            : "Registration could not be loaded. Check the reference and retry.",
        );
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <section aria-label="Event registrations" className="registrations-panel">
      <h3>Registrations</h3>
      <p role="status" className="registrations-status">
        {registrationStatus(detail, current?.registered)}
      </p>
      <div className="stat-strip">
        <p>
          Registration limit: {detail.registration_capacity ?? "Not configured"}
        </p>
        {current && <p>Registered: {current.registered}</p>}
      </div>
      {current && detail.registration_capacity !== null && (
        <CapacityMeter
          occupied={current.registered}
          capacity={detail.registration_capacity}
        />
      )}
      {current ? (
        <p className="freshness">
          Confirmed {formatEventTime(current.as_of, detail.time_zone)}
        </p>
      ) : countError ? (
        <p role="alert">{countError}</p>
      ) : (
        <p role="status">Checking available places…</p>
      )}
      <button
        type="button"
        className="secondary-button"
        onClick={() => setAttempt((value) => value + 1)}
      >
        Refresh registrations
      </button>
      <p className="field-help">
        Participants register through the event page. The current service
        supports looking up a registration by reference; it does not provide a
        participant directory.
      </p>
      {detail.visibility === "PUBLIC" && detail.state !== "DRAFT" && (
        <a href={`/events/${encodeURIComponent(eventId)}`}>
          Open participant event page
        </a>
      )}
      <details className="advanced-details">
        <summary>Advanced details — registration lookup</summary>
        <form
          className="certificate-form"
          onSubmit={(event) => {
            event.preventDefault();
            void read();
          }}
        >
          <label htmlFor="managed-registration-reference">
            Registration reference
          </label>
          <input
            id="managed-registration-reference"
            value={reference}
            required
            disabled={busy}
            onChange={(event) => {
              setReference(event.target.value);
              setRegistration(null);
            }}
          />
          <button disabled={busy}>
            {busy ? "Loading registration…" : "Find registration"}
          </button>
        </form>
        {message && <p role="alert">{message}</p>}
        {registration && (
          <dl className="event-detail-fields">
            <div>
              <dt>Status</dt>
              <dd>{humanLabel(registration.state)}</dd>
            </div>
            <div>
              <dt>Registered on</dt>
              <dd>
                {formatEventTime(registration.created_at, detail.time_zone)}
              </dd>
            </div>
            <div>
              <dt>Registration reference</dt>
              <dd>{registration.registration_id}</dd>
            </div>
            {registration.cancelled_at && (
              <div>
                <dt>Cancelled on</dt>
                <dd>
                  {formatEventTime(registration.cancelled_at, detail.time_zone)}
                </dd>
              </div>
            )}
          </dl>
        )}
      </details>
    </section>
  );
}
