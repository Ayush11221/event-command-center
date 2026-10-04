import { randomUUID } from "node:crypto";
import { ContactType } from "@prisma/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createOtpSender } from "./sender.js";

const smtp = vi.hoisted(() => ({
  sendMail: vi.fn(),
  createTransport: vi.fn(),
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: smtp.createTransport },
}));
const config = {
  databaseUrl: "synthetic",
  jwtSecret: Buffer.alloc(32),
  contactKey: Buffer.alloc(32),
  otpKey: Buffer.alloc(32),
  cookieSecure: false,
  smtpUrl: "smtp://127.0.0.1:1025",
  smtpFrom: "platform@example.invalid",
};
const brevo = {
  ...config,
  emailTransport: "brevo_api" as const,
  brevoApiUrl: "https://api.brevo.com/v3/smtp/email",
  brevoApiKey: `synthetic-${randomUUID()}`,
};
const destination = "recipient@example.invalid";
const code = "123456";
const text = `Your Event Command Center verification code is ${code}. It expires in 5 minutes.`;
beforeEach(() => {
  vi.clearAllMocks();
  smtp.createTransport.mockReturnValue({ sendMail: smtp.sendMail });
  smtp.sendMail.mockResolvedValue({ accepted: [destination] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each([undefined, "smtp"] as const)(
  "preserves default/explicit SMTP OTP email without using Brevo (%s)",
  async (emailTransport) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const sender = createOtpSender({ ...brevo, emailTransport });
    expect(sender.available(ContactType.EMAIL)).toBe(true);
    await expect(
      sender.send(ContactType.EMAIL, destination, code),
    ).resolves.toBeUndefined();
    expect(smtp.createTransport).toHaveBeenCalledWith(config.smtpUrl);
    expect(smtp.sendMail).toHaveBeenCalledWith({
      from: config.smtpFrom,
      to: destination,
      subject: "Your verification code",
      text,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  },
);
it("preserves SMTP rejection and missing-configuration behavior", async () => {
  smtp.sendMail.mockRejectedValueOnce(new Error("synthetic SMTP rejection"));
  await expect(
    createOtpSender(config).send(ContactType.EMAIL, destination, code),
  ).rejects.toThrow("synthetic SMTP rejection");
  const sender = createOtpSender({ ...config, smtpUrl: undefined });
  expect(sender.available(ContactType.EMAIL)).toBe(false);
  await expect(
    sender.send(ContactType.EMAIL, destination, code),
  ).rejects.toThrow("Sender unavailable");
});
it("sends the existing OTP content over HTTPS using the configured sender and secret header", async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      Response.json(
        { messageId: "<synthetic@brevo.invalid>" },
        { status: 201 },
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  const sender = createOtpSender(brevo);
  expect(sender.available(ContactType.EMAIL)).toBe(true);
  await expect(
    sender.send(ContactType.EMAIL, destination, code),
  ).resolves.toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(smtp.createTransport).not.toHaveBeenCalled();
  const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe(brevo.brevoApiUrl);
  expect(request.method).toBe("POST");
  expect(request.redirect).toBe("manual");
  const headers = new Headers(request.headers);
  expect(headers.get("api-key") === brevo.brevoApiKey).toBe(true);
  expect(headers.get("content-type")).toBe("application/json");
  expect(JSON.parse(request.body as string)).toEqual({
    sender: { email: config.smtpFrom },
    to: [{ email: destination }],
    subject: "Your verification code",
    textContent: text,
  });
  expect((request.body as string).includes(brevo.brevoApiKey)).toBe(false);
  expect(request.signal?.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
it.each([400, 401, 403, 429, 408, 500, 503, 200, 202, 307])(
  "maps response %s to the existing OTP error boundary without fallback or retry",
  async (status) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("synthetic provider response", { status }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      createOtpSender(brevo).send(ContactType.EMAIL, destination, code),
    ).rejects.toThrow("OTP email submission failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(smtp.createTransport).not.toHaveBeenCalled();
  },
);
it.each([
  "not JSON",
  "{}",
  '{"messageId":""}',
  '{"messageIds":["one","two"]}',
  "x".repeat(8193),
])("does not report an unexpected acknowledgement as success", async (body) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(body, { status: 201 })),
  );
  await expect(
    createOtpSender(brevo).send(ContactType.EMAIL, destination, code),
  ).rejects.toThrow("OTP email submission failed");
});
it("does not propagate network exception details or retry an uncertain submission", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValue(
      new Error(`synthetic ${brevo.brevoApiKey} ${destination} ${code}`),
    );
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    createOtpSender(brevo).send(ContactType.EMAIL, destination, code),
  ).rejects.toThrow("OTP email submission failed");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(smtp.createTransport).not.toHaveBeenCalled();
});
it("aborts at ten seconds and reports a generic failure without retries", async () => {
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
  const result = createOtpSender(brevo).send(
    ContactType.EMAIL,
    destination,
    code,
  );
  const assertion = expect(result).rejects.toThrow(
    "OTP email submission failed",
  );
  await vi.advanceTimersByTimeAsync(9999);
  expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await assertion;
  expect(signal?.aborted).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it.each(["brevoApiUrl", "brevoApiKey", "smtpFrom"] as const)(
  "is unavailable with missing %s even when SMTP is configured",
  async (field) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const sender = createOtpSender({ ...brevo, [field]: undefined });
    expect(sender.available(ContactType.EMAIL)).toBe(false);
    await expect(
      sender.send(ContactType.EMAIL, destination, code),
    ).rejects.toThrow("Sender unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(smtp.createTransport).not.toHaveBeenCalled();
  },
);
it("keeps PHONE on its existing gateway when email uses Brevo", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const gateway = { sendSms: vi.fn().mockResolvedValue(undefined) };
  const sender = createOtpSender(brevo, gateway);
  expect(sender.available(ContactType.PHONE)).toBe(true);
  await sender.send(ContactType.PHONE, "+15551234567", code);
  expect(gateway.sendSms).toHaveBeenCalledWith("+15551234567", text);
  expect(fetchMock).not.toHaveBeenCalled();
});
