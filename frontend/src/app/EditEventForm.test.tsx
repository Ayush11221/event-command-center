import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editEvent, EventApiError, getEventDetail } from "../services/events";
import { eventDetailFixture } from "../test/event-fixture";
import { EditEventForm } from "./EditEventForm";
import { EventDetail } from "./EventDetail";

vi.mock("../services/events", async (original) => ({
  ...(await original<typeof import("../services/events")>()),
  editEvent: vi.fn(),
  getEventDetail: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function form(owner = true) {
  const props = {
    detail: eventDetailFixture(),
    owner,
    csrf: "csrf",
    onCurrent: vi.fn(),
    onSessionExpired: vi.fn(),
    onScopeLost: vi.fn(),
  };
  render(<EditEventForm {...props} />);
  return props;
}
function changeName() {
  fireEvent.change(screen.getByLabelText("Event name"), {
    target: { value: "Edited" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
}
describe("V4 role-scoped event editing", () => {
  it("refreshes a lifecycle rejection and retains a disabled draft when the event is now Live", async () => {
    vi.mocked(getEventDetail)
      .mockResolvedValueOnce(eventDetailFixture())
      .mockResolvedValueOnce(
        eventDetailFixture({
          state: "LIVE",
          revision: 4,
          permitted_actions: [],
        }),
      );
    vi.mocked(editEvent).mockRejectedValue(
      new EventApiError("WRONG_LIFECYCLE_STATE", 422),
    );
    render(
      <EventDetail
        context={{
          eventId: "one",
          name: "Owned draft",
          state: "DRAFT",
          relationship: "owned",
        }}
        csrf="csrf"
        onSessionExpired={vi.fn()}
        onScopeLost={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit event" }));
    changeName();
    expect(await screen.findByRole("alert")).toHaveTextContent("current state");
    fireEvent.click(
      screen.getByRole("button", { name: "Load current detail" }),
    );
    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save changes" }),
      ).toBeDisabled(),
    );
    expect(
      screen.queryByRole("button", { name: "Edit event" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Event name")).toHaveValue("Edited");
    expect(screen.getByText(/Your draft is retained/)).toBeVisible();
    expect(editEvent).toHaveBeenCalledTimes(1);
  });
  it("does not offer editing when the server's current actions exclude it", async () => {
    vi.mocked(getEventDetail).mockResolvedValue(
      eventDetailFixture({ permitted_actions: [] }),
    );
    render(
      <EventDetail
        context={{
          eventId: "one",
          name: "Owned draft",
          state: "DRAFT",
          relationship: "assigned",
        }}
        csrf="csrf"
        onSessionExpired={vi.fn()}
        onScopeLost={vi.fn()}
      />,
    );
    await screen.findByRole("heading", { name: "Owned draft" });
    expect(
      screen.queryByRole("button", { name: "Edit event" }),
    ).not.toBeInTheDocument();
  });
  it("shows the complete Organizer form and saves only changed configuration", async () => {
    const props = form();
    expect(screen.getByLabelText("Registration opens date")).toBeVisible();
    expect(screen.getByLabelText("Registration closes date")).toBeVisible();
    expect(screen.getByLabelText("Close registration manually")).toBeVisible();
    expect(screen.getByLabelText("Registration limit")).toBeVisible();
    vi.mocked(editEvent).mockResolvedValue(
      eventDetailFixture({
        name: "Edited",
        revision: 4,
        registration_manually_closed: true,
      }),
    );
    fireEvent.click(screen.getByLabelText("Close registration manually"));
    changeName();
    expect(await screen.findByText("Changes saved.")).toBeVisible();
    expect(editEvent).toHaveBeenCalledWith(
      "one",
      3,
      { name: "Edited", registration_manually_closed: true },
      "csrf",
      expect.any(AbortSignal),
    );
    expect(props.onCurrent).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 4 }),
    );
    expect(
      screen.queryByRole("button", {
        name: /publish|live|register|qr|gate|cancel/i,
      }),
    ).not.toBeInTheDocument();
  });
  it("renders exactly six editable fields for Admin, without forbidden controls", async () => {
    form(false);
    expect(screen.getAllByRole("textbox")).toHaveLength(6);
    for (const label of [
      /capacity/i,
      /time zone/i,
      /registration/i,
      /checkout/i,
      /visibility/i,
      /cutoff/i,
    ])
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    vi.mocked(editEvent).mockResolvedValue(
      eventDetailFixture({ name: "Edited", revision: 4 }),
    );
    changeName();
    await screen.findByText("Changes saved.");
    expect(editEvent).toHaveBeenCalledWith(
      "one",
      3,
      { name: "Edited" },
      "csrf",
      expect.any(AbortSignal),
    );
  });
  it("clears optional fields with null and sends tags as an array", async () => {
    form(false);
    vi.mocked(editEvent).mockResolvedValue(
      eventDetailFixture({
        description: null,
        tags: ["One", "Two"],
        revision: 4,
      }),
    );
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Tags (one per line)"), {
      target: { value: "One\nTwo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Changes saved.");
    expect(editEvent).toHaveBeenCalledWith(
      "one",
      3,
      { description: null, tags: ["One", "Two"] },
      "csrf",
      expect.any(AbortSignal),
    );
  });
  it("retains entered data, focuses the invalid field, and allows a corrected submission", async () => {
    form();
    vi.mocked(editEvent)
      .mockRejectedValueOnce(
        new EventApiError("VALIDATION", 400, "ref", { field: "name" }),
      )
      .mockResolvedValueOnce(
        eventDetailFixture({ name: "Corrected", revision: 4 }),
      );
    changeName();
    expect(await screen.findByRole("alert")).toHaveTextContent("ref");
    expect(screen.getByLabelText("Event name")).toHaveFocus();
    expect(screen.getByLabelText("Event name")).toHaveValue("Edited");
    expect(screen.getByLabelText("Event name")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    fireEvent.change(screen.getByLabelText("Event name"), {
      target: { value: "Corrected" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Changes saved.");
    expect(editEvent).toHaveBeenCalledTimes(2);
  });
  it.each([409, 503, 0])(
    "requires GET reconciliation after %s, preserving edits and retrying with the fresh revision",
    async (status) => {
      form(false);
      vi.mocked(editEvent)
        .mockRejectedValueOnce(
          new EventApiError(
            status === 409 ? "VERSION_CONFLICT" : "NETWORK",
            status,
          ),
        )
        .mockResolvedValueOnce(
          eventDetailFixture({ name: "Edited", revision: 8 }),
        );
      vi.mocked(getEventDetail).mockResolvedValue(
        eventDetailFixture({
          name: "Concurrent name",
          description: "Concurrent description",
          revision: 7,
        }),
      );
      changeName();
      await screen.findByRole("alert");
      expect(
        screen.getByRole("button", { name: "Save changes" }),
      ).toBeDisabled();
      expect(editEvent).toHaveBeenCalledTimes(1);
      fireEvent.click(
        screen.getByRole("button", { name: "Load current detail" }),
      );
      expect(await screen.findByText(/Latest event loaded/)).toBeVisible();
      expect(screen.getByLabelText("Event name")).toHaveValue("Edited");
      expect(screen.getByLabelText("Description")).toHaveValue(
        "Concurrent description",
      );
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
      await screen.findByText("Changes saved.");
      expect(editEvent).toHaveBeenLastCalledWith(
        "one",
        7,
        { name: "Edited" },
        "csrf",
        expect.any(AbortSignal),
      );
    },
  );
  it("confirms an unknown success through GET without replaying the PATCH", async () => {
    form(false);
    vi.mocked(editEvent).mockRejectedValue(new EventApiError("NETWORK", 0));
    vi.mocked(getEventDetail)
      .mockRejectedValueOnce(new EventApiError("NETWORK", 0))
      .mockResolvedValueOnce(
        eventDetailFixture({ name: "Edited", revision: 4 }),
      );
    changeName();
    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", { name: "Load current detail" }),
    );
    await screen.findByText(/Current detail could not be loaded/);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Load current detail" }),
    );
    await screen.findByText("Changes confirmed in current detail.");
    expect(editEvent).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 404])(
    "refreshes authority on %s without retrying the write",
    async (status) => {
      const props = form(false);
      vi.mocked(editEvent).mockRejectedValue(
        new EventApiError("DENIED", status),
      );
      changeName();
      await vi.waitFor(() =>
        expect(
          status === 401 ? props.onSessionExpired : props.onScopeLost,
        ).toHaveBeenCalledOnce(),
      );
      expect(editEvent).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["LIVE", "COMPLETED", "CANCELLED"] as const)(
    "hides editing in %s even if actions are stale",
    async (state) => {
      vi.mocked(getEventDetail).mockResolvedValue(
        eventDetailFixture({ state }),
      );
      render(
        <EventDetail
          context={{
            eventId: "one",
            name: "Owned draft",
            state,
            relationship: "owned",
          }}
          csrf="csrf"
          onSessionExpired={vi.fn()}
          onScopeLost={vi.fn()}
        />,
      );
      await screen.findByRole("heading", { name: "Owned draft" });
      expect(
        screen.queryByRole("button", { name: "Edit event" }),
      ).not.toBeInTheDocument();
    },
  );
  it("ignores an edit response after its role/context was unmounted", async () => {
    let resolve!: (detail: ReturnType<typeof eventDetailFixture>) => void;
    vi.mocked(editEvent).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const props = {
      detail: eventDetailFixture(),
      owner: false,
      csrf: "csrf",
      onCurrent: vi.fn(),
      onSessionExpired: vi.fn(),
      onScopeLost: vi.fn(),
    };
    const view = render(<EditEventForm {...props} />);
    changeName();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    view.unmount();
    resolve(eventDetailFixture({ name: "Edited", revision: 4 }));
    await vi.waitFor(() => expect(props.onCurrent).not.toHaveBeenCalled());
  });
});
