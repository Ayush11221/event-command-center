import { ProofError } from "./proof";

export class CertificateError extends ProofError {
  constructor(
    code: string,
    status: number,
    public readonly retryable?: boolean,
  ) {
    super(code, status);
  }
}

export function certificateOutcomeUnknown(error: unknown) {
  return (
    error instanceof ProofError &&
    (error.status === 0 ||
      (error.status === 503 &&
        !(error instanceof CertificateError && error.retryable === false)))
  );
}

export interface CertificateMetadata {
  certificate_id: string;
  certificate_number: string;
  status: "ISSUED" | "REVOKED";
  template_id: string;
  template_version: number;
  font_id: string;
  eligibility_rule_version: string;
  issued_at: string;
  revoked_at: string | null;
  issued_by_user_id?: string;
  revoked_by_user_id?: string | null;
  revoke_reason?: string | null;
  attendance_transition_id?: string;
  first_accepted_check_in_at?: string;
  pdf_sha256?: string;
}
export interface IssueWork {
  issue_work_id: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  generation_cycle: number;
  attempt_count: number;
  retry_at: string | null;
  last_error_code: string | null;
}
export interface CertificateStatus {
  event_id: string;
  registration_id: string;
  state: "NOT_ELIGIBLE" | "ELIGIBLE" | "ISSUED" | "REVOKED";
  eligibility_rule_version: string;
  recipient_name_set: boolean;
  certificate: CertificateMetadata | null;
}
export interface OwnerCertificateStatus extends CertificateStatus {
  recipient_name: string | null;
  recipient_name_updated_at: string | null;
  recipient_name_locked: boolean;
}
export interface StaffCertificateStatus extends CertificateStatus {
  issue_work: IssueWork | null;
}
export interface Catalogue {
  templates: { template_id: string; template_version: number }[];
  fonts: { font_id: string }[];
}
export interface CertificateCommand {
  csrf: string;
  body: Record<string, unknown>;
  key?: string;
}
async function response(
  path: string,
  signal: AbortSignal,
  command?: CertificateCommand,
) {
  const origin = import.meta.env.VITE_API_ORIGIN;
  if (!origin) throw new ProofError("NETWORK", 0);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 15000);
  try {
    const result = await fetch(new URL(`/api/v1${path}`, origin), {
      method: command ? "POST" : "GET",
      credentials: "include",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
      headers: command
        ? {
            "Content-Type": "application/json",
            "X-CSRF-Token": command.csrf,
            ...(command.key ? { "Idempotency-Key": command.key } : {}),
          }
        : {},
      body: command ? JSON.stringify(command.body) : undefined,
    });
    if (!result.ok) {
      const body = (await result.json()) as {
        code?: string;
        retryable?: boolean;
      };
      throw new CertificateError(
        body.code ?? "UNKNOWN",
        result.status,
        body.retryable,
      );
    }
    const type = result.headers.get("Content-Type") ?? "";
    if (type.includes("application/pdf")) {
      const blob = await result.blob();
      if (blob.size < 1 || blob.size > 1048576)
        throw new ProofError("INVALID_RESPONSE", 0);
      return blob;
    }
    return (await result.json()) as unknown;
  } catch (error) {
    if (error instanceof ProofError) throw error;
    throw new ProofError("NETWORK", 0);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
export async function certificateRequest<T>(
  path: string,
  signal: AbortSignal,
  command?: CertificateCommand,
): Promise<T> {
  return (await response(path, signal, command)) as T;
}
export const ownerCertificatePath = (id: string) =>
  `/registrations/${encodeURIComponent(id)}/certificate`;
export const staffCertificatePath = (eventId: string, id: string) =>
  `/events/${encodeURIComponent(eventId)}/registrations/${encodeURIComponent(id)}/certificate`;
export function certificateMessage(error: unknown) {
  const code = error instanceof ProofError ? error.code : "NETWORK";
  const messages: Record<string, string> = {
    NAME_MISSING:
      "The registration owner must set a recipient name before preview or issue.",
    NAME_NOT_RENDERABLE:
      "Use Latin letters supported by the standard fonts, spaces, apostrophes, hyphens or periods.",
    NAME_LOCKED: "The recipient name is permanently locked after issuance.",
    ALREADY_CANCELLED:
      "A cancelled registration cannot change its recipient name.",
    NOT_ELIGIBLE: "A matching accepted check-in is required before issue.",
    EVENT_STATE_NOT_ALLOWED:
      "Preview and issue require a Live or Completed event.",
    ISSUE_IN_PROGRESS: "An issue is already in progress. Refresh its status.",
    ALREADY_ISSUED: "A certificate already exists. Reissue is unavailable.",
    VERSION_CONFLICT:
      "The name or rendering data changed. Refresh and try again.",
    CERTIFICATE_NOT_FOUND: "The certificate is unavailable or revoked.",
    UNAUTHENTICATED: "Your verification expired. Verify again.",
    REGISTRATION_NOT_FOUND:
      "This registration is unavailable in your current scope.",
    EVENT_NOT_FOUND: "This event is unavailable in your current scope.",
    VALIDATION: "Check the input and supported certificate text.",
    DEPENDENCY_UNAVAILABLE:
      "The service is unavailable. Refresh status before retrying.",
    IDEMPOTENCY_CONFLICT:
      "This retry differs from its original command. Refresh status.",
    NETWORK:
      "The outcome is unknown. Retry the same command or refresh status.",
  };
  return (
    messages[code] ??
    "The certificate action could not be completed. Refresh status."
  );
}
