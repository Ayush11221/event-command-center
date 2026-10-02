import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentActor, ProofError } from "../services/proof";
import { App } from "./App";

vi.mock("../services/proof", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/proof")>();
  return { ...actual, currentActor: vi.fn() };
});
vi.mock("./Workspace", () => ({
  Workspace: () => <p>Authorized workspace</p>,
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  localStorage.clear();
});

describe("application entry", () => {
  it("waits for a verified session before showing the workspace", () => {
    vi.mocked(currentActor).mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking your session",
    );
    expect(screen.queryByText("Authorized workspace")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Appearance")).toBeVisible();
  });

  it("shows the account entry for an expired session", async () => {
    vi.mocked(currentActor).mockRejectedValue(
      new ProofError("UNAUTHENTICATED", 401),
    );
    render(<App />);
    expect(
      await screen.findByRole("heading", {
        name: /Sign in to your event workspace/,
      }),
    ).toBeVisible();
    expect(screen.queryByText("Authorized workspace")).not.toBeInTheDocument();
  });

  it("offers retry when session status is unknown", async () => {
    vi.mocked(currentActor)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        user_id: "u",
        organizer_capable: true,
        assignments: [],
        csrf_token: "csrf",
      });
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be checked",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Retry session check" }),
    );
    expect(await screen.findByText("Authorized workspace")).toBeVisible();
  });
});
