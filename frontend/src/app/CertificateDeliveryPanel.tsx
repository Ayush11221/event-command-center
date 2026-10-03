import { useEffect, useRef, useState } from "react";
import {
  certificateRequest,
  certificateMessage,
  certificateOutcomeUnknown,
} from "../services/certificates";
import {
  deliveryExplanation,
  type Delivery,
} from "../services/certificate-delivery";
export function CertificateDeliveryPanel({
  path,
  csrf,
  staff = false,
  revoked = false,
  onFailure,
}: {
  path: string;
  csrf: string;
  staff?: boolean;
  revoked?: boolean;
  onFailure: (error: unknown) => void;
}) {
  const [delivery, setDelivery] = useState<Delivery | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const scope = useRef<AbortController | null>(null),
    pending = useRef<{ key: string; path: string } | null>(null),
    failure = useRef(onFailure);
  failure.current = onFailure;
  useEffect(() => {
    const active = new AbortController();
    scope.current = active;
    pending.current = null;
    setDelivery(null);
    setMessage("");
    setBusy(true);
    certificateRequest<{ delivery: Delivery | null }>(path, active.signal)
      .then((result) => {
        if (!active.signal.aborted) setDelivery(result.delivery ?? null);
      })
      .catch((error) => {
        if (!active.signal.aborted) {
          setMessage(certificateMessage(error));
          failure.current(error);
        }
      })
      .finally(() => {
        if (!active.signal.aborted) setBusy(false);
      });
    const clear = () => {
      active.abort();
      setDelivery(null);
      setMessage("");
    };
    window.addEventListener("pagehide", clear);
    return () => {
      active.abort();
      window.removeEventListener("pagehide", clear);
    };
  }, [path, csrf]);
  async function read() {
    const active = scope.current;
    if (!active || active.signal.aborted || busy) return;
    setBusy(true);
    try {
      const result = await certificateRequest<{ delivery: Delivery | null }>(
        path,
        active.signal,
      );
      if (!active.signal.aborted) setDelivery(result.delivery ?? null);
    } catch (error) {
      if (!active.signal.aborted) {
        setMessage(certificateMessage(error));
        failure.current(error);
      }
    } finally {
      if (!active.signal.aborted) setBusy(false);
    }
  }
  async function command() {
    const active = scope.current;
    if (!active || active.signal.aborted || busy) return;
    const request = pending.current ?? {
      path: delivery ? path + "/retry" : path,
      key: crypto.randomUUID(),
    };
    pending.current = request;
    setBusy(true);
    setMessage("");
    try {
      const result = await certificateRequest<{ delivery: Delivery }>(
        request.path,
        active.signal,
        { csrf, key: request.key, body: {} },
      );
      pending.current = null;
      if (!active.signal.aborted) setDelivery(result.delivery);
    } catch (error) {
      if (!certificateOutcomeUnknown(error)) pending.current = null;
      if (!active.signal.aborted) {
        setMessage(certificateMessage(error));
        failure.current(error);
      }
    } finally {
      if (!active.signal.aborted) setBusy(false);
    }
  }
  return (
    <section
      className="certificate-panel"
      aria-label="Certificate email delivery"
    >
      <h3>Email delivery</h3>
      {busy && <p role="status">Checking delivery…</p>}
      {message && <p role="status">{message}</p>}
      {delivery ? (
        <>
          <p>
            Delivery status: <strong>{delivery.status}</strong>
          </p>
          <p>{deliveryExplanation(delivery.status, delivery.reason_code)}</p>
          <p>
            Attempt {delivery.attempt_count} of {delivery.max_attempts}.
          </p>
        </>
      ) : (
        <p>No delivery intent yet.</p>
      )}
      <button disabled={busy} onClick={() => void read()}>
        Refresh delivery status
      </button>
      {staff &&
        !revoked &&
        (pending.current ||
          !delivery ||
          (delivery.status === "FAILED" &&
            delivery.attempt_count < delivery.max_attempts)) && (
          <button disabled={busy} onClick={() => void command()}>
            {pending.current
              ? "Retry same delivery command"
              : delivery
                ? "Retry failed delivery"
                : "Request email delivery"}
          </button>
        )}
    </section>
  );
}
