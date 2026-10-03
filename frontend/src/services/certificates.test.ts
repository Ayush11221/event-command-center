import { afterEach, describe, expect, it, vi } from "vitest";
import {
  certificateRequest,
  ownerCertificatePath,
  staffCertificatePath,
  certificateOutcomeUnknown,
  CertificateError,
} from "./certificates";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("Slice 9 browser API boundary", () => {
  it.each([undefined, false])(
    "distinguishes unknown 503 from terminal generation failure (retryable=%s)",
    async (retryable) => {
      vi.stubEnv("VITE_API_ORIGIN", "http://127.0.0.1:3000");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              code: "DEPENDENCY_UNAVAILABLE",
              ...(retryable !== undefined ? { retryable } : {}),
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          ),
        ),
      );
      let failure: unknown;
      try {
        await certificateRequest(
          staffCertificatePath("event", "registration"),
          new AbortController().signal,
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(CertificateError);
      expect(certificateOutcomeUnknown(failure)).toBe(retryable !== false);
    },
  );
  it("sends closed name payload, cookies, CSRF and original key only to Node", async () => {
    vi.stubEnv("VITE_API_ORIGIN", "http://127.0.0.1:3000");
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ recipient_name_set: true }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    await certificateRequest(
      ownerCertificatePath("registration") + "/recipient-name",
      new AbortController().signal,
      { csrf: "csrf", key: "same-key", body: { recipient_name: "Alice" } },
    );
    const [url, init] = fetcher.mock.calls[0];
    expect(url.toString()).toBe(
      "http://127.0.0.1:3000/api/v1/registrations/registration/certificate/recipient-name",
    );
    expect(init).toMatchObject({
      credentials: "include",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { "X-CSRF-Token": "csrf", "Idempotency-Key": "same-key" },
      body: '{"recipient_name":"Alice"}',
    });
  });
  it("preview omits idempotency and handles protected binary responses", async () => {
    vi.stubEnv("VITE_API_ORIGIN", "http://127.0.0.1:3000");
    const fetcher = vi.fn().mockResolvedValue(
      new Response("%PDF-preview", {
        headers: { "Content-Type": "application/pdf" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const blob = await certificateRequest<Blob>(
      staffCertificatePath("event", "registration") + "/preview",
      new AbortController().signal,
      {
        csrf: "csrf",
        body: { template_id: "classic", template_version: 1, font_id: "sans" },
      },
    );
    expect(blob.size).toBeGreaterThan(0);
    expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty(
      "Idempotency-Key",
    );
  });
  it("preserves stable denied-artifact errors", async () => {
    vi.stubEnv("VITE_API_ORIGIN", "http://127.0.0.1:3000");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "CERTIFICATE_NOT_FOUND" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await expect(
      certificateRequest(
        ownerCertificatePath("registration") + "/artifact",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: 404, code: "CERTIFICATE_NOT_FOUND" });
  });
});
