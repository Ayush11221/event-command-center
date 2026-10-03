import { io } from "socket.io-client";

export interface OperationsUpdate {
  message_id: string;
  schema_version: 1;
  event_id: string;
  revision: number;
  as_of: string;
  occurred_at: string;
  correlation_id: string;
}
export function validOperationsUpdate(
  value: unknown,
  eventId: string,
): value is OperationsUpdate {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<OperationsUpdate>;
  return (
    v.schema_version === 1 &&
    v.event_id === eventId &&
    Number.isSafeInteger(v.revision) &&
    v.revision! > 0 &&
    v.message_id === `operations:${eventId}:${v.revision}` &&
    typeof v.as_of === "string" &&
    Number.isFinite(Date.parse(v.as_of)) &&
    typeof v.occurred_at === "string" &&
    Number.isFinite(Date.parse(v.occurred_at)) &&
    typeof v.correlation_id === "string"
  );
}
export function connectOperations() {
  return io(import.meta.env.VITE_API_ORIGIN, {
    path: "/api/v1/realtime/socket.io",
    transports: ["websocket"],
    withCredentials: true,
    autoConnect: false,
    timeout: 10000,
  });
}
