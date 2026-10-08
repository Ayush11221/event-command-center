import { useCallback, useEffect, useRef, useState } from "react";
import { getEventDetail, type ManagementDetail } from "../services/events";
import { subscribeAccountSession } from "../services/account-session";

// Secondary workspace routes receive only the event reference in their URL.
// Read its scoped metadata for schedule presentation rather than using the
// browser's time zone or treating a remembered context as authoritative.
export function useEventInformation(eventId: string | null) {
  const [detail, setDetail] = useState<ManagementDetail | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const activeRead = useRef<AbortController | null>(null);
  const clear = useCallback(() => {
    activeRead.current?.abort();
    setDetail(null);
    setError(
      "Event information is unavailable in your current access. Sign in again or retry after checking your assignment.",
    );
  }, []);
  useEffect(
    () =>
      subscribeAccountSession((event) => {
        if (event === "expired" || event === "signed-out") clear();
      }),
    [clear],
  );
  useEffect(() => {
    if (!eventId) return;
    const controller = new AbortController();
    activeRead.current = controller;
    setDetail(null);
    setError("");
    void getEventDetail(eventId, controller.signal)
      .then((current) => {
        if (!controller.signal.aborted) setDetail(current);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "Event information could not be loaded. Retry to confirm the event and its time zone.",
          );
      });
    return () => controller.abort();
  }, [eventId, attempt]);
  return {
    detail,
    error,
    clear,
    retry: () => setAttempt((value) => value + 1),
  };
}
