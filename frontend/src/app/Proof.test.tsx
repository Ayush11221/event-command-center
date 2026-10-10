import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { challenge, currentActor, ProofError, verify } from "../services/proof";
import { ProofEntry } from "./ProofEntry";
import { accountProfile, saveAccountProfile } from "../services/profile";
vi.mock("../services/profile", () => ({
  accountProfile: vi.fn(),
  saveAccountProfile: vi.fn(),
}));
vi.mock("../services/proof", async (original) => ({
  ...(await original<typeof import("../services/proof")>()),
  challenge: vi.fn(),
  verify: vi.fn(),
  currentActor: vi.fn(),
}));
const actor = {
  user_id: "account",
  organizer_capable: false,
  assignments: [],
  csrf_token: "csrf",
};
beforeEach(() => {
  vi.mocked(challenge).mockResolvedValue();
  vi.mocked(verify).mockResolvedValue();
  vi.mocked(currentActor).mockResolvedValue(actor);
  vi.mocked(accountProfile).mockResolvedValue({
    display_name: "Name",
    verified_email: "person@example.com",
    phone_number: "9876543210",
    organization: "College",
    affiliation_id: null,
  });
  vi.mocked(saveAccountProfile).mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});
async function send(email = "person@example.com") {
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: email },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  });
}
async function enterCode() {
  fireEvent.change(screen.getByLabelText("Verification code"), {
    target: { value: "123456" },
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Verify and continue" }),
    );
  });
}
async function saveDetails() {
  await screen.findByLabelText("Full name");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
  });
}
describe("P1-A account verification", () => {
  it("has one account entry, native email validation, and no password or role selector", () => {
    render(<ProofEntry onAccountAuthenticated={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: "Sign in or create an account" }),
    ).toBeVisible();
    const email = screen.getByLabelText("Email address");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(email).toHaveAttribute("inputmode", "email");
    expect(email).toBeRequired();
    fireEvent.change(email, { target: { value: "invalid-address" } });
    expect((email as HTMLInputElement).checkValidity()).toBe(false);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/password|role|proof/i),
    ).not.toBeInTheDocument();
  });
  it.each(["existing@example.com", "new@example.com"])(
    "verifies %s through the same account contract",
    async (email) => {
      const authenticated = vi.fn();
      render(<ProofEntry onAccountAuthenticated={authenticated} />);
      await send(email);
      expect(
        screen.getByRole("heading", { name: "Check your email" }),
      ).toBeVisible();
      expect(challenge).toHaveBeenCalledWith("account", "EMAIL", email);
      expect(document.body.textContent).not.toContain(email);
      expect(screen.getByLabelText("Verification code")).toHaveFocus();
      await enterCode();
      expect(verify).toHaveBeenCalledWith("account", "EMAIL", email, "123456");
      expect(authenticated).not.toHaveBeenCalled();
      await saveDetails();
      expect(authenticated).toHaveBeenCalledWith(actor);
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
      expect(
        screen.queryByLabelText("Verification code"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/account exists|does not exist/i),
      ).not.toBeInTheDocument();
    },
  );
  it("supports numeric six-digit typing and paste, including leading zeroes", async () => {
    render(<ProofEntry onAccountAuthenticated={vi.fn()} />);
    await send();
    const code = screen.getByLabelText("Verification code");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).toHaveAttribute("inputmode", "numeric");
    expect(code).toHaveAttribute("maxlength", "6");
    expect(code).toHaveAttribute("pattern", "[0-9]{6}");
    fireEvent.change(code, { target: { value: "12a34" } });
    expect(code).toHaveValue("1234");
    expect(
      screen.getByRole("button", { name: "Verify and continue" }),
    ).toBeDisabled();
    fireEvent.paste(code, { clipboardData: { getData: () => "01 23 45" } });
    expect(code).toHaveValue("012345");
    expect(
      screen.getByRole("button", { name: "Verify and continue" }),
    ).toBeEnabled();
  });
  it("counts down resend, prevents cooldown bypass through change-email, and resets after resend", async () => {
    vi.useFakeTimers();
    render(<ProofEntry onAccountAuthenticated={vi.fn()} />);
    await send();
    expect(
      screen.getByRole("button", { name: "Resend code in 60s" }),
    ).toBeDisabled();
    expect(screen.getByText("Code expires in 5:00")).toBeVisible();
    await act(async () => {
      vi.advanceTimersByTime(22_000);
    });
    expect(
      screen.getByRole("button", { name: "Resend code in 38s" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Change email" }));
    expect(screen.getByLabelText("Email address")).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Send code in 38s" }),
    ).toBeDisabled();
    await act(async () => {
      vi.advanceTimersByTime(38_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    expect(challenge).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Code expires in 5:00")).toBeVisible();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resend code" }));
    });
    expect(challenge).toHaveBeenLastCalledWith(
      "account",
      "EMAIL",
      "person@example.com",
    );
    expect(
      screen.getByRole("button", { name: "Resend code in 60s" }),
    ).toBeDisabled();
  });
  it("announces local expiry and blocks submitting an expired code", async () => {
    vi.useFakeTimers();
    render(<ProofEntry onAccountAuthenticated={vi.fn()} />);
    await send();
    await act(async () => {
      vi.advanceTimersByTime(300_000);
    });
    expect(
      screen.getByText("This code has expired. Request a new code."),
    ).toHaveAttribute("role", "status");
    expect(
      screen.getByRole("button", { name: "Verify and continue" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resend code" })).toBeEnabled();
    expect(verify).not.toHaveBeenCalled();
  });
  it.each([
    ["INVALID_PROOF", 401, "incorrect or has expired"],
    [
      "RATE_LIMITED",
      429,
      "Too many attempts. Request a new verification code.",
    ],
    ["DEPENDENCY_UNAVAILABLE", 503, "couldn't verify the code"],
    ["FORBIDDEN", 403, "don't have permission"],
  ])(
    "explains verification %s without exposing internals",
    async (code, status, message) => {
      vi.mocked(verify).mockRejectedValue(new ProofError(code, status));
      render(<ProofEntry onAccountAuthenticated={vi.fn()} />);
      await send();
      await enterCode();
      expect(screen.getByRole("alert")).toHaveTextContent(message);
      expect(document.body.textContent).not.toContain(code);
      expect(document.body.textContent).not.toContain(String(status));
      expect(screen.getByLabelText("Verification code")).toHaveValue("");
      if (status !== 429)
        expect(screen.getByLabelText("Verification code")).toHaveFocus();
      expect(screen.getByLabelText("Verification code")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    },
  );
  it.each([
    ["RATE_LIMITED", 429, "Too many verification requests"],
    ["DEPENDENCY_UNAVAILABLE", 503, "couldn't send the code"],
    ["NETWORK", 0, "couldn't send the code"],
  ])(
    "explains request %s without exposing sender details",
    async (code, status, message) => {
      vi.mocked(challenge).mockRejectedValue(new ProofError(code, status));
      render(<ProofEntry onAccountAuthenticated={vi.fn()} />);
      await send();
      expect(screen.getByRole("alert")).toHaveTextContent(message);
      expect(
        screen.queryByLabelText("Verification code"),
      ).not.toBeInTheDocument();
      expect(screen.getByLabelText("Email address")).toHaveValue(
        "person@example.com",
      );
      expect(document.body.textContent).not.toContain(code);
    },
  );
  it("blocks simultaneous requests and contact changes while sending", async () => {
    let finish!: () => void;
    vi.mocked(challenge).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    render(<ProofEntry onAccountAuthenticated={vi.fn()} />);
    await send();
    expect(
      screen.getByRole("button", { name: "Sending code…" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Email address")).toBeDisabled();
    fireEvent.submit(screen.getByLabelText("Email address").closest("form")!);
    expect(challenge).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });
  it("retries continuation without consuming a verification code again", async () => {
    vi.mocked(currentActor)
      .mockRejectedValueOnce(new ProofError("DEPENDENCY_UNAVAILABLE", 503))
      .mockResolvedValueOnce(actor);
    const authenticated = vi.fn();
    render(<ProofEntry onAccountAuthenticated={authenticated} />);
    await send();
    await enterCode();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your contact is verified",
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });
    expect(verify).toHaveBeenCalledTimes(1);
    vi.mocked(currentActor).mockResolvedValue(actor);
    await saveDetails();
    expect(authenticated).toHaveBeenCalledWith(actor);
  });
  it("clears typed codes when the page is hidden for navigation", async () => {
    render(<ProofEntry onAccountAuthenticated={vi.fn()} />);
    await send();
    fireEvent.change(screen.getByLabelText("Verification code"), {
      target: { value: "123456" },
    });
    fireEvent(window, new Event("pagehide"));
    expect(screen.getByLabelText("Verification code")).toHaveValue("");
  });
  it("explains an expired account", () => {
    render(<ProofEntry expired onAccountAuthenticated={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your session has expired. Sign in again to continue.",
    );
  });
});
