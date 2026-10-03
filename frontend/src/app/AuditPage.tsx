import { useEffect, useState } from "react";
import { ReviewEntry } from "./ReviewEntry";
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
    <ReviewEntry title="Event audit evidence">
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
      <p>
        Restricted event evidence. Each search is audited. Records omit secrets
        and free-text metadata.
      </p>
      <form
        className="certificate-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            p = new URLSearchParams();
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
                  ? new Date(value).toISOString()
                  : value,
              );
          }
          setQuery(p.toString());
          setAttempt((a) => a + 1);
        }}
      >
        <label>
          Actor account ID or SYSTEM/GUEST
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
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          From (local time, inclusive)
          <input name="from" type="datetime-local" />
        </label>
        <label>
          To (local time, exclusive)
          <input name="to" type="datetime-local" />
        </label>
        <button>Search audit</button>
      </form>
      {message && <p role="alert">{message}</p>}
      {!data && !message && <p role="status">Loading audit evidence…</p>}
      {data && (
        <>
          {!data.items.length ? (
            <p>No matching audit records.</p>
          ) : (
            <div
              className="review-table"
              tabIndex={0}
              role="region"
              aria-label="Audit records"
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
                      "Correlation",
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
                      <td>{new Date(r.occurred_at).toLocaleString()}</td>
                      <td>{r.action}</td>
                      <td>
                        {r.actor.kind} {r.actor.id ?? ""}
                      </td>
                      <td>
                        {r.target_type} {r.target_id ?? ""}
                      </td>
                      <td>{r.outcome}</td>
                      <td>{r.correlation_id}</td>
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
              Next audit records
            </button>
          )}
        </>
      )}
    </>
  );
}
