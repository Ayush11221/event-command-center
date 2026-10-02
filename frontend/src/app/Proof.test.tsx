import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  challenge,
  currentActor,
  currentGuest,
  ProofError,
  verify,
} from "../services/proof";
import { ProofEntry } from "./ProofEntry";

vi.mock("../services/proof", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/proof")>();
  return {
    ...actual,
    challenge: vi.fn(),
    verify: vi.fn(),
    currentActor: vi.fn(),
    currentGuest: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("Slice 2 browser proof states", () => {
  it("requests and verifies an account without storing a browser-readable JWT", async () => {
    const authenticated = vi.fn();
    vi.mocked(challenge).mockResolvedValue();
    vi.mocked(verify).mockResolvedValue();
    vi.mocked(currentActor).mockResolvedValue({
      user_id: "u",
      organizer_capable: false,
      assignments: [],
      csrf_token: "csrf",
    });
    render(<ProofEntry onAccountAuthenticated={authenticated} />);
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "person@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request code" }));
    expect(
      await screen.findByText(/If this contact is eligible/),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("Six-digit code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
    await vi.waitFor(() =>
      expect(authenticated).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: "u" }),
      ),
    );
    expect(verify).toHaveBeenCalledWith(
      "account",
      "EMAIL",
      "person@example.test",
      "123456",
    );
    expect(localStorage.getItem("eoc_session")).toBeNull();
  });

  it("shows a bounded retry message for throttling", async () => {
    vi.mocked(challenge).mockRejectedValue(new ProofError("RATE_LIMITED", 429));
    render(<ProofEntry onAccountAuthenticated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "person@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request code" }));
    expect(await screen.findByText(/Too many attempts/)).toBeVisible();
    expect(screen.queryByLabelText("Six-digit code")).not.toBeInTheDocument();
  });

  it("keeps guest proof distinct from an account session", async () => {
    const authenticated = vi.fn();
    vi.mocked(challenge).mockResolvedValue();
    vi.mocked(verify).mockResolvedValue();
    vi.mocked(currentGuest).mockResolvedValue({
      status: "verified",
      csrf_token: "guest-csrf",
    });
    render(<ProofEntry onAccountAuthenticated={authenticated} />);
    fireEvent.change(screen.getByLabelText("Proof type"), {
      target: { value: "guest" },
    });
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "guest@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request code" }));
    await screen.findByLabelText("Six-digit code");
    fireEvent.change(screen.getByLabelText("Six-digit code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
    expect(await screen.findByText(/Guest contact verified/)).toBeVisible();
    expect(authenticated).not.toHaveBeenCalled();
  });
});
