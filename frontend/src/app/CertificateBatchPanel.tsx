import { useEffect, useRef, useState } from "react";
import {
  certificateRequest,
  certificateMessage,
  certificateOutcomeUnknown,
  type Catalogue,
} from "../services/certificates";
import {
  batchPath,
  type Batch,
  type BatchItem,
} from "../services/certificate-delivery";
export function CertificateBatchPanel({
  eventId,
  csrf,
  catalogue,
  onFailure,
}: {
  eventId: string;
  csrf: string;
  catalogue: Catalogue;
  onFailure: (error: unknown) => void;
}) {
  const [ids, setIds] = useState(""),
    [template, setTemplate] = useState("classic"),
    [font, setFont] = useState("sans"),
    [confirm, setConfirm] = useState(false),
    [batch, setBatch] = useState<Batch | null>(null),
    [batchId, setBatchId] = useState(""),
    [items, setItems] = useState<BatchItem[]>([]),
    [next, setNext] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const active = useRef<AbortController | null>(null),
    pending = useRef<{ key: string; body: Record<string, unknown> } | null>(
      null,
    ),
    failure = useRef(onFailure),
    cursor = useRef<string | null>(null);
  failure.current = onFailure;
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    setBatch(null);
    setItems([]);
    pending.current = null;
    const clear = () => {
      controller.abort();
      setBatch(null);
      setItems([]);
      setIds("");
    };
    window.addEventListener("pagehide", clear);
    return () => {
      controller.abort();
      window.removeEventListener("pagehide", clear);
    };
  }, [eventId, csrf]);
  const selection = ids.split(/[\s,]+/).filter(Boolean);
  async function load(id: string, page: string | null = null) {
    const signal = active.current?.signal;
    if (!signal || signal.aborted) return;
    const path = batchPath(eventId) + `/${encodeURIComponent(id)}`;
    const [status, outcomes] = await Promise.all([
      certificateRequest<{ batch: Batch }>(path, signal),
      certificateRequest<{ items: BatchItem[]; next_cursor: string | null }>(
        path +
          `/items?limit=25${page ? `&cursor=${encodeURIComponent(page)}` : ""}`,
        signal,
      ),
    ]);
    if (!signal.aborted) {
      setBatch(status.batch);
      setItems(outcomes.items);
      setNext(outcomes.next_cursor);
      setBatchId(id);
      cursor.current = page;
    }
  }
  async function read(page: string | null = null) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await load(batch?.batch_id ?? batchId, page);
    } catch (error) {
      if (!active.current?.signal.aborted) {
        setMessage(certificateMessage(error));
        failure.current(error);
      }
    } finally {
      if (!active.current?.signal.aborted) setBusy(false);
    }
  }
  async function create() {
    const signal = active.current?.signal;
    if (!signal || signal.aborted || busy) return;
    const request = pending.current ?? {
      key: crypto.randomUUID(),
      body: {
        registration_ids: selection,
        template_id: template,
        template_version: 1,
        font_id: font,
      },
    };
    pending.current = request;
    setBusy(true);
    setMessage("");
    try {
      const result = await certificateRequest<{ batch: Batch }>(
        batchPath(eventId),
        signal,
        { csrf, key: request.key, body: request.body },
      );
      pending.current = null;
      if (!signal.aborted) {
        setBatch(result.batch);
        setBatchId(result.batch.batch_id);
        setConfirm(false);
        await load(result.batch.batch_id);
      }
    } catch (error) {
      if (!certificateOutcomeUnknown(error)) pending.current = null;
      if (!signal.aborted) {
        setMessage(certificateMessage(error));
        failure.current(error);
      }
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <section
      className="certificate-panel"
      aria-labelledby="certificate-batch-heading"
    >
      <h2 id="certificate-batch-heading">Batch certificate issuance</h2>
      {message && <p role="status">{message}</p>}
      {busy && <p role="status">Checking batch…</p>}
      <form
        className="certificate-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (confirm || pending.current) void create();
          else setConfirm(true);
        }}
      >
        <fieldset disabled={busy || confirm || pending.current !== null}>
          <legend>Explicit selection</legend>
          <label htmlFor="batch-registration-ids">
            Registration IDs (1–100, separated by spaces or commas)
          </label>
          <textarea
            id="batch-registration-ids"
            value={ids}
            rows={4}
            onChange={(event) => setIds(event.target.value)}
          />
          <label htmlFor="batch-template">Batch template</label>
          <select
            id="batch-template"
            value={template}
            onChange={(event) => setTemplate(event.target.value)}
          >
            {catalogue.templates.map((row) => (
              <option key={row.template_id} value={row.template_id}>
                {row.template_id} v{row.template_version}
              </option>
            ))}
          </select>
          <label htmlFor="batch-font">Batch font</label>
          <select
            id="batch-font"
            value={font}
            onChange={(event) => setFont(event.target.value)}
          >
            {catalogue.fonts.map((row) => (
              <option key={row.font_id} value={row.font_id}>
                {row.font_id}
              </option>
            ))}
          </select>
        </fieldset>
        {confirm && (
          <p>
            Confirm issuance for {selection.length} selected registrations.
            Existing certificates are reused; individual failures do not stop
            the batch.
          </p>
        )}
        <button
          disabled={
            busy ||
            (!pending.current &&
              (selection.length < 1 || selection.length > 100))
          }
          type="submit"
        >
          {pending.current
            ? "Retry same batch command"
            : confirm
              ? "Confirm batch issuance"
              : "Review batch selection"}
        </button>
        {confirm && !pending.current && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirm(false)}
          >
            Edit selection
          </button>
        )}
      </form>
      <form
        className="certificate-form"
        onSubmit={(event) => {
          event.preventDefault();
          setBatch(null);
          void read();
        }}
      >
        <label htmlFor="certificate-batch-id">Batch ID</label>
        <input
          id="certificate-batch-id"
          value={batchId}
          disabled={busy}
          onChange={(event) => {
            setBatch(null);
            setItems([]);
            setBatchId(event.target.value);
          }}
        />
        <button disabled={busy || !batchId}>Read batch status</button>
      </form>
      {batch && (
        <>
          <p className="certificate-identifiers">Batch: {batch.batch_id}</p>
          <p role="status">
            {batch.status}: {batch.successful_count} successful,{" "}
            {batch.failed_count} failed, {batch.pending_count} pending of{" "}
            {batch.selected_count} selected.
          </p>
          <p>
            {batch.generated_count} generated; {batch.already_satisfied_count}{" "}
            already satisfied.
          </p>
          <p>
            Email: {batch.delivery_counts.sent} submitted,{" "}
            {batch.delivery_counts.failed} failed,{" "}
            {batch.delivery_counts.unknown} held as unknown,{" "}
            {batch.delivery_counts.not_required} not required. Issuance and
            email outcomes are separate.
          </p>
          <button disabled={busy} onClick={() => void read(cursor.current)}>
            Refresh batch progress
          </button>
          <h3>Item outcomes</h3>
          {items.length ? (
            <ul className="certificate-identifiers">
              {items.map((item) => (
                <li key={item.registration_id}>
                  {item.registration_id}: {item.status}
                  {item.result_code ? ` — ${item.result_code}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p>No item outcomes on this page.</p>
          )}
          <button
            disabled={busy || cursor.current === null}
            onClick={() => void read(null)}
          >
            First item page
          </button>
          <button disabled={busy || !next} onClick={() => void read(next)}>
            Next item page
          </button>
        </>
      )}
    </section>
  );
}
