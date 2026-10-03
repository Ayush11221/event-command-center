export type DeliveryState =
  "NOT_REQUIRED" | "PENDING" | "SENDING" | "SENT" | "FAILED" | "UNKNOWN";
export interface Delivery {
  delivery_id: string;
  certificate_id: string;
  status: DeliveryState;
  reason_code: string | null;
  attempt_count: number;
  max_attempts: number;
  created_at: string;
  updated_at: string;
  last_attempt_at: string | null;
  sent_at: string | null;
}
export interface Batch {
  batch_id: string;
  event_id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "PARTIAL_FAILED" | "FAILED";
  template_id: string;
  template_version: number;
  font_id: string;
  selected_count: number;
  eligible_count: number;
  generated_count: number;
  already_satisfied_count: number;
  successful_count: number;
  failed_count: number;
  pending_count: number;
  delivery_counts: {
    not_required: number;
    pending: number;
    sending: number;
    sent: number;
    unknown: number;
    failed: number;
  };
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}
export interface BatchItem {
  registration_id: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  issue_work_id: string | null;
  certificate_id: string | null;
  result_code: string | null;
}
export const batchPath = (eventId: string) =>
  `/events/${encodeURIComponent(eventId)}/certificate-batches`;
export const deliveryExplanation = (
  status: DeliveryState,
  reason: string | null,
) =>
  status === "SENT"
    ? "Accepted by the email server for submission; recipient delivery is not confirmed."
    : status === "UNKNOWN"
      ? "Submission outcome is uncertain. Held for reconciliation; resend is unavailable."
      : status === "NOT_REQUIRED"
        ? reason === "CERTIFICATE_REVOKED"
          ? "Revocation prevented email submission."
          : "No verified deliverable email is available."
        : status === "FAILED"
          ? "Email submission failed. The issued certificate remains unchanged."
          : "Email submission is pending. Certificate issuance is tracked separately.";
