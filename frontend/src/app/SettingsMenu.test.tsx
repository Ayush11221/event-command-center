import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentActor, logout, ProofError } from "../services/proof";
import { SettingsMenu } from "./SettingsMenu";

vi.mock("../services/proof", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/proof")>()),
  currentActor: vi.fn(),
  logout: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const actor = {
  user_id: "u",
  organizer_capable: true,
  assignments: [],
  csrf_token: "fresh-csrf",
};

describe("Settings menu", () => {
  it("offers appearance and signs out with a freshly read CSRF token", async () => {
    vi.mocked(currentActor).mockResolvedValue(actor);
    vi.mocked(logout).mockResolvedValue();
    render(<SettingsMenu />);
    const trigger = screen.getByRole("button", { name: "Settings" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("radiogroup", { name: "Appearance" }),
    ).toBeVisible();
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await vi.waitFor(() => expect(logout).toHaveBeenCalledWith("fresh-csrf"));
  });

  it("hides Sign out when no account session exists", async () => {
    vi.mocked(currentActor).mockRejectedValue(
      new ProofError("UNAUTHENTICATED", 401),
    );
    render(<SettingsMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await vi.waitFor(() => expect(currentActor).toHaveBeenCalled());
    expect(
      screen.getByRole("radiogroup", { name: "Appearance" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Sign out" }),
    ).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    vi.mocked(currentActor).mockResolvedValue(actor);
    render(<SettingsMenu />);
    const trigger = screen.getByRole("button", { name: "Settings" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });
});
