import { useEffect, useRef, useState } from "react";
import {
  EventApiError,
  getEventDetail,
  issuePrivateLink,
  type ManagementDetail,
  type PrivateIssueResponse,
} from "../services/events";

interface Props {
  detail: ManagementDetail;
  owner: boolean;
  csrf?: string;
  onCurrent: (detail: ManagementDetail) => void;
  onSessionExpired: () => void;
  onScopeLost: () => void;
}
interface Attempt {
  key: string;
  revision: number;
}
export function PrivateLinkPanel({
  detail,
  owner,
  csrf,
  onCurrent,
  onSessionExpired,
  onScopeLost,
}: Props) {
  const [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState<Attempt | null>(null);
  const [result, setResult] = useState<PrivateIssueResponse | null>(null);
  const [reloadRequired, setReloadRequired] = useState(false),
    [feedback, setFeedback] = useState("");
  const controller = useRef<AbortController | null>(null),
    resultHeading = useRef<HTMLHeadingElement>(null);
  const eventId = detail.event_id;
  useEffect(() => {
    const discard = () => {
      controller.current?.abort();
      setResult(null);
      setAttempt(null);
      setReloadRequired(true);
      setBusy(false);
    };
    window.addEventListener("pagehide", discard);
    return () => window.removeEventListener("pagehide", discard);
  }, []);
  const eligible =
    owner &&
    !!csrf &&
    detail.state === "PUBLISHED" &&
    detail.visibility === "PRIVATE";
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!eligible) {
      setResult(null);
      setAttempt(null);
    }
  }, [eligible, eventId]);
  useEffect(() => {
    if (result) resultHeading.current?.focus();
  }, [result]);
  function denied(error: unknown) {
    if (
      error instanceof EventApiError &&
      [401, 403, 404].includes(error.status)
    ) {
      setResult(null);
      setAttempt(null);
      if (error.status === 401) onSessionExpired();
      else {
        setFeedback(
          "Private-link access is no longer authorized. Refresh your event access.",
        );
        onScopeLost();
      }
      return true;
    }
    return false;
  }
  async function send(next: Attempt) {
    if (busy || !eligible) return;
    controller.current = new AbortController();
    const signal = controller.current.signal;
    setBusy(true);
    setFeedback("");
    setResult(null);
    try {
      const issued = await issuePrivateLink(
        eventId,
        next.revision,
        csrf!,
        next.key,
        signal,
      );
      if (signal.aborted) return;
      setResult(issued);
      setAttempt(null);
      setReloadRequired(true);
      onCurrent({ ...detail, revision: issued.revision, as_of: issued.as_of });
      setFeedback(
        "Private link issued. Copy the shareable URL before leaving this result.",
      );
    } catch (error) {
      if (signal.aborted || denied(error)) return;
      if (
        error instanceof EventApiError &&
        [400, 409, 422].includes(error.status)
      ) {
        setAttempt(null);
        setReloadRequired(true);
        setFeedback(
          error.code === "LINK_ALREADY_ACTIVE"
            ? "A private link is already active. Its URL cannot be recovered here."
            : "Issuance was rejected or event data changed. Reload current detail before trying again.",
        );
      } else {
        setAttempt(next);
        setFeedback(
          "The issuance result is unknown. Retry the same request within 24 hours to confirm it safely.",
        );
      }
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  async function reload() {
    if (busy) return;
    controller.current = new AbortController();
    const signal = controller.current.signal;
    setBusy(true);
    setResult(null);
    try {
      const current = await getEventDetail(eventId, signal);
      if (signal.aborted) return;
      onCurrent(current);
      setAttempt(null);
      setReloadRequired(false);
      setFeedback(
        "Current detail loaded. Review PRIVATE Published eligibility before issuing.",
      );
    } catch (error) {
      if (!signal.aborted && !denied(error))
        setFeedback(
          "Current detail could not be loaded. Retry loading detail.",
        );
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  async function copy() {
    if (!result || !eligible) return;
    try {
      await navigator.clipboard.writeText(result.access_url);
      setFeedback("Shareable URL copied.");
    } catch {
      setFeedback("Copy was unavailable. Select and copy the shareable URL.");
    }
  }
  if (!owner) return null;
  return (
    <section className="lifecycle-panel" aria-label="Private controlled link">
      <h3>PRIVATE controlled link</h3>
      <p>
        Share event details by possession of a controlled link. This grants no
        management or registration authority and has no automatic expiry.
      </p>
      {!eligible && <p>Issuance requires an owned PRIVATE Published event.</p>}
      {feedback && (
        <p role="status" className="notice">
          {feedback}
        </p>
      )}
      {busy && <p role="status">Checking private-link request…</p>}
      {result && eligible && (
        <div className="private-link-result">
          <h4 ref={resultHeading} tabIndex={-1}>
            Shareable private URL
          </h4>
          <label htmlFor="private-shareable-url">Shareable URL</label>
          <textarea
            id="private-shareable-url"
            readOnly
            value={result.access_url}
          />
          <p>
            Keep this URL private. After leaving this result it is available
            only through same-request replay for 24 hours.
          </p>
          <div className="lifecycle-actions">
            <button type="button" onClick={() => void copy()}>
              Copy private URL
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setResult(null)}
            >
              Hide private URL
            </button>
          </div>
        </div>
      )}
      {attempt && (
        <button
          type="button"
          disabled={busy || !eligible}
          onClick={() => void send(attempt)}
        >
          Retry same issuance
        </button>
      )}
      {reloadRequired && (
        <button type="button" disabled={busy} onClick={() => void reload()}>
          Load current private-link detail
        </button>
      )}
      {eligible && !attempt && !reloadRequired && !result && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void send({ key: crypto.randomUUID(), revision: detail.revision })
          }
        >
          Issue private link
        </button>
      )}
    </section>
  );
}
