import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  editEvent,
  EventApiError,
  getEventDetail,
  listAllEvents,
} from "../services/events";
import { getOperations } from "../services/occupancy";
import { currentActor } from "../services/proof";
import { listStaff } from "../services/staff";
import { registrationRequest } from "../services/registrations";
import { eventDetailFixture } from "../test/event-fixture";
import { Workspace } from "./Workspace";
import { EditEventForm } from "./EditEventForm";
import { registrationStatus } from "./event-presentation";
import { EventRegistrations } from "./EventRegistrations";

vi.mock("../services/events", async (original) => ({
  ...(await original<typeof import("../services/events")>()),
  editEvent: vi.fn(),
  getEventDetail: vi.fn(),
  listAllEvents: vi.fn(),
}));
vi.mock("../services/proof", async (original) => ({
  ...(await original<typeof import("../services/proof")>()),
  currentActor: vi.fn(),
}));
vi.mock("../services/occupancy", () => ({ getOperations: vi.fn() }));
vi.mock("../services/staff", async (original) => ({
  ...(await original<typeof import("../services/staff")>()),
  listStaff: vi.fn(),
}));
vi.mock("../services/registrations", async (original) => ({
  ...(await original<typeof import("../services/registrations")>()),
  registrationRequest: vi.fn(),
}));
const actor = {
  user_id: "owner",
  organizer_capable: true,
  csrf_token: "csrf",
  assignments: [],
};
const detail = eventDetailFixture({
  name: "TechFest 2026",
  time_zone: "Asia/Kolkata",
  start_at: "2026-10-20T04:30:00Z",
  end_at: "2026-10-20T12:30:00Z",
  registration_capacity: 200,
  gates: [{ gate_id: "gate-uuid", event_id: "one" }],
});
const callbacks = () => ({ onSessionExpired: vi.fn(), onScopeLost: vi.fn() });
beforeEach(() => {
  vi.mocked(currentActor).mockResolvedValue(actor);
  vi.mocked(listAllEvents).mockResolvedValue([
    { ...detail, relationship: "owned" },
  ]);
  vi.mocked(getEventDetail).mockResolvedValue(detail);
  vi.mocked(listStaff).mockResolvedValue({
    allowed_roles: ["EVENT_ADMIN", "GATE_SECURITY", "VOLUNTEER"],
    assignments: [
      {
        id: "staff-uuid",
        userId: "account-uuid",
        email: "sameer@example.test",
        role: "GATE_SECURITY",
        gateId: "gate-uuid",
        grantedAt: detail.as_of,
      },
    ],
  });
  vi.mocked(getOperations).mockResolvedValue({
    event_id: "one",
    event_name: detail.name,
    event_state: "DRAFT",
    registered: 10,
    capacity: 200,
  } as Awaited<ReturnType<typeof getOperations>>);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  localStorage.clear();
});
function workspace() {
  render(<Workspace initialActor={actor} onSessionExpired={vi.fn()} />);
}
async function setup() {
  workspace();
  fireEvent.click(await screen.findByRole("button", { name: "Setup" }));
  return await screen.findByRole("form", { name: "Edit event" });
}

describe("P1-B workspace workflows", () => {
  it("makes the selected event and role explicit and provides actual workflow sections", async () => {
    workspace();
    await screen.findByRole("button", { name: "Overview" });
    expect(screen.getByText(/Event: TechFest 2026/)).toHaveTextContent(
      "Role: Organizer",
    );
    for (const name of ["Setup", "Registrations", "Team & Staff", "Gates"])
      expect(screen.getByRole("button", { name })).toBeVisible();
    for (const [name, href] of [
      ["Live Operations", "/operations/one"],
      ["Results", "/results/one"],
      ["Activity", "/audit/one"],
    ])
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
  });
  it("ignores an unauthorized switcher value and never adds arbitrary roles", async () => {
    vi.mocked(listAllEvents).mockResolvedValue([
      { ...detail, relationship: "owned" },
      {
        ...detail,
        event_id: "two",
        name: "Second event",
        relationship: "owned",
      },
    ]);
    workspace();
    const select = await screen.findByLabelText("Event and role");
    fireEvent.change(select, { target: { value: "assigned:unauthorized" } });
    expect(currentActor).toHaveBeenCalledTimes(1);
    expect(select).toHaveValue("owned:one");
    expect(
      within(select).queryByRole("option", { name: /Event Admin/ }),
    ).toBeNull();
  });
  it("shows event-local date/time controls, grouped fields, and a human time zone selector", async () => {
    await setup();
    expect(screen.getByLabelText("Event starts date")).toHaveValue(
      "2026-10-20",
    );
    expect(screen.getByLabelText("Event starts time")).toHaveValue("10:00");
    expect(screen.getByLabelText("Time zone")).toHaveValue("Asia/Kolkata");
    expect(
      screen.getByRole("option", {
        name: "India Standard Time (IST, UTC+05:30)",
      }),
    ).toBeInTheDocument();
    for (const name of [
      "Basic details",
      "Schedule",
      "Registration",
      "Access",
      "Operations",
    ])
      expect(screen.getByRole("group", { name })).toBeVisible();
    const inputs = [
      ...document.querySelectorAll<HTMLInputElement>(".event-edit-form input"),
    ];
    expect(
      inputs.some((input) => /T\d{2}:.*(?:Z|\+\d{2}:)/.test(input.value)),
    ).toBe(false);
    expect(screen.queryByLabelText(/ISO|IANA|UUID/)).toBeNull();
  });
  it("keeps the actual form and draft mounted through visibility refresh and section navigation", async () => {
    await setup();
    const input = screen.getByLabelText("Event name");
    fireEvent.change(input, { target: { value: "Unsaved name" } });
    let finish!: (value: typeof actor) => void;
    vi.mocked(currentActor).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.getByText("Updating latest information…")).toBeVisible();
    expect(screen.queryByText("Loading workspace…")).toBeNull();
    expect(screen.getByLabelText("Event name")).toBe(input);
    await act(async () => finish(actor));
    await vi.waitFor(() => expect(getEventDetail).toHaveBeenCalledTimes(2));
    expect(input).toHaveValue("Unsaved name");
    fireEvent.click(screen.getByRole("button", { name: "Team & Staff" }));
    expect(await screen.findByText("sameer@example.test")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Setup" }));
    expect(screen.getByLabelText("Event name")).toBe(input);
    expect(input).toHaveValue("Unsaved name");
  });
  it("detects server changes on refresh, retains edits, and requires explicit review with the current version", async () => {
    await setup();
    const input = screen.getByLabelText("Event name");
    fireEvent.change(input, { target: { value: "My edited event" } });
    vi.mocked(getEventDetail).mockResolvedValue({
      ...detail,
      revision: 4,
      name: "Changed elsewhere",
      description: "Latest description",
    });
    fireEvent(document, new Event("visibilitychange"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Review the latest version",
    );
    expect(input).toHaveValue("My edited event");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Load current detail" }),
    );
    await screen.findByText(/Latest event loaded/);
    expect(input).toHaveValue("My edited event");
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Latest description",
    );
    vi.mocked(editEvent).mockResolvedValue({
      ...detail,
      revision: 5,
      name: "My edited event",
      description: "Latest description",
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Changes saved.");
    expect(editEvent).toHaveBeenCalledWith(
      "one",
      4,
      { name: "My edited event" },
      "csrf",
      expect.any(AbortSignal),
    );
  });
  it("refreshes clean forms and keeps a failed background refresh from erasing an edited one", async () => {
    await setup();
    vi.mocked(getEventDetail).mockResolvedValueOnce({
      ...detail,
      revision: 4,
      description: "Fresh description",
    });
    fireEvent(document, new Event("visibilitychange"));
    await vi.waitFor(() =>
      expect(screen.getByLabelText("Description")).toHaveValue(
        "Fresh description",
      ),
    );
    const input = screen.getByLabelText("Event name");
    fireEvent.change(input, { target: { value: "Keep this draft" } });
    vi.mocked(getEventDetail).mockRejectedValueOnce(
      new EventApiError("NETWORK", 0),
    );
    fireEvent(document, new Event("visibilitychange"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "entered values have been kept",
    );
    expect(screen.getByLabelText("Event name")).toBe(input);
    expect(input).toHaveValue("Keep this draft");
  });
  it("integrates staff into numbered gates and keeps their references secondary", async () => {
    workspace();
    fireEvent.click(await screen.findByRole("button", { name: "Gates" }));
    expect(
      await screen.findByText(/sameer@example.test — Gate \/ Security/),
    ).toBeVisible();
    expect(screen.getByText("Gate 1")).toBeVisible();
    expect(screen.getByText(/Gate reference: gate-uuid/)).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Team & Staff" }));
    expect(await screen.findByText("Role: Gate / Security")).toBeVisible();
    expect(screen.getByText("Gate: Gate 1")).toBeVisible();
    expect(screen.queryByText("account-uuid")).toBeNull();
  });
  it("retains technical event references and versions inside advanced disclosure", async () => {
    workspace();
    fireEvent.click(await screen.findByRole("button", { name: "Overview" }));
    await screen.findByRole("heading", { name: detail.name });
    const reference = screen.getByText("Event reference");
    expect(reference).not.toBeVisible();
    fireEvent.click(
      screen.getByText("Advanced details", {
        selector: "#event-detail > details > summary",
      }),
    );
    expect(reference).toBeVisible();
    expect(screen.getByText("Version")).toBeVisible();
    expect(
      screen.queryByText(/Participant registration is unavailable/),
    ).toBeNull();
  });
  it("serializes changed date and time controls in the selected zone", async () => {
    const current = vi.fn();
    render(
      <EditEventForm
        detail={detail}
        owner
        csrf="csrf"
        onCurrent={current}
        {...callbacks()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Event starts time"), {
      target: { value: "11:00" },
    });
    vi.mocked(editEvent).mockResolvedValue({
      ...detail,
      start_at: "2026-10-20T05:30:00Z",
      revision: 4,
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Changes saved.");
    expect(editEvent).toHaveBeenCalledWith(
      "one",
      3,
      { start_at: "2026-10-20T05:30:00.000Z" },
      "csrf",
      expect.any(AbortSignal),
    );
  });
  it("rejects an incomplete date without writing and keeps entered values", async () => {
    render(
      <EditEventForm
        detail={detail}
        owner
        csrf="csrf"
        onCurrent={vi.fn()}
        {...callbacks()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Event starts time"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter both a date and a time",
    );
    expect(screen.getByLabelText("Event starts date")).toHaveFocus();
    expect(screen.getByLabelText("Event starts date")).toHaveValue(
      "2026-10-20",
    );
    expect(editEvent).not.toHaveBeenCalled();
  });
});

describe("server-backed registration presentation", () => {
  it.each(["DRAFT", "PUBLISHED", "LIVE", "COMPLETED", "CANCELLED"] as const)(
    "presents %s using the event lifecycle",
    (state) => {
      const label = registrationStatus({ ...detail, state }, 10);
      expect(label).not.toMatch(/policy|revision|OPEN|DRAFT|LIVE/);
      expect(label).toMatch(
        state === "PUBLISHED"
          ? /Registration is open/
          : state === "DRAFT"
            ? /after.*published/
            : /closed/,
      );
    },
  );
  it("uses server closure reasons and only reports full with a confirmed count", () => {
    const event = { ...detail, state: "PUBLISHED" as const };
    expect(registrationStatus(event, 200)).toBe("Registration is full");
    expect(registrationStatus(event, null)).toMatch(/not been confirmed/);
    expect(
      registrationStatus(
        {
          ...event,
          availability: {
            ...event.availability,
            policy_status: "CLOSED",
            reasons: ["NOT_OPEN_YET"],
            opens_at: "2026-10-19T04:30:00Z",
          },
        },
        200,
      ),
    ).toMatch(/Registration opens on/);
    expect(
      registrationStatus(
        {
          ...event,
          availability: {
            ...event.availability,
            policy_status: "CLOSED",
            reasons: ["MANUALLY_CLOSED"],
          },
        },
        10,
      ),
    ).toBe("Registration is closed by the organizer");
  });
  it("shows full from the authorized operations count and conceals out-of-event lookup results", async () => {
    const published = { ...detail, state: "PUBLISHED" as const };
    vi.mocked(getOperations).mockResolvedValue({
      event_state: "PUBLISHED",
      registered: 200,
      capacity: 200,
    } as Awaited<ReturnType<typeof getOperations>>);
    render(
      <EventRegistrations
        detail={published}
        refreshToken={0}
        {...callbacks()}
      />,
    );
    expect(await screen.findByText("Registration is full")).toBeVisible();
    fireEvent.click(screen.getByText(/Advanced details — registration lookup/));
    fireEvent.change(screen.getByLabelText("Registration reference"), {
      target: { value: "registration-uuid" },
    });
    vi.mocked(registrationRequest).mockResolvedValue({
      registration: {
        event_id: "another-event",
        registration_id: "private-id",
        state: "REGISTERED",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find registration" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "not part of this event",
    );
    expect(screen.queryByText("private-id")).toBeNull();
  });
});
