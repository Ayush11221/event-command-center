import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import type { Request } from "express";
import { Server } from "socket.io";
import { authenticate, type AuthDependencies } from "../auth/http.js";
import { ApiError } from "../auth/errors.js";
import { operationsSnapshot } from "./service.js";

// The ledger is durable publication intent. Read committed facts rather than
// sending inside the scan transaction or relying on an in-memory scan callback.
export function attachOperationsRealtime(
  server: HttpServer,
  deps: AuthDependencies,
  intervalMs = 1000,
) {
  const io = new Server(server, {
    path: "/api/v1/realtime/socket.io",
    transports: ["websocket"],
    serveClient: false,
    maxHttpBufferSize: 4096,
    cors: { origin: deps.frontendOrigin, credentials: true },
    allowRequest: (request, done) =>
      done(null, request.headers.origin === deps.frontendOrigin),
  });
  const requestFor = (headers: Request["headers"]) =>
    ({ header: (name: string) => headers[name.toLowerCase()] }) as Request;
  io.use(async (socket, next) => {
    try {
      await authenticate(requestFor(socket.request.headers), deps);
      next();
    } catch {
      next(new Error("UNAUTHENTICATED"));
    }
  });
  io.on("connection", (socket) => {
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let subscribing = false;
    const clear = () => {
      generation++;
      clearTimeout(timer);
    };
    socket.on("disconnect", clear);
    socket.on("operations.unsubscribe", clear);
    socket.on("operations.subscribe", async (input: unknown, ack: unknown) => {
      // Clear even on an invalid/unauthorized context change. Async work from an
      // earlier subscription cannot publish or acknowledge a later context.
      clear();
      const current = generation;
      if (typeof ack !== "function") return;
      const reply = ack as (body: object) => void;
      if (
        subscribing ||
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).length !== 1 ||
        !("event_id" in input) ||
        typeof input.event_id !== "string"
      ) {
        reply({ ok: false, code: "VALIDATION" });
        return;
      }
      subscribing = true;
      const eventId = input.event_id;
      const read = async () => {
        const actor = await authenticate(
          requestFor(socket.request.headers),
          deps,
        );
        return operationsSnapshot(deps, actor, eventId, randomUUID());
      };
      try {
        const snapshot = await read();
        if (current !== generation || !socket.connected) return;
        let revision = snapshot.revision;
        reply({ ok: true, event_id: eventId, revision, as_of: snapshot.as_of });
        const publish = async () => {
          try {
            const next = await read();
            if (current !== generation || !socket.connected) return;
            // operationsSnapshot has resolved its transaction: rolled-back
            // attendance is invisible and cannot produce a notification.
            if (next.revision > revision) {
              socket.emit("occupancy.updated", {
                message_id: `operations:${eventId}:${next.revision}`,
                schema_version: 1,
                event_id: eventId,
                revision: next.revision,
                as_of: next.as_of,
                occurred_at: next.last_attendance_at,
                correlation_id: next.correlation_id,
              });
              revision = next.revision;
            }
            timer = setTimeout(() => void publish(), intervalMs);
            timer.unref();
          } catch {
            if (current === generation) socket.disconnect(true);
          }
        };
        timer = setTimeout(() => void publish(), intervalMs);
        timer.unref();
      } catch (error) {
        if (current !== generation || !socket.connected) return;
        reply({
          ok: false,
          code:
            error instanceof ApiError ? error.code : "DEPENDENCY_UNAVAILABLE",
        });
      } finally {
        subscribing = false;
      }
    });
  });
  return io;
}
