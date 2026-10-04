import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createCertificateSender } from "./sender.js";

const config = {
  databaseUrl: "synthetic",
  jwtSecret: Buffer.alloc(32),
  contactKey: Buffer.alloc(32),
  otpKey: Buffer.alloc(32),
  cookieSecure: false,
  emailTransport: "brevo_api" as const,
  brevoApiUrl: "https://api.brevo.com/v3/smtp/email",
  brevoApiKey: `synthetic-${randomUUID()}`,
  smtpFrom: "platform@example.invalid",
};
const input = {
  attemptId: randomUUID(),
  recipient: "recipient@example.invalid",
  certificateNumber: randomUUID(),
  pdf: Buffer.from("stored-pdf"),
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function mockResponse(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
it("submits one HTTPS request with auth, platform sender, original content and inline stored PDF", async () => {
  vi.useFakeTimers();
  const fetchMock = mockResponse(
    Response.json({ messageId: "<synthetic@brevo.invalid>" }, { status: 201 }),
  );
  expect(await createCertificateSender(config).send(input)).toBe("SENT");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [endpoint, request] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(endpoint).toBe(config.brevoApiUrl);
  expect(request.method).toBe("POST");
  expect(request.redirect).toBe("manual");
  const headers = new Headers(request.headers);
  expect(headers.get("api-key") === config.brevoApiKey).toBe(true);
  expect(headers.get("content-type")).toBe("application/json");
  expect(headers.get("accept")).toBe("application/json");
  expect(request.signal).toBeInstanceOf(AbortSignal);
  expect(request.signal?.aborted).toBe(false);
  const body = JSON.parse(request.body as string);
  expect(body).toEqual({
    sender: { email: config.smtpFrom },
    to: [{ email: input.recipient }],
    subject: "Your event certificate",
    textContent: "Your issued event certificate is attached.",
    attachment: [
      {
        name: `certificate-${input.certificateNumber}.pdf`,
        content: Buffer.from(input.pdf).toString("base64"),
      },
    ],
    headers: { "X-Mailin-custom": `certificate-attempt:${input.attemptId}` },
  });
  expect((request.body as string).includes(config.brevoApiKey)).toBe(false);
  expect(body.replyTo).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});
it.each([400, 401, 403, 404, 413, 422, 429])(
  "classifies explicit rejection %s as FAILED without retry or reading the error",
  async (status) => {
    const response = new Response("private provider error", { status });
    const read = vi.spyOn(response, "json");
    const fetchMock = mockResponse(response);
    expect(await createCertificateSender(config).send(input)).toBe("FAILED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
  },
);
it.each([200, 202, 204, 301, 307, 408, 500, 502, 503, 504])(
  "holds uncertain response %s as UNKNOWN without retry",
  async (status) => {
    const fetchMock = mockResponse(new Response(null, { status }));
    expect(await createCertificateSender(config).send(input)).toBe("UNKNOWN");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  },
);
it.each([
  "bad JSON",
  "null",
  "[]",
  "{}",
  '{"messageId":""}',
  '{"messageId":17}',
  '{"messageId":"   "}',
  '{"messageId":"one","messageIds":["one","two"]}',
  JSON.stringify({ messageId: "x".repeat(999) }),
  JSON.stringify({ messageId: "one\r\ntwo" }),
  "x".repeat(8193),
])("holds malformed accepted responses as UNKNOWN", async (body) => {
  mockResponse(new Response(body, { status: 201 }));
  expect(await createCertificateSender(config).send(input)).toBe("UNKNOWN");
});
it("holds disconnected response bodies as UNKNOWN", async () => {
  mockResponse(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("synthetic disconnect"));
        },
      }),
      { status: 201 },
    ),
  );
  expect(await createCertificateSender(config).send(input)).toBe("UNKNOWN");
});
it("does not expose exception content or retry an ambiguous network failure", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValue(
      new Error(`synthetic error ${config.brevoApiKey} ${input.recipient}`),
    );
  vi.stubGlobal("fetch", fetchMock);
  expect(await createCertificateSender(config).send(input)).toBe("UNKNOWN");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("aborts a stalled request at ten seconds and holds UNKNOWN", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const fetchMock = vi.fn(
    (_url, request: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        signal = request.signal!;
        signal.addEventListener(
          "abort",
          () => reject(new Error("synthetic timeout")),
          { once: true },
        );
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const outcome = createCertificateSender(config).send(input);
  await vi.advanceTimersByTimeAsync(9999);
  expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await outcome).toBe("UNKNOWN");
  expect(signal?.aborted).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("keeps the deadline active while reading an accepted response", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, request: RequestInit) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              request.signal!.addEventListener(
                "abort",
                () => controller.error(new Error("synthetic stalled body")),
                { once: true },
              );
            },
          }),
          { status: 201 },
        ),
      ),
    ),
  );
  const outcome = createCertificateSender(config).send(input);
  await vi.advanceTimersByTimeAsync(10000);
  expect(await outcome).toBe("UNKNOWN");
  expect(vi.getTimerCount()).toBe(0);
});
it.each(["brevoApiKey", "brevoApiUrl", "smtpFrom"] as const)(
  "fails before submission when %s is absent",
  async (field) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(
      await createCertificateSender({ ...config, [field]: undefined }).send(
        input,
      ),
    ).toBe("FAILED");
    expect(fetchMock).not.toHaveBeenCalled();
  },
);
it("does not fall back to SMTP after a Brevo failure", async () => {
  mockResponse(new Response(null, { status: 401 }));
  expect(
    await createCertificateSender({
      ...config,
      smtpUrl: "smtp://unused.example.invalid",
    }).send(input),
  ).toBe("FAILED");
});
it("does not use Brevo in explicit SMTP mode", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  expect(
    await createCertificateSender({ ...config, emailTransport: "smtp" }).send(
      input,
    ),
  ).toBe("FAILED");
  expect(fetchMock).not.toHaveBeenCalled();
});
