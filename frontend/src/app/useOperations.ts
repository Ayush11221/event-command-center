import { useEffect, useState } from "react";
import { EventApiError } from "../services/events";
import { getOperations, type OperationsSnapshot } from "../services/occupancy";
import {
  connectOperations,
  validOperationsUpdate,
} from "../services/operations-realtime";

export type OperationsState =
  | { phase: "loading" }
  | { phase: "error"; status: number; message: string }
  | { phase: "ready"; snapshot: OperationsSnapshot };
export function useOperations(eventId: string, attempt: number) {
  const [state, setState] = useState<OperationsState>({ phase: "loading" });
  const [connection, setConnection] = useState(
    "Connecting — occupancy unconfirmed",
  );
  useEffect(() => {
    const controller = new AbortController();
    const socket = connectOperations();
    let active = true,
      subscribed = false,
      reading = false;
    let revision = -1,
      required = -1,
      pending = false;
    let subscription = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    setState({ phase: "loading" });
    setConnection("Connecting — occupancy unconfirmed");
    const reconcile = async () => {
      if (!active) return;
      if (reading) {
        pending = true;
        return;
      }
      reading = true;
      try {
        const snapshot = await getOperations(eventId, controller.signal);
        if (!active) return;
        if (snapshot.revision < revision || snapshot.revision < required) {
          setConnection("Reconciling — awaiting authoritative revision");
          clearTimeout(retry);
          retry = setTimeout(() => void reconcile(), 1000);
          return;
        }
        revision = snapshot.revision;
        setState({ phase: "ready", snapshot });
        setConnection(
          pending
            ? "Reconciling — confirming latest subscription"
            : subscribed && socket.connected
              ? "Live — confirmed by operations snapshot"
              : "Disconnected — last confirmed snapshot",
        );
      } catch (error: unknown) {
        if (!active) return;
        const status = error instanceof EventApiError ? error.status : 0;
        setConnection("Unconfirmed — reconciliation failed");
        setState({
          phase: "error",
          status,
          message:
            status === 401
              ? "Sign in with an Organizer or assigned Event Admin account."
              : status === 403 || status === 404
                ? "Operations unavailable. Your event access may have changed."
                : `Occupancy could not be confirmed. Retry to read the current state.${error instanceof EventApiError && error.correlationId ? ` Reference: ${error.correlationId}.` : ""}`,
        });
        if (status === 401 || status === 403 || status === 404) {
          subscribed = false;
          clearTimeout(reconnect);
          socket.disconnect();
        }
      } finally {
        reading = false;
        if (pending && active) {
          pending = false;
          void reconcile();
        }
      }
    };
    socket.on("connect", () => {
      const currentSubscription = ++subscription;
      subscribed = false;
      setConnection("Reconciling — connected, snapshot unconfirmed");
      socket.timeout(10000).emit(
        "operations.subscribe",
        { event_id: eventId },
        (
          error: Error | null,
          ack:
            | {
                ok?: boolean;
                event_id?: string;
                revision?: number;
                as_of?: string;
                code?: string;
              }
            | undefined,
        ) => {
          if (
            !active ||
            !socket.connected ||
            currentSubscription !== subscription
          )
            return;
          if (
            error ||
            !ack?.ok ||
            ack.event_id !== eventId ||
            !Number.isSafeInteger(ack.revision) ||
            ack.revision! < 0 ||
            typeof ack.as_of !== "string" ||
            !Number.isFinite(Date.parse(ack.as_of))
          ) {
            setConnection("Disconnected — subscription unavailable");
            socket.disconnect();
            void reconcile();
            return;
          }
          subscribed = true;
          required = Math.max(required, ack.revision!);
          void reconcile();
        },
      );
    });
    socket.on("occupancy.updated", (message: unknown) => {
      if (!active || !subscribed) return;
      // A stray old-context delivery must never trigger reads or render facts.
      if (
        message &&
        typeof message === "object" &&
        "event_id" in message &&
        message.event_id !== eventId
      )
        return;
      if (!validOperationsUpdate(message, eventId)) {
        setConnection("Reconciling — unsupported notification");
        void reconcile();
        return;
      }
      if (message.revision <= revision) return;
      required = Math.max(required, message.revision);
      setConnection(
        message.revision > revision + 1
          ? "Reconciling — revision gap detected"
          : "Reconciling — attendance changed",
      );
      void reconcile();
    });
    socket.on("disconnect", (reason: string) => {
      subscription++;
      subscribed = false;
      if (active)
        setConnection("Disconnected — last confirmed snapshot, reconnecting");
      if (active && reason === "io server disconnect") {
        void reconcile();
        reconnect = setTimeout(() => {
          if (active) socket.connect();
        }, 1000);
      }
    });
    socket.on("connect_error", () => {
      subscribed = false;
      if (active) setConnection("Disconnected — live connection unavailable");
    });
    const refresh = () => {
      if (!active) return;
      setConnection("Reconciling — checking freshness");
      void reconcile();
    };
    const foreground = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const hide = () => {
      active = false;
      controller.abort();
      socket.disconnect();
      setState({
        phase: "error",
        status: 0,
        message:
          "Read operations again to confirm current access and occupancy.",
      });
      setConnection("Disconnected — occupancy unconfirmed");
    };
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", foreground);
    const freshness = setInterval(refresh, 30000);
    void reconcile();
    // Strict Mode can synchronously tear down the first effect. Do not start a
    // WebSocket handshake that this cleanup will immediately abort.
    queueMicrotask(() => {
      if (active) socket.connect();
    });
    return () => {
      active = false;
      controller.abort();
      clearTimeout(retry);
      clearTimeout(reconnect);
      clearInterval(freshness);
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", foreground);
      socket.emit("operations.unsubscribe");
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [eventId, attempt]);
  return {
    state:
      state.phase === "ready" && state.snapshot.event_id !== eventId
        ? ({ phase: "loading" } as const)
        : state,
    connection,
  };
}
