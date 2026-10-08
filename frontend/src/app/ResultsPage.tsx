import { useEffect, useState } from "react";
import { ReviewEntry } from "./ReviewEntry";
import { gateLabel } from "./gate-label";
import { humanLabel } from "./event-presentation";
import { formatEventTime } from "../services/event-time";
import { useEventInformation } from "./useEventInformation";
import { EventInformation } from "./EventInformation";
import {
  reviewRequest,
  reviewMessage,
  type Results,
} from "../services/event-review";
const limitations: Record<string, string> = {
  NO_EXIT_OR_DWELL_DATA: "Exit and dwell-duration data are unavailable.",
  HISTORICAL_OCCUPANCY_NOT_RECORDED:
    "No persisted historical occupancy series is available.",
  NO_REGISTERED_DENOMINATOR:
    "Attendance percentage is unavailable because there are no current registrations.",
  ATTENDANCE_RATE_UNAVAILABLE:
    "Attendance evidence does not support a valid percentage.",
  CERTIFICATE_PROCESSING_INCOMPLETE:
    "Certificate processing is still in progress.",
  DELIVERY_PENDING_OR_UNCERTAIN:
    "Some email submissions are pending or their outcome is uncertain.",
  DELIVERY_STATE_NOT_RECORDED:
    "Some certificates have no recorded delivery state.",
};
export function ResultsPage({ eventId }: { eventId: string }) {
  return (
    <ReviewEntry title="Results">
      {(_actor, fail) => <ResultsView eventId={eventId} fail={fail} />}
    </ReviewEntry>
  );
}
function ResultsView({
  eventId,
  fail,
}: {
  eventId: string;
  fail: (e: unknown) => void;
}) {
  const [data, setData] = useState<Results | null>(null),
    [message, setMessage] = useState(""),
    [attempt, setAttempt] = useState(0);
  const information = useEventInformation(eventId);
  useEffect(() => {
    const c = new AbortController();
    setData(null);
    setMessage("");
    void reviewRequest<{ results: Results }>(
      `/events/${encodeURIComponent(eventId)}/results`,
      c.signal,
    )
      .then((r) => {
        if (!c.signal.aborted) setData(r.data.results);
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setMessage(reviewMessage(e));
          fail(e);
        }
      });
    const clear = () => {
      c.abort();
      setData(null);
    };
    window.addEventListener("pagehide", clear);
    return () => {
      c.abort();
      window.removeEventListener("pagehide", clear);
    };
  }, [eventId, attempt]);
  return (
    <>
      <a href="/">Back to event workspace</a>
      <EventInformation information={information} />
      <button onClick={() => setAttempt((a) => a + 1)}>Refresh results</button>
      {message && <p role="alert">{message}</p>}
      {!data && !message && <p role="status">Loading results…</p>}
      {data && (
        <>
          <p>
            As of{" "}
            {formatEventTime(data.as_of, information.detail?.time_zone ?? null)}
            . Certificate and delivery states may continue to change.
          </p>
          <dl className="review-metrics">
            {Object.entries({
              "Total registrations": data.total_registrations,
              "Cancelled registrations": data.cancelled_registrations,
              "Accepted check-ins": data.accepted_check_ins,
              "Attendance percentage":
                data.attendance_rate_percentage === null
                  ? "Unavailable"
                  : `${data.attendance_rate_percentage}%`,
              "Eligible certificates": data.certificate_eligible_count,
              "Issued certificates": data.certificate_issued_count,
              "Revoked certificates": data.certificate_revoked_count,
            }).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p>
            Registration counts include retained rows; attendance percentage
            uses the current registered population.
          </p>
          <h2>Gate check-ins</h2>
          {data.gate_check_ins.length ? (
            <ul>
              {data.gate_check_ins.map((g) => (
                <li key={g.gate_id}>
                  {gateLabel(
                    information.detail?.gates ?? data.gate_check_ins,
                    g.gate_id,
                  )}
                  : {g.accepted_check_ins}
                </li>
              ))}
            </ul>
          ) : (
            <p>No configured gates.</p>
          )}
          <h2>Certificate email submissions</h2>
          <dl className="review-metrics">
            {Object.entries(data.certificate_delivery_counts).map(
              ([state, count]) => (
                <div key={state}>
                  <dt>{humanLabel(state)}</dt>
                  <dd>{count}</dd>
                </div>
              ),
            )}
          </dl>
          <p>
            SENT means accepted for submission, not confirmed recipient receipt.
            UNKNOWN is held for reconciliation.
          </p>
          <h2>Data limitations</h2>
          <ul>
            {data.data_limitations.map((code) => (
              <li key={code}>{limitations[code] ?? code}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
