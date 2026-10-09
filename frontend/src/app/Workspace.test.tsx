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
  return { ...actual, currentActor: vi.fn() };
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
  it("uses the new access verification after reauthentication while retaining draft input", async () => {
    vi.mocked(currentActor).mockResolvedValue(actor);
    vi.mocked(listAllEvents).mockResolvedValue([]);
    const p = {
      initialActor: actor,
      onSessionExpired: vi.fn(),
    };
    const view = render(<Workspace {...p} />);
    const input = await screen.findByLabelText(/Event name/);
    fireEvent.change(input, { target: { value: "Unsaved draft" } });
    view.rerender(
      <Workspace {...p} initialActor={{ ...actor, csrf_token: "new-csrf" }} />,
    );
    expect(input).toHaveValue("Unsaved draft");
    // Sign out moved to the header Settings menu (see SettingsMenu.test).
    expect(screen.getByLabelText(/Event name/)).toBe(input);
  });
  it("keeps the mounted draft and its unsaved value during visibility renewal and transient session-store failure", async () => {
    vi.mocked(currentActor).mockResolvedValue(actor);
    vi.mocked(listAllEvents).mockResolvedValue([]);
    render(<Workspace initialActor={actor} onSessionExpired={vi.fn()} />);
    const input = await screen.findByLabelText(/Event name/);
    fireEvent.change(input, { target: { value: "Unsaved event" } });
    fireEvent(document, new Event("visibilitychange"));
    await vi.waitFor(() => expect(currentActor).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Refresh workspace" }),
      ).toBeEnabled(),
    );
    expect(screen.getByLabelText(/Event name/)).toBe(input);
    expect(input).toHaveValue("Unsaved event");
    vi.mocked(currentActor).mockRejectedValueOnce(
      new Error("store unavailable"),
    );
    fireEvent(document, new Event("visibilitychange"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "session could not be checked",
    );
    expect(screen.getByLabelText(/Event name/)).toBe(input);
    expect(input).toHaveValue("Unsaved event");
  });
  it.each(["GATE_SECURITY", "VOLUNTEER", "PARTICIPANT"])(
    "offers no event-wide operations link for %s alone",
    async (role) => {
      const staff = {
        ...actor,
        organizer_capable: false,
        assignments: [
          {
            id: "assignment",
            event_id: "one",
            role,
            gate_id: role === "GATE_SECURITY" ? "gate" : null,
          },
        ],
      };
      vi.mocked(currentActor).mockResolvedValue(staff);
      vi.mocked(listAllEvents).mockResolvedValue([]);
      render(<Workspace initialActor={staff} onSessionExpired={vi.fn()} />);
      if (role === "GATE_SECURITY") {
        await screen.findByText("Role: Gate / Security");
        expect(
          screen.getByRole("link", {
            name: "Scan entry QR at your assigned gate",
          }),
        ).toHaveAttribute("href", "/scanner");
      } else await screen.findByRole("heading", { name: "No event context" });
      expect(
        screen.queryByRole("link", { name: "Live Operations" }),
      ).not.toBeInTheDocument();
    },
  );
  it.each(["owned", "assigned"] as const)(
    "links occupancy only from a verified %s manager context",
    async (relationship) => {
      const adminActor = {
        ...actor,
        organizer_capable: relationship === "owned",
        assignments:
          relationship === "assigned"
            ? [
                {
                  id: "assignment",
                  event_id: "one",
                  role: "EVENT_ADMIN",
                  gate_id: null,
                },
              ]
            : [],
      };
      vi.mocked(currentActor).mockResolvedValue(adminActor);
      vi.mocked(listAllEvents).mockResolvedValue([{ ...owned, relationship }]);
      render(
        <Workspace initialActor={adminActor} onSessionExpired={vi.fn()} />,
      );
      expect(
        await screen.findByRole("link", { name: "Live Operations" }),
      ).toHaveAttribute("href", "/operations/one");
    },
  );
  it("automatically selects the sole owned context and shows no invented counts", async () => {
    vi.mocked(currentActor).mockResolvedValue(actor);
    vi.mocked(listAllEvents).mockResolvedValue([owned]);
    render(<Workspace initialActor={actor} onSessionExpired={vi.fn()} />);
    expect(
      await screen.findByRole("heading", { name: "My events" }),
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
      <Workspace initialActor={withAssignment} onSessionExpired={vi.fn()} />,
    );
    const switcher = await screen.findByLabelText("Event and role");
    expect(switcher).toHaveValue("assigned:one");
    expect(
      screen.getByRole("region", { name: "Event Admin context" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Create event" }),
    ).not.toBeInTheDocument();
    fireEvent.change(switcher, { target: { value: "owned:one" } });
    expect(
      await screen.findByRole("heading", { name: "My events" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Create event" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Refresh workspace" }));
    expect(
      await screen.findByRole("heading", { name: "My events" }),
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
    render(<Workspace initialActor={actor} onSessionExpired={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be loaded",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry event list" }));
    expect(await screen.findByText("No events yet")).toBeVisible();
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
    render(<Workspace initialActor={admin} onSessionExpired={vi.fn()} />);
    expect(
      await screen.findByRole("heading", { name: "Assigned events" }),
    ).toBeVisible();
    expect(listAllEvents).toHaveBeenCalledWith("assigned");
    expect(listAllEvents).not.toHaveBeenCalledWith("owned");
    expect(
      screen.queryByRole("button", { name: "Create event" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(
      await screen.findByRole("heading", { name: "Owned draft" }),
    ).toBeVisible();
    expect(getEventDetail).toHaveBeenCalledWith("one", expect.any(AbortSignal));
    expect(
      screen.queryByRole("button", {
        name: /publish|cancel|live|capacity|certificate/i,
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Gates" }));
    expect(screen.getByRole("button", { name: "Create gate" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit event" }));
    expect(screen.getByRole("form", { name: "Edit event" })).toBeVisible();
    expect(screen.queryByLabelText("Visibility")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Close registration manually"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "My events" }));
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
    render(<Workspace initialActor={admin} onSessionExpired={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading workspace");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be loaded",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry event list" }));
    expect(await screen.findByText("No assigned events.")).toBeVisible();
    expect(localStorage.getItem("eoc.active_context.v1")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Overview" }),
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
    render(<Workspace initialActor={admin} onSessionExpired={vi.fn()} />);
    expect(
      await screen.findByRole("heading", { name: "Assigned events" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(
      await screen.findByRole("heading", { name: "No event context" }),
    ).toBeVisible();
    expect(screen.queryByText("Owned draft")).not.toBeInTheDocument();
    expect(localStorage.getItem("eoc.active_context.v1")).toBeNull();
  });
});
