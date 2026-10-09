import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentActor, logout, ProofError } from "../services/proof";
import { accountSignedOut } from "../services/account-session";
import { SettingsMenu } from "./SettingsMenu";

vi.mock("../services/proof", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/proof")>()),
  currentActor: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("../services/account-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/account-session")>()),
  accountSignedOut: vi.fn(),
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

  it("uses a renewed CSRF token instead of the token read when opening Settings", async () => {
    vi.mocked(currentActor)
      .mockResolvedValueOnce({ ...actor, csrf_token: "menu-csrf" })
      .mockResolvedValue({ ...actor, csrf_token: "renewed-csrf" });
    vi.mocked(logout).mockResolvedValue();
    render(<SettingsMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await vi.waitFor(() => expect(logout).toHaveBeenCalledWith("renewed-csrf"));
    expect(logout).not.toHaveBeenCalledWith("menu-csrf");
  });

  it("does not send logout when the fresh session read is unavailable", async () => {
    vi.mocked(currentActor)
      .mockResolvedValueOnce(actor)
      .mockRejectedValue(new ProofError("DEPENDENCY_UNAVAILABLE", 503));
    vi.mocked(logout).mockResolvedValue();
    render(<SettingsMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't verify your access right now",
    );
    expect(logout).not.toHaveBeenCalled();
    expect(accountSignedOut).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Settings" })).toBeVisible();
  });

  it("keeps the session UI when the server rejects logout", async () => {
    vi.mocked(currentActor).mockResolvedValue(actor);
    vi.mocked(logout).mockRejectedValue(new ProofError("INVALID_CSRF", 403));
    render(<SettingsMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You don't have permission",
    );
    expect(accountSignedOut).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Settings" })).toBeVisible();
  });

  it("announces an already expired session without sending logout", async () => {
    window.history.replaceState(null, "", "/");
    vi.mocked(currentActor)
      .mockResolvedValueOnce(actor)
      .mockRejectedValue(new ProofError("SESSION_EXPIRED", 401));
    vi.mocked(logout).mockResolvedValue();
    render(<SettingsMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await vi.waitFor(() => expect(accountSignedOut).toHaveBeenCalledOnce());
    expect(logout).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("group", { name: "Settings" }),
    ).not.toBeInTheDocument();
  });
});
