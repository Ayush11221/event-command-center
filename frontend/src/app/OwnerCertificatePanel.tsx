import { useEffect, useRef, useState } from "react";
import { ProofError } from "../services/proof";
import {
  certificateRequest,
  ownerCertificatePath,
  certificateMessage,
  certificateOutcomeUnknown,
  type OwnerCertificateStatus,
} from "../services/certificates";

export function OwnerCertificatePanel({
  registrationId,
  registrationState,
  csrf,
  onOwnershipLost,
}: {
  registrationId: string;
  registrationState: string;
  csrf: string;
  onOwnershipLost: (error: ProofError) => void;
}) {
  const [status, setStatus] = useState<OwnerCertificateStatus | null>(null),
    [name, setName] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0),
    [artifact, setArtifact] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null),
    url = useRef<string | null>(null),
    pending = useRef<{ key: string; name: string } | null>(null);
  const lost = useRef(onOwnershipLost);
  lost.current = onOwnershipLost;
  function clearArtifact() {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setArtifact(null);
  }
  function fail(error: unknown) {
    clearArtifact();
    setMessage(certificateMessage(error));
    if (
      error instanceof ProofError &&
      (error.status === 401 || error.status === 404)
    ) {
      setStatus(null);
      setName("");
      lost.current(error);
    }
  }
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    setStatus(null);
    setName("");
    setMessage("");
    setBusy(true);
    certificateRequest<OwnerCertificateStatus>(
      ownerCertificatePath(registrationId),
      active.signal,
    )
      .then((next) => {
        if (!active.signal.aborted) {
          setStatus(next);
          setName(next.recipient_name ?? "");
        }
      })
      .catch((error: unknown) => {
        if (!active.signal.aborted) {
          setMessage(certificateMessage(error));
          if (
            error instanceof ProofError &&
            (error.status === 401 || error.status === 404)
          )
            lost.current(error);
        }
      })
      .finally(() => {
        if (!active.signal.aborted) setBusy(false);
      });
    const clear = () => {
      active.abort();
      clearArtifact();
      setStatus(null);
      setName("");
      setBusy(false);
    };
    window.addEventListener("pagehide", clear);
    return () => {
      active.abort();
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = null;
      window.removeEventListener("pagehide", clear);
    };
  }, [registrationId, csrf, attempt]);
  async function save() {
    const active = controller.current;
    if (!active || active.signal.aborted || busy) return;
    const command = pending.current ?? { name, key: crypto.randomUUID() };
    pending.current = command;
    setBusy(true);
    setMessage("");
    clearArtifact();
    try {
      await certificateRequest(
        ownerCertificatePath(registrationId) + "/recipient-name",
        active.signal,
        { csrf, key: command.key, body: { recipient_name: command.name } },
      );
      pending.current = null;
      if (!active.signal.aborted) {
        setAttempt((value) => value + 1);
        setMessage("Recipient name saved.");
      }
    } catch (error) {
      if (!certificateOutcomeUnknown(error)) pending.current = null;
      if (!active.signal.aborted) fail(error);
    } finally {
      if (!active.signal.aborted) setBusy(false);
    }
  }
  async function download() {
    const active = controller.current;
    if (!active || active.signal.aborted || busy) return;
    setBusy(true);
    clearArtifact();
    setMessage("");
    try {
      const blob = await certificateRequest<Blob>(
        ownerCertificatePath(registrationId) + "/artifact",
        active.signal,
      );
      if (!active.signal.aborted) {
        url.current = URL.createObjectURL(blob);
        setArtifact(url.current);
      }
    } catch (error) {
      if (!active.signal.aborted) fail(error);
    } finally {
      if (!active.signal.aborted) setBusy(false);
    }
  }
  return (
    <section
      className="certificate-panel"
      aria-labelledby="owner-certificate-heading"
    >
      <h3 id="owner-certificate-heading">My certificate</h3>
      {message && <p role="status">{message}</p>}
      {busy && <p role="status">Checking certificate…</p>}
      {status && (
        <>
          <p>
            Certificate status: <strong>{status.state}</strong>
          </p>
          <p>
            Eligibility requires an accepted check-in. A staff member must
            explicitly issue the certificate.
          </p>
          <form
            className="certificate-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label htmlFor="certificate-recipient-name">
              Certificate recipient name
            </label>
            <input
              id="certificate-recipient-name"
              value={name}
              maxLength={100}
              disabled={
                busy ||
                status.recipient_name_locked ||
                registrationState === "CANCELLED" ||
                pending.current !== null
              }
              onChange={(event) => setName(event.target.value)}
              aria-describedby="certificate-name-help"
              autoComplete="name"
            />
            <p id="certificate-name-help">
              2–100 characters. Supported Latin letters, spaces, apostrophes,
              hyphens and periods. Locked permanently once issued.
            </p>
            {!status.recipient_name_locked &&
              registrationState !== "CANCELLED" && (
                <button disabled={busy} type="submit">
                  {pending.current
                    ? "Retry same name command"
                    : "Save recipient name"}
                </button>
              )}
          </form>
          {status.certificate && (
            <p className="certificate-identifiers">
              Certificate number: {status.certificate.certificate_number}
              <br />
              Issued: {new Date(status.certificate.issued_at).toLocaleString()}
            </p>
          )}
          {status.state === "ISSUED" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void download()}
            >
              Prepare certificate download
            </button>
          )}
          {status.state === "REVOKED" && (
            <p>This certificate has been revoked. Download is unavailable.</p>
          )}
          {artifact && status.state === "ISSUED" && (
            <a
              href={artifact}
              download={`certificate-${status.certificate!.certificate_number}.pdf`}
            >
              Download my certificate PDF
            </a>
          )}
        </>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          clearArtifact();
          setAttempt((value) => value + 1);
        }}
      >
        Refresh certificate status
      </button>
    </section>
  );
}
