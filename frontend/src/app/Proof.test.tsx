import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkHealth } from "../services/health";
import {
  challenge,
  currentActor,
  currentGuest,
  logout,
  ProofError,
  verify,
} from "../services/proof";
import { App } from "./App";

vi.mock("../services/health", () => ({ checkHealth: vi.fn() }));
vi.mock("../services/proof", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/proof")>();
  return {
    ...actual,
    challenge: vi.fn(),
    verify: vi.fn(),
    currentActor: vi.fn(),
    currentGuest: vi.fn(),
    logout: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function setup() {
  vi.mocked(checkHealth).mockResolvedValue({
    status: "alive",
    correlation_id: "test",
  });
  vi.mocked(currentActor).mockRejectedValueOnce(
    new ProofError("UNAUTHENTICATED", 401),
  );
  render(<App />);
}

describe("Slice 2 browser proof states", () => {
  it("requests and verifies an account without storing a browser-readable JWT", async () => {
    setup();
    vi.mocked(challenge).mockResolvedValue();
    vi.mocked(verify).mockResolvedValue();
    vi.mocked(currentActor).mockResolvedValueOnce({
      user_id: "u",
      organizer_capable: false,
      assignments: [],
      csrf_token: "csrf",
    });
    vi.mocked(logout).mockResolvedValue();
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
    expect(await screen.findByText(/Account session active/)).toBeVisible();
    expect(verify).toHaveBeenCalledWith(
      "account",
      "EMAIL",
      "person@example.test",
      "123456",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Sign out of this session" }),
    );
    expect(await screen.findByText(/Signed out of this session/)).toBeVisible();
    expect(logout).toHaveBeenCalledWith("csrf");
  });

  it("shows a bounded retry message for throttling", async () => {
    setup();
    vi.mocked(challenge).mockRejectedValue(new ProofError("RATE_LIMITED", 429));
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "person@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request code" }));
    expect(await screen.findByText(/Too many attempts/)).toBeVisible();
    expect(screen.queryByLabelText("Six-digit code")).not.toBeInTheDocument();
  });

  it("keeps guest proof distinct from an account session", async () => {
    setup();
    vi.mocked(challenge).mockResolvedValue();
    vi.mocked(verify).mockResolvedValue();
    vi.mocked(currentGuest).mockResolvedValue({ status: "verified" });
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
    expect(
      screen.queryByRole("button", { name: "Sign out of this session" }),
    ).not.toBeInTheDocument();
  });
});
