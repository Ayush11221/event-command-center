import type { FoundationConfig } from "../../config/foundation.js";
import { createBrevoEmailSender } from "../email/brevo.js";
import type { CertificateSender } from "./sender.js";

export function createBrevoSender(config: FoundationConfig): CertificateSender {
  const email = createBrevoEmailSender(config);
  return {
    async send(input) {
      if (!email.available()) return "FAILED";
      try {
        return await email.send({
          recipient: input.recipient,
          subject: "Your event certificate",
          text: "Your issued event certificate is attached.",
          attachments: [
            {
              name: `certificate-${input.certificateNumber}.pdf`,
              content: Buffer.from(input.pdf).toString("base64"),
            },
          ],
          // Brevo assigns Message-ID itself; this correlates the durable attempt.
          headers: {
            "X-Mailin-custom": `certificate-attempt:${input.attemptId}`,
          },
        });
      } catch {
        return "FAILED";
      }
    },
  };
}
