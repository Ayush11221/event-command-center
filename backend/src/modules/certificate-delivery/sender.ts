import nodemailer from "nodemailer";
import type { FoundationConfig } from "../../config/foundation.js";
export type SendOutcome = "SENT" | "FAILED" | "UNKNOWN";
export interface CertificateSender {
  send(input: {
    attemptId: string;
    recipient: string;
    certificateNumber: string;
    pdf: Uint8Array;
  }): Promise<SendOutcome>;
}
export function smtpFailure(error: unknown): SendOutcome {
  const row = error as {
    responseCode?: number;
    command?: string;
    code?: string;
  };
  // An explicit SMTP rejection is definite. Timeouts/disconnects are ambiguous.
  return typeof row?.responseCode === "number" &&
    row.responseCode >= 400 &&
    row.responseCode < 600
    ? "FAILED"
    : "UNKNOWN";
}
export function createCertificateSender(
  config: FoundationConfig,
): CertificateSender {
  const smtp = config.smtpUrl
    ? nodemailer.createTransport({
        url: config.smtpUrl,
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
        pool: false,
      } as import("nodemailer/lib/smtp-transport/index.js").Options)
    : null;
  return {
    async send(input) {
      if (!smtp || !config.smtpFrom) return "FAILED";
      try {
        const result = await smtp.sendMail({
          from: config.smtpFrom,
          to: input.recipient,
          messageId: `<certificate-${input.attemptId}@event-command-center.invalid>`,
          subject: "Your event certificate",
          text: "Your issued event certificate is attached.",
          attachments: [
            {
              filename: `certificate-${input.certificateNumber}.pdf`,
              content: Buffer.from(input.pdf),
              contentType: "application/pdf",
            },
          ],
        });
        return result.accepted?.length === 1 ? "SENT" : "FAILED";
      } catch (error) {
        return smtpFailure(error);
      }
    },
  };
}
