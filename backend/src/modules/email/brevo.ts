import type { FoundationConfig } from "../../config/foundation.js";

export type EmailSendOutcome = "SENT" | "FAILED" | "UNKNOWN";
export interface BrevoEmail {
  recipient: string;
  subject: string;
  text: string;
  attachments?: { name: string; content: string }[];
  headers?: Record<string, string>;
}

// Below the certificate worker's 15-second deadline and 30-second claim lease.
const timeoutMs = 10_000;
const maxResponseBytes = 8192;

async function acceptedMessage(response: Response): Promise<boolean> {
  if (!response.body) return false;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) return false;
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) return false;
    const row = body as { messageId?: unknown; messageIds?: unknown };
    return (
      typeof row.messageId === "string" &&
      row.messageId.trim().length > 0 &&
      row.messageId.length <= 998 &&
      !/[\r\n]/.test(row.messageId) &&
      row.messageIds === undefined
    );
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createBrevoEmailSender(config: FoundationConfig) {
  const available = () =>
    Boolean(config.brevoApiUrl && config.brevoApiKey && config.smtpFrom);
  return {
    available,
    async send(input: BrevoEmail): Promise<EmailSendOutcome> {
      if (!available()) return "FAILED";
      let payload: string;
      try {
        payload = JSON.stringify({
          sender: { email: config.smtpFrom },
          to: [{ email: input.recipient }],
          subject: input.subject,
          textContent: input.text,
          ...(input.attachments ? { attachment: input.attachments } : {}),
          ...(input.headers ? { headers: input.headers } : {}),
        });
      } catch {
        return "FAILED";
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(config.brevoApiUrl!, {
          method: "POST",
          headers: {
            "api-key": config.brevoApiKey!,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: payload,
          signal: controller.signal,
          // Never forward the API key or private payload to a redirect target.
          redirect: "manual",
        });
        if (response.status !== 201) {
          void response.body?.cancel().catch(() => {});
          // 408 and 5xx may follow submission. Never retry at this layer.
          return response.status >= 400 &&
            response.status < 500 &&
            response.status !== 408
            ? "FAILED"
            : "UNKNOWN";
        }
        return (await acceptedMessage(response)) ? "SENT" : "UNKNOWN";
      } catch {
        // No provider bodies/errors, credentials, recipient or OTP data escape.
        return "UNKNOWN";
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
