import { useEffect, useRef, useState } from "react";
import { subscribeAccountSession } from "../services/account-session";
import {
  EventApiError,
  getEventDetail,
  issuePrivateLink,
  reissuePrivateLink,
  revokePrivateLink,
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
  action: "ISSUE" | "REISSUE" | "REVOKE";
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
  const [confirmation, setConfirmation] = useState<Attempt | null>(null);
  const [linkState, setLinkState] = useState<"ACTIVE" | "REVOKED" | null>(null);
  const [reloadRequired, setReloadRequired] = useState(false),
    [feedback, setFeedback] = useState("");
  const controller = useRef<AbortController | null>(null),
    resultHeading = useRef<HTMLHeadingElement>(null);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const reloadButton = useRef<HTMLButtonElement>(null);
  const eventId = detail.event_id;
  useEffect(() => {
    const discard = () => {
      controller.current?.abort();
      setResult(null);
      setConfirmation(null);
      setLinkState(null);
      setAttempt(null);
      setReloadRequired(true);
      setBusy(false);
    };
    window.addEventListener("pagehide", discard);
    const unsubscribe = subscribeAccountSession((event) => {
      if (event === "expired" || event === "signed-out") discard();
    });
    return () => {
      window.removeEventListener("pagehide", discard);
      unsubscribe();
    };
  }, []);
  const eligible =
    owner &&
    !!csrf &&
    detail.state === "PUBLISHED" &&
    detail.visibility === "PRIVATE";
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!eligible) {
      controller.current?.abort();
      setResult(null);
      setAttempt(null);
      setConfirmation(null);
      setLinkState(null);
      setBusy(false);
    }
  }, [eligible, eventId]);
  useEffect(() => {
    if (result) resultHeading.current?.focus();
  }, [result]);
  useEffect(() => {
    if (confirmation) confirmationHeading.current?.focus();
  }, [confirmation]);
  useEffect(() => {
    if (!busy && !result) {
      if (attempt) retryButton.current?.focus();
      else if (reloadRequired) reloadButton.current?.focus();
    }
  }, [attempt, reloadRequired, busy, result]);
  function denied(error: unknown) {
    if (
      error instanceof EventApiError &&
      [401, 403, 404].includes(error.status)
    ) {
      setResult(null);
      setAttempt(null);
      setConfirmation(null);
      setLinkState(null);
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
    setConfirmation(null);
    setLinkState(null);
    try {
      const command =
        next.action === "REISSUE"
          ? reissuePrivateLink
          : next.action === "REVOKE"
            ? revokePrivateLink
            : issuePrivateLink;
      const issued = await command(
        eventId,
        next.revision,
        csrf!,
        next.key,
        signal,
      );
      if (signal.aborted) return;
      if (issued.link_state === "ACTIVE") setResult(issued);
      setLinkState(issued.link_state);
      setAttempt(null);
      setReloadRequired(true);
      onCurrent({ ...detail, revision: issued.revision, as_of: issued.as_of });
      setFeedback(
        next.action === "REVOKE"
          ? "Private link revoked. The previous URL no longer grants access."
          : next.action === "REISSUE"
            ? "Private link reissued. The previous URL stopped working immediately. Copy the new shareable URL before leaving this result."
            : "Private link issued. Copy the shareable URL before leaving this result.",
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
            : error.code === "LINK_NOT_ACTIVE"
              ? "No private link is active. Reload current detail before choosing another command."
              : "The private-link command was rejected or event data changed. Reload current detail before trying again.",
        );
      } else {
        setAttempt(next);
        setFeedback(
          next.action === "ISSUE"
            ? "The issuance result is unknown. Retry the same request within 24 hours to confirm it safely."
            : "The private-link result is unknown. Retry the same request to confirm it safely; reissue results can be replayed for 24 hours.",
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
    setConfirmation(null);
    setLinkState(null);
    try {
      const current = await getEventDetail(eventId, signal);
      if (signal.aborted) return;
      onCurrent(current);
      setAttempt(null);
      setReloadRequired(false);
      setFeedback(
        "Current detail loaded. Check that your invitation-only event is published before changing its link. An active link is required to replace or revoke it.",
      );
      panelHeading.current?.focus();
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
      <h3 ref={panelHeading} tabIndex={-1}>
        Invitation link
      </h3>
      <p>
        Share event details by possession of a controlled link. This grants no
        management or registration authority and has no automatic expiry.
      </p>
      <p>
        Revoke and reissue require an active link. The server checks current
        eligibility before changing it.
      </p>
      {!eligible && (
        <p>
          Publish your invitation-only event before creating an invitation link.
        </p>
      )}
      {feedback && (
        <p role="status" className="notice">
          {feedback}
        </p>
      )}
      {busy && <p role="status">Checking private-link request…</p>}
      {linkState && (
        <p>
          Last confirmed link state: <strong>{linkState}</strong>. Refresh
          detail before another command.
        </p>
      )}
      {confirmation && eligible && (
        <section
          className="notice"
          role="group"
          aria-labelledby="private-link-confirmation"
        >
          <h4
            id="private-link-confirmation"
            ref={confirmationHeading}
            tabIndex={-1}
          >
            {confirmation.action === "REISSUE"
              ? "Confirm private-link reissue"
              : "Confirm private-link revocation"}
          </h4>
          <p>
            {confirmation.action === "REISSUE"
              ? "Reissuing immediately stops the previous private URL from working. Only the new URL will grant event detail access."
              : "Revoking immediately stops the current private URL from granting event detail access."}
          </p>
          <div className="lifecycle-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => void send(confirmation)}
            >
              {confirmation.action === "REISSUE"
                ? "Confirm reissue"
                : "Confirm revoke"}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setConfirmation(null);
                panelHeading.current?.focus();
              }}
            >
              Keep current link
            </button>
          </div>
        </section>
      )}
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
          ref={retryButton}
          disabled={busy || !eligible}
          onClick={() => void send(attempt)}
        >
          {attempt.action === "ISSUE"
            ? "Retry same issuance"
            : attempt.action === "REISSUE"
              ? "Retry same reissue"
              : "Retry same revoke"}
        </button>
      )}
      {reloadRequired && (
        <button
          ref={reloadButton}
          type="button"
          disabled={busy}
          onClick={() => void reload()}
        >
          Load current private-link detail
        </button>
      )}
      {eligible && !attempt && !reloadRequired && !result && !confirmation && (
        <div className="lifecycle-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void send({
                action: "ISSUE",
                key: crypto.randomUUID(),
                revision: detail.revision,
              })
            }
          >
            Issue private link
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setResult(null);
              setConfirmation({
                action: "REISSUE",
                key: crypto.randomUUID(),
                revision: detail.revision,
              });
            }}
          >
            Reissue private link
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              setResult(null);
              setConfirmation({
                action: "REVOKE",
                key: crypto.randomUUID(),
                revision: detail.revision,
              });
            }}
          >
            Revoke private link
          </button>
        </div>
      )}
    </section>
  );
}
