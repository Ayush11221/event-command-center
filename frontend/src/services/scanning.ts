import { accountFetch } from "./account-session";
import { ProofError } from "./proof";

export interface ScanCommand {
  scan_id: string;
  event_id: string;
  gate_id: string;
  credential: string;
  direction?: "CHECK_IN" | "CHECK_OUT";
}
export interface ScannerScope {
  event_name: string;
  gate_label: string;
  checkout_enabled?: boolean;
}
export type ScanReason =
  | "ACCEPTED"
  | "INVALID_CREDENTIAL"
  | "EXPIRED_CREDENTIAL"
  | "CANCELLED_CREDENTIAL"
  | "ALREADY_CHECKED_IN"
  | "CHECKOUT_DISABLED"
  | "NOT_CHECKED_IN"
  | "ALREADY_CHECKED_OUT"
  | "REGISTRATION_UNAVAILABLE";
export interface ScanResult {
  scan_id: string;
  event_id: string;
  gate_id: string;
  decision: "ACCEPTED" | "REJECTED";
  reason: ScanReason;
  registration_status: "REGISTERED" | "CANCELLED" | null;
  attendance_status: "NOT_ARRIVED" | "INSIDE" | "LEFT" | null;
  decided_at: string;
  replayed: boolean;
  correlation_id: string;
}
async function request(
  path: string,
  signal: AbortSignal,
  command?: ScanCommand,
  csrf?: string,
): Promise<unknown> {
  const origin = import.meta.env.VITE_API_ORIGIN;
  if (!origin) throw new ProofError("NETWORK", 0);
  const controller = new AbortController(),
    abort = () => controller.abort();
  if (signal.aborted) abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 15000);
  try {
    const response = await accountFetch(new URL("/api/v1" + path, origin), {
      method: command ? "POST" : "GET",
      credentials: "include",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
      headers: command
        ? {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf ?? "",
            "Idempotency-Key": command.scan_id,
          }
        : {},
      body: command ? JSON.stringify(command) : undefined,
    });
    const body: unknown = await response.json();
    if (!response.ok)
      throw new ProofError(
        (body as { code?: string })?.code ?? "UNKNOWN",
        response.status,
      );
    return body;
  } catch (error) {
    if (error instanceof ProofError) throw error;
    throw new ProofError("NETWORK", 0);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}
export async function scannerScope(
  eventId: string,
  gateId: string,
  signal: AbortSignal,
) {
  const body = (await request(
    `/events/${encodeURIComponent(eventId)}/gates/${encodeURIComponent(gateId)}/scope`,
    signal,
  )) as Record<string, unknown>;
  if (
    body?.authorized !== true ||
    body.event_id !== eventId ||
    body.gate_id !== gateId ||
    typeof body.event_name !== "string" ||
    !body.event_name ||
    typeof body.gate_label !== "string" ||
    !body.gate_label
  )
    throw new ProofError("INVALID_RESPONSE", 0);
  return {
    event_name: body.event_name,
    gate_label: body.gate_label,
    checkout_enabled: body.checkout_enabled === true,
  } as ScannerScope;
}
export async function submitScan(
  command: ScanCommand,
  csrf: string,
  signal: AbortSignal,
): Promise<ScanResult> {
  const body = (await request(
    "/scan-decisions",
    signal,
    command,
    csrf,
  )) as ScanResult;
  if (
    !body ||
    body.scan_id !== command.scan_id ||
    body.event_id !== command.event_id ||
    body.gate_id !== command.gate_id ||
    typeof body.replayed !== "boolean" ||
    typeof body.correlation_id !== "string" ||
    typeof body.decided_at !== "string" ||
    !Number.isFinite(Date.parse(body.decided_at)) ||
    !["REGISTERED", "CANCELLED", null].includes(body.registration_status) ||
    !["NOT_ARRIVED", "INSIDE", "LEFT", null].includes(body.attendance_status) ||
    !(
      (body.decision === "ACCEPTED" &&
        body.reason === "ACCEPTED" &&
        body.registration_status === "REGISTERED" &&
        body.attendance_status ===
          (command.direction === "CHECK_OUT" ? "LEFT" : "INSIDE")) ||
      (body.decision === "REJECTED" &&
        [
          "INVALID_CREDENTIAL",
          "EXPIRED_CREDENTIAL",
          "CANCELLED_CREDENTIAL",
          "ALREADY_CHECKED_IN",
          "CHECKOUT_DISABLED",
          "NOT_CHECKED_IN",
          "ALREADY_CHECKED_OUT",
          "REGISTRATION_UNAVAILABLE",
        ].includes(body.reason))
    )
  )
    throw new ProofError("INVALID_RESPONSE", 0);
  // Explicit allowlist: never propagate arbitrary server fields to the UI.
  return {
    scan_id: body.scan_id,
    event_id: body.event_id,
    gate_id: body.gate_id,
    decision: body.decision,
    reason: body.reason,
    registration_status: body.registration_status,
    attendance_status: body.attendance_status,
    decided_at: body.decided_at,
    replayed: body.replayed,
    correlation_id: body.correlation_id,
  };
}
