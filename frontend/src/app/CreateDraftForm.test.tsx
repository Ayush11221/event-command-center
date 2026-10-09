import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDraft,
  editEvent,
  createGate,
  getEventDetail,
  EventApiError,
} from "../services/events";
import { CreateDraftForm } from "./CreateDraftForm";
import { eventDetailFixture } from "../test/event-fixture";

vi.mock("../services/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/events")>();
  return {
    ...actual,
    createDraft: vi.fn(),
    editEvent: vi.fn(),
    getEventDetail: vi.fn(),
    createGate: vi.fn(),
  };
});

beforeEach(() => {
  vi.mocked(getEventDetail).mockResolvedValue(
    eventDetailFixture({ event_id: "new-id", revision: 1 }),
  );
  vi.mocked(editEvent).mockImplementation(async (_id, _revision, patch) =>
    eventDetailFixture({ ...patch, event_id: "new-id", revision: 2 }),
  );
  vi.mocked(createGate).mockResolvedValue({
    gate_id: "gate",
    event_id: "new-id",
    revision: 3,
    readiness: {
      configured_gate_present: true,
      publish_blockers: [],
      live_blockers: [],
    },
    as_of: "now",
    correlation_id: "c",
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function form() {
  const onCreated = vi.fn();
  render(
    <CreateDraftForm
      csrf="csrf"
      onCreated={onCreated}
      onSessionExpired={vi.fn()}
      onForbidden={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Event starts date"), {
    target: { value: "2030-01-20" },
  });
  fireEvent.change(screen.getByLabelText("Event starts time"), {
    target: { value: "09:00" },
  });
  fireEvent.change(screen.getByLabelText("Event ends date"), {
    target: { value: "2030-01-20" },
  });
  fireEvent.change(screen.getByLabelText("Event ends time"), {
    target: { value: "17:00" },
  });
  return onCreated;
}

describe("Draft creation", () => {
  it("validates the complete schedule before creating any draft", () => {
    form();
    fireEvent.change(screen.getByLabelText(/Event name/), {
      target: { value: "Synthetic event" },
    });
    fireEvent.change(screen.getByLabelText("Event ends time"), {
      target: { value: "08:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "must end after it starts",
    );
    expect(createDraft).not.toHaveBeenCalled();
  });
  it("retains a partially saved draft and offers review when configuration fails", async () => {
    const onCreated = form();
    vi.mocked(createDraft).mockResolvedValue({
      event_id: "new-id",
      name: "Partial",
      state: "DRAFT",
      revision: 1,
      as_of: "now",
      correlation_id: "c",
    });
    vi.mocked(editEvent).mockRejectedValue(
      new EventApiError("VALIDATION", 400),
    );
    fireEvent.change(screen.getByLabelText(/Event name/), {
      target: { value: "Partial" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    await screen.findByText(/Your draft was saved/);
    fireEvent.click(screen.getByRole("button", { name: "Open saved draft" }));
    expect(onCreated).toHaveBeenCalledWith("new-id");
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(createGate).not.toHaveBeenCalled();
  });
  it("saves the essential event settings in IST, adds Gate 1 and keeps the event a draft", async () => {
    const onCreated = form();
    vi.mocked(createDraft).mockResolvedValue({
      event_id: "new-id",
      name: "Opening night",
      state: "DRAFT",
      revision: 1,
      as_of: "2030-01-01T00:00:00Z",
      correlation_id: "c",
    });
    fireEvent.change(screen.getByLabelText(/Event name/), {
      target: { value: "  Opening night  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    expect(
      await screen.findByText(/Draft “Opening night” created/),
    ).toBeVisible();
    expect(vi.mocked(createDraft).mock.calls[0]?.[0]).toBe("Opening night");
    expect(vi.mocked(createDraft).mock.calls[0]?.[1]).toBe("csrf");
    expect(vi.mocked(createDraft).mock.calls[0]?.[2]).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(editEvent).toHaveBeenCalledWith(
      "new-id",
      1,
      {
        start_at: "2030-01-20T03:30:00.000Z",
        end_at: "2030-01-20T11:30:00.000Z",
        time_zone: "Asia/Kolkata",
        registration_capacity: 100,
        visibility: "PUBLIC",
        public_location: null,
      },
      "csrf",
    );
    expect(createGate).toHaveBeenCalledWith(
      "new-id",
      2,
      "csrf",
      expect.any(String),
    );
    expect(onCreated).toHaveBeenCalledWith("new-id");
    expect(screen.getByLabelText(/Event name/)).toHaveValue("");
  });

  it("keeps an unknown result bound to the same request and key on retry", async () => {
    form();
    vi.mocked(createDraft)
      .mockRejectedValueOnce(new EventApiError("NETWORK", 0))
      .mockResolvedValueOnce({
        event_id: "new-id",
        name: "Uncertain",
        state: "DRAFT",
        revision: 1,
        as_of: "now",
        correlation_id: "c",
      });
    fireEvent.change(screen.getByLabelText(/Event name/), {
      target: { value: "Uncertain" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    expect(await screen.findByText(/result is unknown/)).toBeVisible();
    expect(screen.getByLabelText(/Event name/)).toBeDisabled();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Retry same request" }),
      ).toHaveFocus(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry same request" }));
    expect(await screen.findByText(/Draft “Uncertain” created/)).toBeVisible();
    expect(vi.mocked(createDraft).mock.calls[1]).toEqual(
      vi.mocked(createDraft).mock.calls[0],
    );
  });

  it("shows a field error without losing the entered name", async () => {
    form();
    vi.mocked(createDraft).mockRejectedValue(
      new EventApiError("VALIDATION", 400, "ref", { field: "name" }),
    );
    fireEvent.change(screen.getByLabelText(/Event name/), {
      target: { value: "Needs correction" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    expect(
      await screen.findByText(/Enter a nonblank event name/),
    ).toBeVisible();
    expect(screen.getByLabelText(/Event name/)).toHaveValue("Needs correction");
    expect(screen.getByLabelText(/Event name/)).toHaveFocus();
  });

  it("uses the database's 200-character limit for Unicode names", async () => {
    form();
    const name = "🎟".repeat(201);
    fireEvent.change(screen.getByLabelText(/Event name/), {
      target: { value: name },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create event" }));
    expect(screen.getByText(/Enter a nonblank event name/)).toBeVisible();
    expect(createDraft).not.toHaveBeenCalled();
  });
});
