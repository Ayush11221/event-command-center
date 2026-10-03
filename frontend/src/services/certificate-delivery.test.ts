import { expect, it } from "vitest";
import { batchPath, deliveryExplanation } from "./certificate-delivery";
it("encodes event scope and distinguishes submission from recipient receipt", () => {
  expect(batchPath("event/other")).toBe(
    "/events/event%2Fother/certificate-batches",
  );
  expect(deliveryExplanation("SENT", null)).toContain(
    "recipient delivery is not confirmed",
  );
  expect(deliveryExplanation("UNKNOWN", null)).toContain(
    "resend is unavailable",
  );
  expect(deliveryExplanation("NOT_REQUIRED", "CERTIFICATE_REVOKED")).toContain(
    "Revocation",
  );
  expect(deliveryExplanation("FAILED", null)).toContain(
    "certificate remains unchanged",
  );
});
