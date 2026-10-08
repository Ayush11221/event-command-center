import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { challenge, verify, currentActor, ProofError } from "../services/proof";
import { App } from "./App";

vi.mock("../services/proof", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/proof")>();
  return {
    ...actual,
    currentActor: vi.fn(),
    challenge: vi.fn(),
    verify: vi.fn(),
  };
});
vi.mock("./Workspace", () => ({
  Workspace: ({ onSessionExpired }: { onSessionExpired: () => void }) => (
    <main>
      <p>Authorized workspace</p>
      <label>
        Unfinished event name
        <input defaultValue="" />
      </label>
      <button type="button" onClick={onSessionExpired}>
        Expire access
      </button>
    </main>
  ),
}));
vi.mock("./OccupancyPage", () => ({
  OccupancyPage: ({ eventId }: { eventId: string }) => (
    <main>
      <h1>Scoped operations {eventId}</h1>
    </main>
  ),
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
  it("continues an ordinary account to participant guidance without privileged controls", async () => {
    vi.mocked(currentActor).mockResolvedValue({
      user_id: "u",
      organizer_capable: false,
      assignments: [],
      csrf_token: "csrf",
    });
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "Find your next event" }),
    ).toBeVisible();
    expect(screen.queryByText("Authorized workspace")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Gate scanner" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/role/i)).not.toBeInTheDocument();
  });
  it.each([
    ["FORBIDDEN", 403, "don't have permission"],
    ["DEPENDENCY_UNAVAILABLE", 503, "couldn't verify your access"],
  ])("distinguishes %s from anonymous entry", async (code, status, message) => {
    vi.mocked(currentActor).mockRejectedValue(new ProofError(code, status));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
  });
  it("preserves unfinished form input across expiry and same-account reauthentication", async () => {
    const actor = {
      user_id: "u",
      organizer_capable: true,
      assignments: [],
      csrf_token: "csrf",
    };
    vi.mocked(currentActor).mockResolvedValue(actor);
    vi.mocked(challenge).mockResolvedValue();
    vi.mocked(verify).mockResolvedValue();
    render(<App />);
    const field = await screen.findByLabelText("Unfinished event name");
    fireEvent.change(field, { target: { value: "My unfinished event" } });
    fireEvent.click(screen.getByRole("button", { name: "Expire access" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your session has expired",
    );
    expect(field).not.toBeVisible();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const code = await screen.findByLabelText("Verification code");
    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Verify and continue" }),
    );
    expect(await screen.findByText("Authorized workspace")).toBeVisible();
    expect(screen.getByLabelText("Unfinished event name")).toHaveValue(
      "My unfinished event",
    );
  });
  it("routes an operations deep link through the internal reader while preserving appearance controls", () => {
    window.history.replaceState(null, "", "/operations/internal-event");
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "Scoped operations internal-event" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Appearance")).toBeVisible();
    expect(document.title).toContain("Live Operations");
    expect(
      screen.queryByText("Anonymous public catalog"),
    ).not.toBeInTheDocument();
  });
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
        name: /Sign in or create an account/,
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
      "couldn't verify your access",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Authorized workspace")).toBeVisible();
  });
});
