import { useEffect, useRef, useState } from "react";
import { EventApiError } from "../services/events";
import {
  getCurrentForecast,
  type ForecastCurrent,
} from "../services/forecasting";

interface State {
  eventId: string;
  response: ForecastCurrent | null;
  receivedAt: number;
  loading: boolean;
  failed: boolean;
  denied: boolean;
}
interface Context {
  active: boolean;
  started: boolean;
  reading: boolean;
  denied: boolean;
  controller?: AbortController;
  refresh: () => void;
}
const empty = (eventId: string): State => ({
  eventId,
  response: null,
  receivedAt: 0,
  loading: false,
  failed: false,
  denied: false,
});

export function useForecasts(
  eventId: string,
  ready: boolean,
  authorityLost: boolean,
) {
  const [state, setState] = useState<State>(() => empty(eventId));
  const [clock, setClock] = useState(() => performance.now());
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const context = useRef<Context | null>(null);
  useEffect(() => {
    const current: Context = {
      active: !authorityLost,
      started: false,
      reading: false,
      denied: false,
      refresh: () => {},
    };
    context.current = current;
    setState(empty(eventId));
    const refresh = async () => {
      if (
        !current.active ||
        current.reading ||
        current.denied ||
        !readyRef.current ||
        document.visibilityState !== "visible"
      )
        return;
      current.started = true;
      current.reading = true;
      current.controller = new AbortController();
      setState((value) => ({ ...value, loading: true, failed: false }));
      try {
        const response = await getCurrentForecast(
          eventId,
          current.controller.signal,
        );
        if (!current.active) return;
        const receivedAt = performance.now();
        setClock(receivedAt);
        setState({
          eventId,
          response,
          receivedAt,
          loading: false,
          failed: false,
          denied: false,
        });
      } catch (error) {
        if (!current.active) return;
        current.denied =
          error instanceof EventApiError &&
          [401, 403, 404].includes(error.status);
        setState((value) => ({
          ...value,
          loading: false,
          failed: true,
          denied: current.denied,
          response: current.denied ? null : value.response,
        }));
      } finally {
        current.reading = false;
      }
    };
    current.refresh = () => {
      void refresh();
    };
    const foreground = () => {
      if (document.visibilityState === "visible") current.refresh();
    };
    const hide = () => {
      current.active = false;
      current.controller?.abort();
      setState(empty(eventId));
    };
    const cadence = setInterval(current.refresh, 60000);
    const age = setInterval(() => {
      if (current.active) setClock(performance.now());
    }, 1000);
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("pagehide", hide);
    // Strict Mode cleanup must run before an on-demand generation starts.
    queueMicrotask(() => {
      if (current.active && readyRef.current) current.refresh();
    });
    return () => {
      current.active = false;
      current.controller?.abort();
      clearInterval(cadence);
      clearInterval(age);
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("pagehide", hide);
    };
  }, [eventId, authorityLost]);
  useEffect(() => {
    const current = context.current;
    queueMicrotask(() => {
      if (ready && current?.active && !current.started) current.refresh();
    });
  }, [eventId, ready]);
  return {
    state: state.eventId === eventId && !authorityLost ? state : empty(eventId),
    elapsed: Math.max(0, clock - state.receivedAt),
    refresh: () => context.current?.refresh(),
  };
}
