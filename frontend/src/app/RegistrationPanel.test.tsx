import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProofError, challenge, verify } from "../services/proof";
import {
  participantSession,
  registrationRequest,
  type Registration,
} from "../services/registrations";
import { RegistrationPanel } from "./RegistrationPanel";
vi.mock("../services/registrations", () => ({
  participantSession: vi.fn(),
  registrationRequest: vi.fn(),
}));
vi.mock("../services/proof", async (original) => ({
  ...(await original<typeof import("../services/proof")>()),
  challenge: vi.fn(),
  verify: vi.fn(),
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
  fireEvent.click(
    screen.getByRole("button", { name: "Manage my registration" }),
  );
  await screen.findByRole("button", { name: "Confirm registration" });
}
describe("participant registration flow", () => {
  it("does not fetch identity or registration before intent", () => {
    render(<RegistrationPanel eventId="event" />);
    expect(participantSession).not.toHaveBeenCalled();
    expect(mock).not.toHaveBeenCalled();
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
    await screen.findByText("Registration confirmed.");
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
    fireEvent.click(
      screen.getByRole("button", { name: "View my QR credential" }),
    );
    await screen.findByRole("img", { name: "Your registration QR credential" });
    expect(
      screen.getByRole("link", { name: "Recover this registration" }),
    ).toHaveAttribute("href", "/registrations/reg");
    fireEvent(window, new Event("pagehide"));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(mock.mock.calls[0][1].aborted).toBe(true);
  });
  it.each([
    ["CAPACITY_FULL", "Registration capacity is full"],
    ["DUPLICATE_ACTIVE", "already have an active registration"],
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
      screen.getByRole("button", { name: "Refresh my registration" }),
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
    await screen.findByText("Registration confirmed.");
    expect(mock.mock.calls[2][2]!.key).toBe(key);
  });
  it("requires cancellation confirmation, clears QR, retains cancelled state and enables re-registration", async () => {
    mock.mockResolvedValue({ registration: row });
    render(<RegistrationPanel eventId="event" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Manage my registration" }),
    );
    await screen.findByRole("button", { name: "Cancel my registration" });
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel my registration" }),
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
      /Registration cancelled\. Your credential is invalidated/,
    );
    expect(
      screen.getByRole("button", { name: "Register again" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "View my QR credential" }),
    ).not.toBeInTheDocument();
  });
  it.each([401, 403, 404])(
    "clears ownership/credential after %s scope or proof loss",
    async (status) => {
      mock.mockResolvedValue({ registration: row });
      render(<RegistrationPanel registrationId="reg" />);
      await screen.findByRole("button", { name: "View my QR credential" });
      mock.mockRejectedValueOnce(new ProofError("FORBIDDEN", status));
      fireEvent.click(
        screen.getByRole("button", { name: "View my QR credential" }),
      );
      await screen.findByRole("alert");
      expect(screen.queryByText("REGISTERED")).not.toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Cancel my registration" }),
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
    await screen.findByRole("button", { name: "Cancel my registration" });
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel my registration" }),
    );
    mock.mockRejectedValueOnce(
      new ProofError("FRESH_GUEST_PROOF_REQUIRED", 403),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm cancellation" }),
    );
    await screen.findByText(
      "Verify the same guest contact again before cancelling.",
    );
    expect(
      screen.queryByRole("button", { name: "View my QR credential" }),
    ).not.toBeInTheDocument();
  });
  it("uses existing guest OTP flow and recovers registration after verification", async () => {
    vi.mocked(participantSession).mockRejectedValueOnce(
      new ProofError("UNAUTHENTICATED", 401),
    );
    render(<RegistrationPanel registrationId="reg" />);
    await screen.findByLabelText("Email address");
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "guest@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Send verification code" }),
    );
    await screen.findByLabelText("Verification code");
    expect(challenge).toHaveBeenCalledWith(
      "guest",
      "EMAIL",
      "guest@example.com",
    );
    fireEvent.change(screen.getByLabelText("Verification code"), {
      target: { value: "123456" },
    });
    mock.mockResolvedValue({ registration: row });
    fireEvent.click(screen.getByRole("button", { name: "Verify identity" }));
    await screen.findByRole("button", { name: "View my QR credential" });
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
    fireEvent.click(
      screen.getByRole("button", { name: "Manage my registration" }),
    );
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
      screen.queryByRole("button", { name: "View my QR credential" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cancel my registration" }),
    ).not.toBeInTheDocument();
  });
});
