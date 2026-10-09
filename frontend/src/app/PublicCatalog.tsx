import { Accent, IsoBuilding } from "../components/common/Iso";
import { CalendarDays, MapPin } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  DiscoveryApiError,
  getPublicCatalog,
  type PublicCatalogResponse,
} from "../services/discovery";
import { publicEventTime, PublicPolicy, PublicTags } from "./PublicEventInfo";

type State =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; page: PublicCatalogResponse };
function failure(error: unknown) {
  const reference =
    error instanceof DiscoveryApiError && error.correlationId
      ? ` Reference: ${error.correlationId}.`
      : "";
  return `Public events could not be loaded. Retry to check the current catalog.${reference}`;
}
export function PublicCatalog() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [retry, setRetry] = useState(0),
    [busy, setBusy] = useState(false),
    [moreError, setMoreError] = useState("");
  const [moreStatus, setMoreStatus] = useState("");
  const controller = useRef<AbortController | null>(null),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    controller.current = new AbortController();
    const signal = controller.current.signal;
    setState({ phase: "loading" });
    setMoreStatus("");
    setMoreError("");
    setBusy(false);
    void getPublicCatalog(undefined, signal)
      .then((page) => {
        if (!signal.aborted) setState({ phase: "ready", page });
      })
      .catch((error: unknown) => {
        if (!signal.aborted)
          setState({ phase: "error", message: failure(error) });
      });
    return () => controller.current?.abort();
  }, [retry]);
  useEffect(() => {
    if (state.phase === "ready") heading.current?.focus();
  }, [state.phase]);
  async function more() {
    if (busy || state.phase !== "ready" || !state.page.next_cursor) return;
    controller.current = new AbortController();
    const signal = controller.current.signal;
    setBusy(true);
    setMoreStatus("");
    setMoreError("");
    try {
      const page = await getPublicCatalog(state.page.next_cursor, signal);
      if (signal.aborted) return;
      const items = [
        ...new Map(
          [...state.page.items, ...page.items].map((item) => [
            item.event_id,
            item,
          ]),
        ).values(),
      ];
      setState({ phase: "ready", page: { ...page, items } });
      setMoreStatus(
        page.items.length
          ? "More public events loaded."
          : "No additional public events are available.",
      );
    } catch (error) {
      if (!signal.aborted) setMoreError(failure(error));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <main className="page-shell public-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PUBLIC EVENTS</p>
          <h1 ref={heading} tabIndex={-1}>
            Explore <Accent>events</Accent>
          </h1>
          <p>
            Find live events to open your entry QR, or browse published events
            to register.
          </p>
        </div>
        {state.phase === "ready" && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => setRetry((value) => value + 1)}
          >
            Refresh catalog
          </button>
        )}
      </div>
      {state.phase === "loading" ? (
        <p role="status" className="notice is-loading">
          Loading public events…
        </p>
      ) : state.phase === "error" ? (
        <div role="alert" className="notice critical">
          <p>{state.message}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry catalog
          </button>
        </div>
      ) : (
        <>
          {state.page.items.length === 0 ? (
            <section className="empty-state">
              <h2>No public events available</h2>
              <p>Check back for newly published events.</p>
            </section>
          ) : (
            <>
              {(["LIVE", "PUBLISHED"] as const).map((lifecycle) => {
                const events = state.page.items.filter((event) =>
                  lifecycle === "LIVE"
                    ? event.event_state === "LIVE"
                    : event.event_state !== "LIVE",
                );
                if (!events.length) return null;
                return (
                  <section
                    key={lifecycle}
                    aria-label={
                      lifecycle === "LIVE" ? "Live events" : "Published events"
                    }
                  >
                    <h2 className="event-section-title">
                      {lifecycle === "LIVE"
                        ? "Live events"
                        : "Published events"}
                    </h2>
                    <ul className="public-event-list">
                      {events.map((event) => (
                        <li key={event.event_id}>
                          <article className="public-event-row">
                            <IsoBuilding
                              className="public-event-art"
                              tone={
                                event.event_state === "LIVE" ||
                                event.availability.policy_status === "OPEN"
                                  ? "action"
                                  : "state-completed"
                              }
                            />
                            <div>
                              <PublicTags event={event} />
                              <h2>
                                <a
                                  href={`/events/${encodeURIComponent(event.event_id)}`}
                                >
                                  {event.name}
                                </a>
                              </h2>
                              <p className="event-meta-line">
                                <CalendarDays
                                  aria-hidden="true"
                                  className="size-4"
                                />
                                {publicEventTime(
                                  event.start_at,
                                  event.time_zone,
                                )}{" "}
                                –{" "}
                                {publicEventTime(event.end_at, event.time_zone)}
                                {event.time_zone && ` · ${event.time_zone}`}
                              </p>
                              <p className="event-meta-line">
                                <MapPin aria-hidden="true" className="size-4" />
                                {event.public_location ??
                                  "Location not provided"}
                              </p>
                            </div>
                            <div>
                              <PublicPolicy event={event} compact />
                              {event.event_state === "LIVE" && (
                                <a
                                  href={`/events/${encodeURIComponent(event.event_id)}`}
                                >
                                  View my registration
                                </a>
                              )}
                            </div>
                          </article>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </>
          )}
          <p className="freshness">
            Latest page confirmed {new Date(state.page.as_of).toLocaleString()}.
            Visibility and availability can change; refresh to check current
            events.
          </p>
          {moreError && (
            <p role="alert" className="notice critical">
              {moreError}
            </p>
          )}
          {busy && <p role="status">Loading more events…</p>}
          {moreStatus && <p role="status">{moreStatus}</p>}
          {state.page.next_cursor && (
            <button type="button" disabled={busy} onClick={() => void more()}>
              {moreError ? "Retry loading more events" : "Load more events"}
            </button>
          )}
        </>
      )}
    </main>
  );
}
