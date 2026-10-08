import { useEffect, useState } from "react";
import { ReviewEntry } from "./ReviewEntry";
import { humanLabel } from "./event-presentation";
import { formatEventTime, serializeEventTime } from "../services/event-time";
import { useEventInformation } from "./useEventInformation";
import { EventInformation } from "./EventInformation";
import {
  reviewRequest,
  reviewMessage,
  type AuditList,
} from "../services/event-review";
const targets = [
  "EVENT",
  "GATE",
  "USER",
  "REGISTRATION",
  "CREDENTIAL",
  "SCAN_DECISION",
  "PRIVATE_ACCESS_LINK",
  "CERTIFICATE",
  "CERTIFICATE_ISSUE_WORK",
  "CERTIFICATE_BATCH",
  "CERTIFICATE_DELIVERY",
  "VOLUNTEER_TASK",
  "UNKNOWN",
];
export function AuditPage({ eventId }: { eventId: string }) {
  return (
    <ReviewEntry title="Activity">
      {(_actor, fail) => <AuditView eventId={eventId} fail={fail} />}
    </ReviewEntry>
  );
}
function AuditView({
  eventId,
  fail,
}: {
  eventId: string;
  fail: (e: unknown) => void;
}) {
  const [data, setData] = useState<AuditList | null>(null),
    [message, setMessage] = useState(""),
    [query, setQuery] = useState(""),
    [attempt, setAttempt] = useState(0);
  const information = useEventInformation(eventId);
  useEffect(() => {
    const c = new AbortController();
    setData(null);
    setMessage("");
    void reviewRequest<AuditList>(
      `/events/${encodeURIComponent(eventId)}/audit-events${query ? `?${query}` : ""}`,
      c.signal,
    )
      .then((r) => {
        if (!c.signal.aborted) setData(r.data);
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
  }, [eventId, query, attempt]);
  return (
    <>
      <a href="/">Back to event workspace</a>
      <EventInformation information={information} />
      <p>
        Review recorded event activity. Each search is recorded for
        accountability.
      </p>
      <form
        className="certificate-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            p = new URLSearchParams();
          try {
            for (const key of [
              "actor",
              "action",
              "outcome",
              "target_type",
              "from",
              "to",
            ]) {
              const value = String(f.get(key) ?? "").trim();
              if (value)
                p.set(
                  key,
                  key === "from" || key === "to"
                    ? serializeEventTime(
                        value,
                        information.detail?.time_zone ?? "",
                      )!
                    : value,
                );
            }
          } catch (error) {
            setMessage((error as Error).message);
            return;
          }
          setQuery(p.toString());
          setAttempt((a) => a + 1);
        }}
      >
        <details className="advanced-details">
          <summary>Advanced details — activity filters</summary>
          <label>
            Actor reference or SYSTEM/GUEST
            <input name="actor" />
          </label>
          <label>
            Action (exact)
            <input name="action" maxLength={80} />
          </label>
          <label>
            Outcome (exact)
            <input name="outcome" maxLength={24} />
          </label>
          <label>
            Target type
            <select name="target_type">
              <option value="">All types</option>
              {targets.map((t) => (
                <option key={t} value={t}>
                  {humanLabel(t)}
                </option>
              ))}
            </select>
          </label>
        </details>
        <label>
          From (event time, inclusive)
          <input name="from" type="datetime-local" />
        </label>
        <label>
          To (event time, exclusive)
          <input name="to" type="datetime-local" />
        </label>
        <button>Search activity</button>
      </form>
      {message && <p role="alert">{message}</p>}
      {!data && !message && <p role="status">Loading activity…</p>}
      {data && (
        <>
          {!data.items.length ? (
            <p>No matching activity.</p>
          ) : (
            <div
              className="review-table"
              tabIndex={0}
              role="region"
              aria-label="Activity records"
            >
              <table>
                <thead>
                  <tr>
                    {[
                      "Time",
                      "Action",
                      "Actor",
                      "Target",
                      "Outcome",
                      "Advanced details",
                    ].map((h) => (
                      <th key={h} scope="col">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Time">
                        {formatEventTime(
                          r.occurred_at,
                          information.detail?.time_zone ?? null,
                        )}
                      </td>
                      <td data-label="Action">{humanLabel(r.action)}</td>
                      <td data-label="Actor">{humanLabel(r.actor.kind)}</td>
                      <td data-label="Target">{humanLabel(r.target_type)}</td>
                      <td data-label="Outcome">{humanLabel(r.outcome)}</td>
                      <td data-label="">
                        <details className="advanced-details">
                          <summary>Advanced details</summary>
                          <p>Actor reference: {r.actor.id ?? "None"}</p>
                          <p>Target reference: {r.target_id ?? "None"}</p>
                          <p>Support reference: {r.correlation_id}</p>
                          <p>Activity reference: {r.id}</p>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.next_cursor && (
            <button
              onClick={() => {
                const p = new URLSearchParams(query);
                p.set("cursor", data.next_cursor!);
                setQuery(p.toString());
              }}
            >
              Next activity
            </button>
          )}
        </>
      )}
    </>
  );
}
