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
vi.mock("./PublicCatalog", () => ({
  PublicCatalog: () => <h1>Anonymous public catalog</h1>,
}));
vi.mock("./PrivateEventDetail", () => ({
  PrivateEventDetail: () => <h1>Controlled private detail</h1>,
}));
vi.mock("./PublicEventDetail", () => ({
  PublicEventDetail: ({ eventId }: { eventId: string }) => (
    <h1>Anonymous public detail {eventId}</h1>
  ),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("application entry", () => {
  it("offers keyboard bypass to main content without modifying the URL fragment", () => {
    vi.mocked(currentActor).mockReturnValue(new Promise(() => {}));
    window.history.replaceState(null, "", "/#unchanged");
    render(<App />);
    const skip = screen.getByRole("button", { name: "Skip to main content" });
    skip.focus();
    fireEvent.click(skip);
    expect(screen.getByRole("main")).toHaveFocus();
    expect(window.location.hash).toBe("#unchanged");
  });
  it("opens private entry without account or Event+Role context", () => {
    window.history.replaceState(null, "", "/private");
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "Controlled private detail" }),
    ).toBeVisible();
    expect(currentActor).not.toHaveBeenCalled();
  });
  it("opens public catalog without checking an account or Event+Role context", () => {
    window.history.replaceState(null, "", "/events");
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "Anonymous public catalog" }),
    ).toBeVisible();
    expect(currentActor).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: "Event workspace" }),
    ).toHaveAttribute("href", "/");
  });
  it("opens directly linked public detail without account or role requirements", () => {
    window.history.replaceState(null, "", "/events/public-one");
    render(<App />);
    expect(
      screen.getByRole("heading", {
        name: "Anonymous public detail public-one",
      }),
    ).toBeVisible();
    expect(currentActor).not.toHaveBeenCalled();
  });
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
