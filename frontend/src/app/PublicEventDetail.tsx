import { useEffect, useRef, useState } from "react";
import {
  DiscoveryApiError,
  getPublicDetail,
  type PublicDetail,
} from "../services/discovery";
import { PublishedEventContent } from "./PublishedEventContent";

type State =
  | { phase: "loading" }
  | { phase: "unavailable" }
  | { phase: "error"; reference: string }
  | { phase: "ready"; detail: PublicDetail };
export function PublicEventDetail({ eventId }: { eventId: string }) {
  const [state, setState] = useState<State>({ phase: "loading" }),
    [retry, setRetry] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController(),
      { signal } = controller;
    setState({ phase: "loading" });
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
        <PublishedEventContent
          detail={state.detail}
          heading={heading}
          onRefresh={() => setRetry((value) => value + 1)}
        />
      )}
    </main>
  );
}
