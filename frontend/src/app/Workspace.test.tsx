import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listAllEvents, type ManagementEvent } from "../services/events";
import { currentActor, type ActorState } from "../services/proof";
import { Workspace } from "./Workspace";

vi.mock("../services/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/events")>();
  return { ...actual, listAllEvents: vi.fn(), createDraft: vi.fn() };
});
vi.mock("../services/proof", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/proof")>();
  return { ...actual, currentActor: vi.fn(), logout: vi.fn() };
});

const actor: ActorState = {
  user_id: "actor",
  organizer_capable: true,
  assignments: [],
  csrf_token: "csrf",
};
const owned: ManagementEvent = {
  event_id: "one",
  name: "Owned draft",
  state: "DRAFT",
  start_at: null,
  end_at: null,
  time_zone: null,
  relationship: "owned",
};
const assigned: ManagementEvent = { ...owned, relationship: "assigned" };

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  localStorage.clear();
});

describe("authenticated Event workspace", () => {
  it("automatically selects the sole owned context and shows no invented counts", async () => {
    vi.mocked(currentActor).mockResolvedValue(actor);
    vi.mocked(listAllEvents).mockResolvedValue([owned]);
    render(
      <Workspace
        initialActor={actor}
        onSessionExpired={vi.fn()}
        onSignedOut={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "Owned events" }),
    ).toBeVisible();
    expect(screen.queryByLabelText("Event and role")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Owned draft/ })).toBeVisible();
    expect(screen.getByText("Schedule not set")).toBeVisible();
    expect(
      screen.queryByText(/registered|remaining places/i),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem("eoc.active_context.v1")).toContain(
      '"relationship":"owned"',
    );
  });

  it("restores two roles on one Event and removes revoked Admin context on refresh", async () => {
    const withAssignment: ActorState = {
      ...actor,
      assignments: [
        {
          id: "assignment",
          event_id: "one",
          role: "EVENT_ADMIN",
          gate_id: null,
        },
      ],
    };
    localStorage.setItem(
      "eoc.active_context.v1",
      JSON.stringify({ eventId: "one", relationship: "assigned" }),
    );
    vi.mocked(currentActor)
      .mockResolvedValueOnce(withAssignment)
      .mockResolvedValueOnce(withAssignment)
      .mockResolvedValueOnce(actor);
    vi.mocked(listAllEvents).mockImplementation(async (view) =>
      view === "owned" ? [owned] : [assigned],
    );
    render(
      <Workspace
        initialActor={withAssignment}
        onSessionExpired={vi.fn()}
        onSignedOut={vi.fn()}
      />,
    );
    const switcher = await screen.findByLabelText("Event and role");
    expect(switcher).toHaveValue("assigned:one");
    expect(
      screen.getByRole("region", { name: "Event Admin context" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Create Draft" }),
    ).not.toBeInTheDocument();
    fireEvent.change(switcher, { target: { value: "owned:one" } });
    expect(
      await screen.findByRole("heading", { name: "Owned events" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Create Draft" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Refresh access" }));
    expect(
      await screen.findByRole("heading", { name: "Owned events" }),
    ).toBeVisible();
    expect(screen.queryByLabelText("Event and role")).not.toBeInTheDocument();
    expect(localStorage.getItem("eoc.active_context.v1")).toContain(
      '"relationship":"owned"',
    );
  });

  it("shows a retry state when the authorized list cannot load", async () => {
    vi.mocked(currentActor).mockResolvedValue(actor);
    vi.mocked(listAllEvents)
      .mockRejectedValueOnce(new Error("db"))
      .mockResolvedValueOnce([]);
    render(
      <Workspace
        initialActor={actor}
        onSessionExpired={vi.fn()}
        onSignedOut={vi.fn()}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be loaded",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry event list" }));
    expect(await screen.findByText("No owned events yet")).toBeVisible();
  });
});
