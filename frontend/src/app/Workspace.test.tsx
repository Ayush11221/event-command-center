import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EventApiError,
  getEventDetail,
  listAllEvents,
  type ManagementEvent,
} from "../services/events";
import { eventDetailFixture } from "../test/event-fixture";
import { currentActor, type ActorState } from "../services/proof";
import { Workspace } from "./Workspace";

vi.mock("../services/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/events")>();
  return {
    ...actual,
    listAllEvents: vi.fn(),
    createDraft: vi.fn(),
    getEventDetail: vi.fn(),
  };
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

beforeEach(() =>
  vi.mocked(getEventDetail).mockResolvedValue(eventDetailFixture()),
);

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

  it("shows only assigned events for Admin, supports detail navigation and preserves role limits", async () => {
    const admin: ActorState = {
      ...actor,
      organizer_capable: false,
      assignments: [
        { id: "a", event_id: "one", role: "EVENT_ADMIN", gate_id: null },
      ],
    };
    vi.mocked(currentActor).mockResolvedValue(admin);
    vi.mocked(listAllEvents).mockResolvedValue([assigned]);
    render(
      <Workspace
        initialActor={admin}
        onSessionExpired={vi.fn()}
        onSignedOut={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "Assigned events" }),
    ).toBeVisible();
    expect(listAllEvents).toHaveBeenCalledWith("assigned");
    expect(listAllEvents).not.toHaveBeenCalledWith("owned");
    expect(
      screen.queryByRole("button", { name: "Create Draft" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Event setup" }));
    expect(
      await screen.findByRole("heading", { name: "Owned draft" }),
    ).toBeVisible();
    expect(getEventDetail).toHaveBeenCalledWith("one", expect.any(AbortSignal));
    expect(
      screen.queryByRole("button", {
        name: /publish|cancel|live|capacity|gate|certificate/i,
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit event" }));
    expect(screen.getByRole("form", { name: "Edit event" })).toBeVisible();
    expect(screen.queryByLabelText("Visibility")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Manual registration closure configured"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Assigned events" }));
    expect(
      await screen.findByRole("heading", { name: "Assigned events" }),
    ).toBeVisible();
  });

  it("shows assigned-list loading, retry and empty states without restoring a stale context", async () => {
    const admin: ActorState = {
      ...actor,
      organizer_capable: false,
      assignments: [
        { id: "a", event_id: "one", role: "EVENT_ADMIN", gate_id: null },
      ],
    };
    localStorage.setItem(
      "eoc.active_context.v1",
      JSON.stringify({ eventId: "one", relationship: "assigned" }),
    );
    vi.mocked(currentActor).mockResolvedValue(admin);
    vi.mocked(listAllEvents)
      .mockRejectedValueOnce(new EventApiError("DEPENDENCY_UNAVAILABLE", 503))
      .mockResolvedValueOnce([]);
    render(
      <Workspace
        initialActor={admin}
        onSessionExpired={vi.fn()}
        onSignedOut={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading authorized events",
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be loaded",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry event list" }));
    expect(await screen.findByText("No assigned events.")).toBeVisible();
    expect(localStorage.getItem("eoc.active_context.v1")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Event setup" }),
    ).not.toBeInTheDocument();
  });

  it("refreshes contexts after detail concealment and removes the lost Event data", async () => {
    const admin: ActorState = {
      ...actor,
      organizer_capable: false,
      assignments: [
        { id: "a", event_id: "one", role: "EVENT_ADMIN", gate_id: null },
      ],
    };
    vi.mocked(currentActor)
      .mockResolvedValueOnce(admin)
      .mockResolvedValue({ ...admin, assignments: [] });
    vi.mocked(listAllEvents).mockResolvedValue([assigned]);
    vi.mocked(getEventDetail).mockRejectedValue(
      new EventApiError("EVENT_NOT_FOUND", 404),
    );
    render(
      <Workspace
        initialActor={admin}
        onSessionExpired={vi.fn()}
        onSignedOut={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "Assigned events" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Event setup" }));
    expect(
      await screen.findByRole("heading", { name: "No event context" }),
    ).toBeVisible();
    expect(screen.queryByText("Owned draft")).not.toBeInTheDocument();
    expect(localStorage.getItem("eoc.active_context.v1")).toBeNull();
  });
});
