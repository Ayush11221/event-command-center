import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProofError,
  challenge,
  verify,
  currentActor,
  currentGuest,
} from "../services/proof";
import {
  participantSession,
  registrationRequest,
  type Registration,
} from "../services/registrations";
import { RegistrationPanel } from "./RegistrationPanel";
import { publicDetailFixture } from "../test/public-event-fixture";
vi.mock("../services/registrations", () => ({
  participantSession: vi.fn(),
  registrationRequest: vi.fn(),
}));
vi.mock("../services/proof", async (original) => ({
  ...(await original<typeof import("../services/proof")>()),
  challenge: vi.fn(),
  verify: vi.fn(),
  currentActor: vi.fn(),
  currentGuest: vi.fn(),
}));
const row: Registration = {
  registration_id: "reg",
  event_id: "event",
  state: "REGISTERED",
  relationship: "own",
  created_at: new Date().toISOString(),
  cancelled_at: null,
  event_state: "PUBLISHED",
  cancellation_cutoff_at: new Date(Date.now() + 3600000).toISOString(),
};
const mock = vi.mocked(registrationRequest);
beforeEach(() => {
  vi.mocked(currentActor).mockRejectedValue(
    new ProofError("UNAUTHENTICATED", 401),
  );
  vi.mocked(currentGuest).mockResolvedValue({
    status: "verified",
    csrf_token: "guest",
  });
  vi.mocked(participantSession).mockResolvedValue({
    csrf: "csrf",
    guest: false,
  });
  mock.mockResolvedValue({ registration: null });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
async function open() {
  render(<RegistrationPanel eventId="event" />);
  fireEvent.click(screen.getByRole("button", { name: "Register" }));
  await screen.findByRole("button", { name: "Confirm registration" });
}
describe("participant registration flow", () => {
  it("shows View my registration for an existing owner without creating a duplicate", async () => {
    mock.mockResolvedValue({ registration: row });
    render(<RegistrationPanel eventId="event" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "View my registration" }),
    );
    expect(screen.getByRole("button", { name: "Show entry QR" })).toBeVisible();
    expect(mock.mock.calls.every((call) => call[2] === undefined)).toBe(true);
  });
  it("confirms event name, schedule in the configured timezone, and registration status without showing IDs", async () => {
    const event = {
      ...publicDetailFixture(),
      start_at: "2026-10-08T09:00:00Z",
      end_at: "2026-10-08T11:00:00Z",
      time_zone: "Asia/Kolkata",
    };
    const privateId = "12345678-1234-1234-1234-123456789abc";
    render(<RegistrationPanel eventId="event" event={event} />);
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    await screen.findByRole("button", { name: "Confirm registration" });
    mock.mockResolvedValue({
      registration: { ...row, registration_id: privateId },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm registration" }),
    );
    await screen.findByText("Registration successful.");
    expect(screen.getByRole("heading", { name: event.name })).toBeVisible();
    expect(screen.getByText(/Asia\/Kolkata/)).toHaveTextContent(
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      }).format(new Date(event.start_at)),
    );
    expect(screen.getByText("Registered")).toBeVisible();
    expect(screen.getByRole("button", { name: "Show entry QR" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "View registration" }),
    ).toHaveAttribute("href", `/registrations/${privateId}`);
    expect(document.body.textContent).not.toContain(privateId);
    mock.mockResolvedValue({
      qr_svg:
        '<svg xmlns="http://www.w3.org/2000/svg"><desc>opaque-qr-secret</desc></svg>',
    });
    fireEvent.click(screen.getByRole("button", { name: "Show entry QR" }));
    await screen.findByRole("img", { name: "Your entry QR" });
    expect(document.body.textContent).not.toContain("opaque-qr-secret");
    fireEvent.click(screen.getByRole("button", { name: "Hide entry QR" }));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
  it.each([
    [
      "CANCELLATION_CUTOFF_REACHED",
      "Cancellation is no longer available for this event.",
    ],
    [
      "ALREADY_CHECKED_IN",
      "Your registration can no longer be cancelled after check-in.",
    ],
  ])(
    "explains cancellation %s only after a server rejection",
    async (code, message) => {
      mock.mockResolvedValue({ registration: row });
      render(<RegistrationPanel registrationId="reg" />);
      fireEvent.click(
        await screen.findByRole("button", { name: "Cancel registration" }),
      );
      mock.mockRejectedValueOnce(new ProofError(code, 409));
      fireEvent.click(
        screen.getByRole("button", { name: "Confirm cancellation" }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(
        screen.queryByRole("button", { name: "Cancel registration" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Refresh registration" }),
      ).toBeEnabled();
    },
  );
  it("recovers an authoritative duplicate result without submitting another registration", async () => {
    await open();
    mock
      .mockRejectedValueOnce(new ProofError("DUPLICATE_ACTIVE", 409))
      .mockResolvedValue({ registration: row });
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm registration" }),
    );
    await screen.findByRole("button", { name: "Show entry QR" });
    expect(mock.mock.calls.filter((call) => call[2])).toHaveLength(1);
  });
  it("requires a choice when a different account becomes current", async () => {
    mock.mockResolvedValue({ registration: row });
    render(<RegistrationPanel registrationId="reg" />);
    await screen.findByRole("button", { name: "Show entry QR" });
    vi.mocked(participantSession).mockResolvedValue({
      csrf: "different-account",
      guest: false,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh registration" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your sign-in has changed",
    );
    expect(mock).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Show entry QR" }),
    ).not.toBeInTheDocument();
  });
  it("checks ownership using reads only so the event CTA reflects current state", async () => {
    render(<RegistrationPanel eventId="event" />);
    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(mock.mock.calls[0][2]).toBeUndefined();
    expect(challenge).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });
  it("shows loading and aborts on unmount", async () => {
    vi.mocked(participantSession).mockResolvedValue({
      csrf: "c",
      guest: false,
    });
    mock.mockReturnValue(new Promise(() => {}));
    const view = render(<RegistrationPanel registrationId="reg" />);
    await waitFor(() => expect(mock).toHaveBeenCalled());
    const signal = mock.mock.calls[0][1];
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading registration",
    );
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
  it("registers, confirms current state, displays a private QR and hides it on pagehide", async () => {
    await open();
    mock.mockResolvedValue({ registration: row });
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm registration" }),
    );
    await screen.findByText("Registration successful.");
    expect(mock.mock.calls[1][2]).toEqual({
      csrf: "csrf",
      key: expect.any(String),
    });
    mock.mockResolvedValue({
      credential_id: "cred",
      registration_id: "reg",
      status: "ACTIVE",
      expires_at: null,
      qr_svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    });
    fireEvent.click(screen.getByRole("button", { name: "Show entry QR" }));
    await screen.findByRole("img", { name: "Your entry QR" });
    expect(
      screen.getByRole("link", { name: "View registration" }),
    ).toHaveAttribute("href", "/registrations/reg");
    fireEvent(window, new Event("pagehide"));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(mock.mock.calls[0][1].aborted).toBe(true);
  });
  it.each([
    ["CAPACITY_FULL", "Registration capacity is full"],
    ["REGISTRATION_NOT_OPEN", "not opened yet"],
    ["REGISTRATION_CLOSED", "not accepting registrations"],
    ["EVENT_CANCELLED", "event has been cancelled"],
    ["IDEMPOTENCY_CONFLICT", "retry conflicts"],
  ])("explains %s and offers recovery", async (code, message) => {
    await open();
    mock.mockRejectedValueOnce(new ProofError(code, 409));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm registration" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(
      screen.getByRole("button", { name: "Refresh registration" }),
    ).toBeEnabled();
  });
  it("retries an unknown command result with the same key", async () => {
    await open();
    mock.mockRejectedValueOnce(new ProofError("NETWORK", 0));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm registration" }),
    );
    await screen.findByRole("alert");
    const key = mock.mock.calls[1][2]!.key;
    mock.mockResolvedValue({ registration: row });
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm registration" }),
    );
    await screen.findByText("Registration successful.");
    expect(mock.mock.calls[2][2]!.key).toBe(key);
  });
  it("requires cancellation confirmation, clears QR, retains cancelled state and enables re-registration", async () => {
    mock.mockResolvedValue({ registration: row });
    render(<RegistrationPanel eventId="event" />);
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    await screen.findByRole("button", { name: "Cancel registration" });
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel registration" }),
    );
    expect(mock).toHaveBeenCalledTimes(1);
    mock.mockResolvedValue({
      registration: {
        ...row,
        state: "CANCELLED",
        cancelled_at: new Date().toISOString(),
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm cancellation" }),
    );
    await screen.findByText(
      /Registration cancelled\. Your entry QR no longer works/,
    );
    expect(
      screen.getByRole("button", { name: "Register again" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Show entry QR" }),
    ).not.toBeInTheDocument();
  });
  it.each([401, 403, 404])(
    "clears ownership/credential after %s scope or proof loss",
    async (status) => {
      mock.mockResolvedValue({ registration: row });
      render(<RegistrationPanel registrationId="reg" />);
      await screen.findByRole("button", { name: "Show entry QR" });
      mock.mockRejectedValueOnce(new ProofError("FORBIDDEN", status));
      fireEvent.click(screen.getByRole("button", { name: "Show entry QR" }));
      await screen.findByRole("alert");
      expect(screen.queryByText("Registered")).not.toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Cancel registration" }),
      ).not.toBeInTheDocument();
    },
  );
  it("requests fresh guest OTP for cancellation", async () => {
    vi.mocked(participantSession).mockResolvedValue({
      csrf: "guest",
      guest: true,
    });
    mock.mockResolvedValue({ registration: row });
    render(<RegistrationPanel registrationId="reg" />);
    await screen.findByRole("button", { name: "Cancel registration" });
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel registration" }),
    );
    mock.mockRejectedValueOnce(
      new ProofError("FRESH_GUEST_PROOF_REQUIRED", 403),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm cancellation" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Verify the same email or phone number again to cancel your registration.",
    );
    expect(
      screen.queryByRole("button", { name: "Show entry QR" }),
    ).not.toBeInTheDocument();
  });
  it("uses existing guest OTP flow and recovers registration after verification", async () => {
    vi.mocked(participantSession).mockRejectedValueOnce(
      new ProofError("UNAUTHENTICATED", 401),
    );
    render(<RegistrationPanel registrationId="reg" />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Continue without an account",
      }),
    );
    await screen.findByLabelText("Email address");
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "guest@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByLabelText("Verification code");
    expect(challenge).toHaveBeenCalledWith(
      "guest",
      "EMAIL",
      "guest@example.com",
    );
    fireEvent.change(screen.getByLabelText("Verification code"), {
      target: { value: "123456" },
    });
    vi.mocked(participantSession).mockResolvedValue({
      csrf: "guest",
      guest: true,
    });
    mock.mockResolvedValue({ registration: row });
    fireEvent.click(
      screen.getByRole("button", { name: "Verify and continue" }),
    );
    await screen.findByRole("button", { name: "Show entry QR" });
    expect(verify).toHaveBeenCalledWith(
      "guest",
      "EMAIL",
      "guest@example.com",
      "123456",
    );
  });
  it("transmits PRIVATE access only through the existing request proof argument", async () => {
    render(
      <RegistrationPanel eventId="private" privateProof={() => "proof"} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    await screen.findByRole("button", { name: "Confirm registration" });
    expect(mock.mock.calls[0][3]).toBe("proof");
    expect(document.body.textContent).not.toContain("proof");
  });
  it("shows scoped staff metadata without participant credential or cancellation controls", async () => {
    mock.mockResolvedValue({
      registration: { ...row, relationship: "managed" },
    });
    render(<RegistrationPanel registrationId="reg" />);
    await screen.findByText(/current staff scope permits metadata access/);
    expect(
      screen.queryByRole("button", { name: "Show entry QR" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cancel registration" }),
    ).not.toBeInTheDocument();
  });
});
