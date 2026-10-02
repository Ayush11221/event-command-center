import { useEffect, useRef, useState } from "react";
import {
  DiscoveryApiError,
  getPublicDetail,
  type PublicDetail,
} from "../services/discovery";
import { publicEventTime, PublicPolicy, PublicTags } from "./PublicEventInfo";

type State =
  | { phase: "loading" }
  | { phase: "unavailable" }
  | { phase: "error"; reference: string }
  | { phase: "ready"; detail: PublicDetail };
export function PublicEventDetail({ eventId }: { eventId: string }) {
  const [state, setState] = useState<State>({ phase: "loading" }),
    [retry, setRetry] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController(),
      { signal } = controller;
    setState({ phase: "loading" });
    setImageFailed(false);
    void getPublicDetail(eventId, signal)
      .then((detail) => {
        if (!signal.aborted) setState({ phase: "ready", detail });
      })
      .catch((error: unknown) => {
        if (signal.aborted) return;
        setState(
          error instanceof DiscoveryApiError && error.status === 404
            ? { phase: "unavailable" }
            : {
                phase: "error",
                reference:
                  error instanceof DiscoveryApiError && error.correlationId
                    ? ` Reference: ${error.correlationId}.`
                    : "",
              },
        );
      });
    return () => controller.abort();
  }, [eventId, retry]);
  useEffect(() => {
    if (state.phase !== "loading") heading.current?.focus();
  }, [state.phase]);
  return (
    <main className="page-shell public-page">
      <a href="/events" className="catalog-back">
        Back to public events
      </a>
      {state.phase === "loading" ? (
        <p role="status" className="notice">
          Loading public event detail…
        </p>
      ) : state.phase === "unavailable" ? (
        <section className="empty-state">
          <h1 ref={heading} tabIndex={-1}>
            Event unavailable
          </h1>
          <p>This event is not available in the public catalog.</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Check availability again
          </button>
        </section>
      ) : state.phase === "error" ? (
        <section className="notice critical">
          <h1 ref={heading} tabIndex={-1}>
            Event detail unavailable
          </h1>
          <p role="alert">
            Public event detail could not be loaded. Retry to check current
            availability.{state.reference}
          </p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry event detail
          </button>
        </section>
      ) : (
        <article>
          <div className="page-heading">
            <div>
              <p className="eyebrow">PUBLISHED EVENT</p>
              <h1 ref={heading} tabIndex={-1}>
                {state.detail.name}
              </h1>
              <PublicTags event={state.detail} />
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Refresh event detail
            </button>
          </div>
          {state.detail.image_url && !imageFailed && (
            <img
              className="public-event-banner"
              src={state.detail.image_url}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
            />
          )}
          {imageFailed && <p className="freshness">Event image unavailable.</p>}
          <p className="public-description">
            {state.detail.description ?? "No description provided."}
          </p>
          <dl className="event-detail-fields">
            <div>
              <dt>Starts</dt>
              <dd>
                {publicEventTime(state.detail.start_at, state.detail.time_zone)}
              </dd>
            </div>
            <div>
              <dt>Ends</dt>
              <dd>
                {publicEventTime(state.detail.end_at, state.detail.time_zone)}
              </dd>
            </div>
            <div>
              <dt>Event time zone</dt>
              <dd>{state.detail.time_zone ?? "Not configured"}</dd>
            </div>
            <div>
              <dt>Public location</dt>
              <dd>{state.detail.public_location ?? "Location not provided"}</dd>
            </div>
          </dl>
          <h2>Registration policy</h2>
          <PublicPolicy event={state.detail} />
          <p className="freshness">
            Event confirmed {new Date(state.detail.as_of).toLocaleString()}.
          </p>
        </article>
      )}
    </main>
  );
}
