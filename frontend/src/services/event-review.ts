import { ProofError } from "./proof";
export interface Task {
  id: string;
  event_id: string;
  assigned_volunteer_id: string;
  title: string;
  instructions: string;
  location: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  cancelled_by_user_id: string | null;
  cancellation_reason: string | null;
}
export interface TaskList {
  event: { event_id: string; event_name: string };
  items: Task[];
  next_cursor: string | null;
}
export interface TaskResponse {
  task: Task;
}
export interface Results {
  event_id: string;
  event_state: "COMPLETED";
  total_registrations: number;
  cancelled_registrations: number;
  accepted_check_ins: number;
  attendance_rate_percentage: number | null;
  gate_check_ins: { gate_id: string; accepted_check_ins: number }[];
  certificate_eligible_count: number;
  certificate_issued_count: number;
  certificate_revoked_count: number;
  certificate_delivery_counts: Record<
    "NOT_REQUIRED" | "PENDING" | "SENDING" | "SENT" | "UNKNOWN" | "FAILED",
    number
  >;
  data_limitations: string[];
  as_of: string;
}
export interface AuditRecord {
  id: string;
  event_id: string;
  actor: { kind: string; id: string | null };
  action: string;
  target_type: string;
  target_id: string | null;
  outcome: string;
  occurred_at: string;
  correlation_id: string;
}
export interface AuditList {
  items: AuditRecord[];
  next_cursor: string | null;
}
export interface Command {
  method: "POST" | "PATCH";
  body: Record<string, unknown>;
  csrf: string;
  key: string;
  etag?: string;
}
export const tasksPath = (eventId: string) =>
  `/events/${encodeURIComponent(eventId)}/volunteer-tasks`;
export async function reviewRequest<T>(
  path: string,
  signal: AbortSignal,
  command?: Command,
): Promise<{ data: T; etag: string | null }> {
  const origin = import.meta.env.VITE_API_ORIGIN;
  if (!origin) throw new ProofError("NETWORK", 0);
  const controller = new AbortController(),
    abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 15000);
  try {
    const response = await fetch(new URL(`/api/v1${path}`, origin), {
      method: command?.method ?? "GET",
      credentials: "include",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
      headers: command
        ? {
            "Content-Type": "application/json",
            "X-CSRF-Token": command.csrf,
            "Idempotency-Key": command.key,
            ...(command.etag ? { "If-Match": command.etag } : {}),
          }
        : {},
      body: command ? JSON.stringify(command.body) : undefined,
    });
    const data = (await response.json()) as T & { code?: string };
    if (!response.ok)
      throw new ProofError(data.code ?? "UNKNOWN", response.status);
    return { data, etag: response.headers.get("ETag") };
  } catch (error) {
    if (error instanceof ProofError) throw error;
    throw new ProofError("NETWORK", 0);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
export function reviewMessage(error: unknown) {
  const code = error instanceof ProofError ? error.code : "UNKNOWN";
  const messages: Record<string, string> = {
    UNAUTHENTICATED: "Your session expired. Verify again.",
    EVENT_NOT_FOUND: "This event is unavailable in your current scope.",
    TASK_NOT_FOUND:
      "This task is unavailable, cancelled or no longer assigned to you.",
    FORBIDDEN: "You are not authorized for this action.",
    VERSION_CONFLICT: "The task changed. Refresh before making a new command.",
    INVALID_TRANSITION: "This task cannot make that transition.",
    TASK_NOT_EDITABLE: "Completed and cancelled tasks cannot be edited.",
    TASK_NOT_REASSIGNABLE: "Only assigned tasks may be reassigned.",
    VOLUNTEER_NOT_ASSIGNABLE:
      "Choose an account with a current Volunteer role for this event.",
    RESULTS_NOT_COMPLETED:
      "Results are available after the event is completed.",
    VALIDATION: "Check the fields, lengths and time range.",
    IDEMPOTENCY_CONFLICT:
      "This command identity cannot be reused with a different request.",
    NETWORK: "The outcome is unknown. Retry the same command or refresh.",
    DEPENDENCY_UNAVAILABLE:
      "Service unavailable. A write outcome may be unknown; retry the same command or reconcile.",
  };
  return (
    messages[code] ??
    "The request could not be completed. Refresh and try again."
  );
}
export const outcomeUnknown = (e: unknown) =>
  e instanceof ProofError && (e.status === 0 || e.status >= 500);
