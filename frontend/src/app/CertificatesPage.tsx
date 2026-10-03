import { useEffect, useRef, useState } from "react";
import { currentActor, ProofError } from "../services/proof";
import {
  certificateRequest,
  staffCertificatePath,
  certificateMessage,
  certificateOutcomeUnknown,
  type Catalogue,
  type StaffCertificateStatus,
} from "../services/certificates";
import { ProofEntry } from "./ProofEntry";

export function CertificatesPage({ eventId }: { eventId: string }) {
  const [csrf, setCsrf] = useState<string | null>(null),
    [catalogue, setCatalogue] = useState<Catalogue | null>(null),
    [registrationId, setRegistrationId] = useState(""),
    [status, setStatus] = useState<StaffCertificateStatus | null>(null),
    [template, setTemplate] = useState("classic"),
    [font, setFont] = useState("sans"),
    [reason, setReason] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<string | null>(null),
    [verify, setVerify] = useState(false),
    [attempt, setAttempt] = useState(0),
    [confirmRevoke, setConfirmRevoke] = useState(false);
  const lifecycle = useRef(new AbortController()),
    previewUrl = useRef<string | null>(null),
    scope = useRef(0),
    pending = useRef<{
      path: string;
      body: Record<string, unknown>;
      key: string;
    } | null>(null);
  function clearPreview() {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setPreview(null);
  }
  function fail(error: unknown) {
    clearPreview();
    setMessage(certificateMessage(error));
    if (
      error instanceof ProofError &&
      (error.status === 401 || error.code === "EVENT_NOT_FOUND")
    ) {
      lifecycle.current.abort();
      scope.current++;
      pending.current = null;
      setBusy(false);
      setStatus(null);
      setCatalogue(null);
      setCsrf(null);
      setVerify(error.status === 401);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    void currentActor()
      .then(async (actor) => {
        const next = await certificateRequest<Catalogue>(
          `/events/${encodeURIComponent(eventId)}/certificate-templates`,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setCsrf(actor.csrf_token);
          setCatalogue(next);
          setVerify(false);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setMessage(certificateMessage(error));
          setVerify(error instanceof ProofError && error.status === 401);
        }
      });
    const clear = () => {
      controller.abort();
      scope.current++;
      clearPreview();
      setStatus(null);
      setCatalogue(null);
      setCsrf(null);
      setBusy(false);
    };
    window.addEventListener("pagehide", clear);
    return () => {
      controller.abort();
      scope.current++;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
      window.removeEventListener("pagehide", clear);
    };
  }, [eventId, attempt]);
  async function read() {
    const version = scope.current,
      signal = lifecycle.current.signal;
    if (!registrationId || signal.aborted) return;
    try {
      const next = await certificateRequest<StaffCertificateStatus>(
        staffCertificatePath(eventId, registrationId),
        signal,
      );
      if (!signal.aborted && version === scope.current) {
        setStatus(next);
        return next;
      }
    } catch (error) {
      if (!signal.aborted && version === scope.current) {
        setStatus(null);
        fail(error);
      }
    }
  }
  useEffect(() => {
    if (status?.issue_work?.status !== "PENDING") return;
    const timer = setTimeout(() => {
      void read();
    }, 1000);
    return () => clearTimeout(timer);
  }, [status, eventId, registrationId]);
  async function command(
    action: "preview" | "issue" | "revoke",
    retry = false,
  ) {
    if (!csrf || !status || busy) return;
    const version = scope.current,
      signal = lifecycle.current.signal;
    const selected = {
      template_id: template,
      template_version: 1,
      font_id: font,
    };
    const fresh = {
      path:
        staffCertificatePath(eventId, status.registration_id) +
        (action === "issue" ? "" : `/${action}`),
      body: action === "revoke" ? { ...(reason ? { reason } : {}) } : selected,
      key: crypto.randomUUID(),
    };
    const request = retry && pending.current ? pending.current : fresh;
    if (action !== "preview") pending.current = request;
    setBusy(true);
    setMessage("");
    clearPreview();
    try {
      const result = await certificateRequest<Blob | Record<string, unknown>>(
        request.path,
        signal,
        {
          csrf,
          body: request.body,
          ...(action !== "preview" ? { key: request.key } : {}),
        },
      );
      if (action !== "preview") pending.current = null;
      if (signal.aborted || version !== scope.current) return;
      if (action === "preview") {
        previewUrl.current = URL.createObjectURL(result as Blob);
        setPreview(previewUrl.current);
      } else {
        setConfirmRevoke(false);
        setMessage(
          action === "revoke"
            ? "Certificate revoked."
            : "Issue command accepted. Checking authoritative status.",
        );
        await read();
      }
    } catch (error) {
      if (!certificateOutcomeUnknown(error)) pending.current = null;
      if (!signal.aborted && version === scope.current) fail(error);
    } finally {
      if (!signal.aborted && version === scope.current) setBusy(false);
    }
  }
  function changeScope(value: string) {
    scope.current++;
    clearPreview();
    setRegistrationId(value);
    setStatus(null);
    setConfirmRevoke(false);
    setMessage("");
    pending.current = null;
  }
  const generationPending = status?.issue_work?.status === "PENDING",
    uncertain = pending.current !== null;
  return (
    <main className="page-shell public-page">
      <a href="/">Back to event workspace</a>
      <h1>Certificates</h1>
      <p>
        Preview and explicitly issue one eligible registration. Only its owner
        can supply the recipient name or download the issued PDF.
      </p>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {verify && (
        <ProofEntry
          onAccountAuthenticated={() => setAttempt((value) => value + 1)}
        />
      )}
      {catalogue && csrf && (
        <section
          className="certificate-panel"
          aria-label="Single certificate operations"
        >
          <form
            className="certificate-form"
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              void read().finally(() => setBusy(false));
            }}
          >
            <label htmlFor="certificate-registration-id">Registration ID</label>
            <input
              id="certificate-registration-id"
              value={registrationId}
              disabled={busy}
              required
              onChange={(event) => changeScope(event.target.value)}
              autoComplete="off"
            />
            <button disabled={busy} type="submit">
              Read certificate status
            </button>
          </form>
          {status && (
            <>
              <h2>Certificate status: {status.state}</h2>
              <p>
                Recipient name:{" "}
                {status.recipient_name_set
                  ? "Set by owner"
                  : "Missing — owner must supply it"}
              </p>
              {status.issue_work && (
                <p role="status">
                  Generation: {status.issue_work.status}. Attempt{" "}
                  {status.issue_work.attempt_count} of 3.{" "}
                  {status.issue_work.last_error_code
                    ? `Last result: ${status.issue_work.last_error_code}.`
                    : ""}
                </p>
              )}
              {status.certificate && (
                <dl className="certificate-identifiers">
                  <dt>Certificate number</dt>
                  <dd>{status.certificate.certificate_number}</dd>
                  <dt>Issued</dt>
                  <dd>
                    {new Date(status.certificate.issued_at).toLocaleString()}
                  </dd>
                  <dt>Template / font</dt>
                  <dd>
                    {status.certificate.template_id} v
                    {status.certificate.template_version} /{" "}
                    {status.certificate.font_id}
                  </dd>
                  <dt>Eligibility evidence</dt>
                  <dd>{status.certificate.attendance_transition_id}</dd>
                  <dt>Issuer</dt>
                  <dd>{status.certificate.issued_by_user_id}</dd>
                  <dt>PDF SHA-256</dt>
                  <dd>{status.certificate.pdf_sha256}</dd>
                </dl>
              )}
              <fieldset
                className="certificate-form"
                disabled={busy || uncertain || generationPending}
              >
                <legend>Built-in preview and issue</legend>
                <label htmlFor="certificate-template">Template</label>
                <select
                  id="certificate-template"
                  value={template}
                  onChange={(event) => {
                    clearPreview();
                    setTemplate(event.target.value);
                  }}
                >
                  {catalogue.templates.map((item) => (
                    <option key={item.template_id} value={item.template_id}>
                      {item.template_id} v{item.template_version}
                    </option>
                  ))}
                </select>
                <label htmlFor="certificate-font">Font</label>
                <select
                  id="certificate-font"
                  value={font}
                  onChange={(event) => {
                    clearPreview();
                    setFont(event.target.value);
                  }}
                >
                  {catalogue.fonts.map((item) => (
                    <option key={item.font_id} value={item.font_id}>
                      {item.font_id}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!status.recipient_name_set}
                  onClick={() => void command("preview")}
                >
                  Preview certificate
                </button>
                <button
                  type="button"
                  disabled={
                    status.state !== "ELIGIBLE" || !status.recipient_name_set
                  }
                  onClick={() => void command("issue")}
                >
                  {status.issue_work?.status === "FAILED"
                    ? "Retry generation"
                    : "Issue certificate"}
                </button>
                <p>
                  Preview and issue are available only while the event is Live
                  or Completed. Preview is watermarked and does not issue a
                  certificate.
                </p>
              </fieldset>
              {uncertain && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void command(
                      pending.current!.path.endsWith("/revoke")
                        ? "revoke"
                        : "issue",
                      true,
                    )
                  }
                >
                  Retry same uncertain command
                </button>
              )}
              {preview && (
                <p>
                  <a href={preview} target="_blank" rel="noreferrer">
                    Open watermarked preview PDF
                  </a>
                </p>
              )}
              {status.state === "ISSUED" && (
                <form
                  className="certificate-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (confirmRevoke) void command("revoke");
                    else setConfirmRevoke(true);
                  }}
                >
                  <label htmlFor="certificate-revoke-reason">
                    Revocation reason (optional, no personal data)
                  </label>
                  <input
                    id="certificate-revoke-reason"
                    maxLength={200}
                    value={reason}
                    disabled={busy || uncertain}
                    onChange={(event) => setReason(event.target.value)}
                  />
                  {confirmRevoke && (
                    <p>
                      Revocation permanently denies owner downloads. This
                      certificate cannot be reissued.
                    </p>
                  )}
                  <button disabled={busy || uncertain} type="submit">
                    {confirmRevoke
                      ? "Confirm revocation"
                      : "Revoke certificate"}
                  </button>
                </form>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}
