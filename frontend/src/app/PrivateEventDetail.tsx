import { useEffect, useRef, useState } from "react";
import {
  DiscoveryApiError,
  getPrivateDetail,
  type PublicDetail,
} from "../services/discovery";
import type { PrivateEntry } from "./private-entry";
import { PublishedEventContent } from "./PublishedEventContent";

type State =
  | { phase: "loading" }
  | { phase: "unavailable" }
  | { phase: "error" }
  | { phase: "ready"; detail: PublicDetail };
export function PrivateEventDetail({ entry }: { entry?: PrivateEntry }) {
  const [state, setState] = useState<State>({ phase: "loading" }),
    [retry, setRetry] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(
    () =>
      entry?.subscribe?.(() => {
        setState({ phase: "loading" });
        setRetry((value) => value + 1);
      }),
    [entry],
  );
  useEffect(() => {
    const controller = new AbortController(),
      { signal } = controller;
    const discard = () => {
      controller.abort();
      setState({ phase: "unavailable" });
    };
    window.addEventListener("pagehide", discard);
    setState({ phase: "loading" });
    void getPrivateDetail(entry?.read() ?? null, signal)
      .then((detail) => {
        if (!signal.aborted) setState({ phase: "ready", detail });
      })
      .catch((error: unknown) => {
        if (!signal.aborted)
          setState(
            error instanceof DiscoveryApiError && error.status === 404
              ? { phase: "unavailable" }
              : { phase: "error" },
          );
      });
    return () => {
      controller.abort();
      window.removeEventListener("pagehide", discard);
    };
  }, [entry, retry]);
  useEffect(() => {
    if (state.phase !== "loading") heading.current?.focus();
  }, [state.phase]);
  return (
    <main className="page-shell public-page">
      <a href="/events" className="catalog-back">
        Browse public events
      </a>
      {state.phase === "loading" ? (
        <p role="status" className="notice">
          Loading private event detail…
        </p>
      ) : state.phase === "ready" ? (
        <>
          <p className="notice">
            PRIVATE access · This controlled link grants event detail viewing
            only.
          </p>
          <PublishedEventContent
            detail={state.detail}
            heading={heading}
            onRefresh={() => setRetry((value) => value + 1)}
            accessLabel="PRIVATE PUBLISHED EVENT"
            refreshLabel="Refresh private detail"
          />
        </>
      ) : (
        <section
          className={
            state.phase === "error" ? "notice critical" : "empty-state"
          }
        >
          <h1 ref={heading} tabIndex={-1}>
            {state.phase === "error"
              ? "Private detail could not be loaded"
              : "Private event unavailable"}
          </h1>
          <p role={state.phase === "error" ? "alert" : undefined}>
            {state.phase === "error"
              ? "Check your connection and retry."
              : "This controlled link is unavailable. Contact the event organizer for access."}
          </p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry private detail
          </button>
        </section>
      )}
    </main>
  );
}
