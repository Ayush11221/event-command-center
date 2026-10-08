import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  challenge,
  currentActor,
  currentGuest,
  logout,
  ProofError,
  verify,
} from "../services/proof";
import { ParticipantProof } from "./ParticipantProof";
vi.mock("../services/proof", async (original) => ({
  ...(await original<typeof import("../services/proof")>()),
  challenge: vi.fn(),
  verify: vi.fn(),
  currentActor: vi.fn(),
  currentGuest: vi.fn(),
  logout: vi.fn(),
}));
const actor = {
  user_id: "account",
  organizer_capable: false,
  assignments: [],
  csrf_token: "account-csrf",
};
const anonymous = () => new ProofError("UNAUTHENTICATED", 401);
beforeEach(() => {
  vi.mocked(currentActor).mockRejectedValue(anonymous());
  vi.mocked(challenge).mockResolvedValue();
  vi.mocked(verify).mockResolvedValue();
  vi.mocked(currentGuest).mockResolvedValue({
    status: "verified",
    csrf_token: "guest",
  });
  vi.mocked(logout).mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
async function chooseGuestAndSend() {
  fireEvent.click(
    screen.getByRole("button", { name: "Continue without an account" }),
  );
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: "guest@example.com" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  });
}
describe("P1-A participant identity choices", () => {
  it("offers equal account and guest choices without starting verification", () => {
    render(<ParticipantProof onVerified={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Sign in or create an account" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Continue without an account" }),
    ).toBeVisible();
    expect(challenge).not.toHaveBeenCalled();
    expect(
      screen.queryByLabelText(/identity|proof type/i),
    ).not.toBeInTheDocument();
  });
  it("verifies a guest without creating an account or merging identities", async () => {
    const done = vi.fn();
    render(<ParticipantProof onVerified={done} />);
    await chooseGuestAndSend();
    fireEvent.paste(screen.getByLabelText("Verification code"), {
      clipboardData: { getData: () => "123456" },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Verify and continue" }),
      );
    });
    expect(challenge).toHaveBeenCalledWith(
      "guest",
      "EMAIL",
      "guest@example.com",
    );
    expect(verify).toHaveBeenCalledWith(
      "guest",
      "EMAIL",
      "guest@example.com",
      "123456",
    );
    expect(done).toHaveBeenCalledWith("guest");
    expect(logout).not.toHaveBeenCalled();
  });
  it("supports phone verification only for the guest path", async () => {
    render(<ParticipantProof onVerified={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Continue without an account" }),
    );
    fireEvent.change(screen.getByLabelText("Receive your code by"), {
      target: { value: "PHONE" },
    });
    const phone = screen.getByLabelText("Phone number");
    expect(phone).toHaveAttribute("type", "tel");
    fireEvent.change(phone, { target: { value: "+919876543210" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    expect(challenge).toHaveBeenCalledWith("guest", "PHONE", "+919876543210");
    expect(screen.getByText("•••• 3210")).toBeVisible();
    expect(document.body.textContent).not.toContain("+919876543210");
  });
  it("requires explicit logout before sending a guest code for a signed-in account", async () => {
    vi.mocked(currentActor).mockResolvedValue(actor);
    render(<ParticipantProof onVerified={vi.fn()} />);
    await chooseGuestAndSend();
    expect(screen.getByText("You're signed in to an account")).toBeVisible();
    expect(challenge).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
    vi.mocked(currentActor).mockRejectedValue(anonymous());
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "Sign out and continue without an account",
        }),
      );
    });
    expect(logout).toHaveBeenCalledWith("account-csrf");
    expect(challenge).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    expect(challenge).toHaveBeenCalledWith(
      "guest",
      "EMAIL",
      "guest@example.com",
    );
  });
  it("lets the user keep their account without guest verification", async () => {
    vi.mocked(currentActor).mockResolvedValue(actor);
    const done = vi.fn();
    render(<ParticipantProof onVerified={done} />);
    await chooseGuestAndSend();
    fireEvent.click(
      screen.getByRole("button", { name: "Keep using my account" }),
    );
    expect(done).toHaveBeenCalledWith("account");
    expect(verify).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });
  it.each([
    new ProofError("DEPENDENCY_UNAVAILABLE", 503),
    new ProofError("SESSION_EXPIRED", 401),
  ])(
    "does not treat unavailable/expired account access as permission to switch",
    async (failure) => {
      vi.mocked(currentActor).mockRejectedValue(failure);
      render(<ParticipantProof onVerified={vi.fn()} />);
      await chooseGuestAndSend();
      expect(screen.getByRole("alert")).toBeVisible();
      expect(challenge).not.toHaveBeenCalled();
    },
  );
  it("keeps guest verification blocked if logout fails", async () => {
    vi.mocked(currentActor).mockResolvedValue(actor);
    vi.mocked(logout).mockRejectedValue(
      new ProofError("DEPENDENCY_UNAVAILABLE", 503),
    );
    render(<ParticipantProof onVerified={vi.fn()} />);
    await chooseGuestAndSend();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "Sign out and continue without an account",
        }),
      );
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "couldn't verify your access",
    );
    expect(challenge).not.toHaveBeenCalled();
  });
  it("rechecks account presence before guest verification when another tab signs in", async () => {
    render(<ParticipantProof onVerified={vi.fn()} />);
    await chooseGuestAndSend();
    vi.mocked(currentActor).mockResolvedValue(actor);
    fireEvent.change(screen.getByLabelText("Verification code"), {
      target: { value: "123456" },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Verify and continue" }),
      );
    });
    expect(screen.getByText("You're signed in to an account")).toBeVisible();
    expect(verify).not.toHaveBeenCalled();
  });
});
