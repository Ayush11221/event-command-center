import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentActor, ProofError, type ActorState } from "../services/proof";
import {
  reviewRequest,
  type Task,
  type TaskList,
  type Results,
} from "../services/event-review";
import { getEventDetail } from "../services/events";
import { eventDetailFixture } from "../test/event-fixture";
import { listStaff } from "../services/staff";
import { TasksPage, VolunteerEntry } from "./TasksPage";
import { ResultsPage } from "./ResultsPage";
import { AuditPage } from "./AuditPage";
vi.mock("../services/proof", async () => ({
  ...(await vi.importActual("../services/proof")),
  currentActor: vi.fn(),
}));
vi.mock("../services/event-review", async () => ({
  ...(await vi.importActual("../services/event-review")),
  reviewRequest: vi.fn(),
}));
vi.mock("../services/events", async (original) => ({
  ...(await original<typeof import("../services/events")>()),
  getEventDetail: vi.fn(),
}));
vi.mock("../services/staff", async (original) => ({
  ...(await original<typeof import("../services/staff")>()),
  listStaff: vi.fn(),
}));
const actor: ActorState = {
  user_id: "vol",
  organizer_capable: false,
  assignments: [
    { id: "grant", event_id: "event", role: "VOLUNTEER", gate_id: null },
  ],
  csrf_token: "csrf",
};
const task: Task = {
  id: "task",
  event_id: "event",
  assigned_volunteer_id: "vol",
  title: "Arrival desk",
  instructions: "Plain <script> instructions",
  location: null,
  starts_at: null,
  ends_at: null,
  status: "ASSIGNED",
  created_at: "2026-10-03T10:00:00.000Z",
  updated_at: "2026-10-03T10:00:00.000Z",
  cancelled_at: null,
  cancelled_by_user_id: null,
  cancellation_reason: null,
};
const list: TaskList = {
  event: { event_id: "event", event_name: "Test event" },
  items: [task],
  next_cursor: null,
};
const api = vi.mocked(reviewRequest);
beforeEach(() => {
  vi.mocked(getEventDetail).mockResolvedValue(
    eventDetailFixture({ event_id: "event", time_zone: "Asia/Kolkata" }),
  );
  vi.mocked(listStaff).mockResolvedValue({
    assignments: [],
    allowed_roles: [],
  });
  vi.mocked(currentActor).mockResolvedValue(actor);
  api.mockImplementation(async (path) =>
    path.includes("?")
      ? { data: structuredClone(list), etag: null }
      : { data: { task: structuredClone(task) }, etag: '"1"' },
  );
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe("Slice 11 screens", () => {
  it("volunteer progress waits for acknowledgement and never exposes staff controls", async () => {
    let finish!: (value: { data: unknown; etag: string | null }) => void;
    api.mockImplementation(async (_path, _signal, command) =>
      command
        ? new Promise((r) => (finish = r))
        : _path.includes("?")
          ? { data: list, etag: null }
          : { data: { task }, etag: '"1"' },
    );
    render(<TasksPage eventId="event" taskId="task" />);
    await screen.findByRole("button", { name: "Start task" });
    expect(screen.queryByRole("button", { name: "Cancel task" })).toBeNull();
    expect(screen.getByText(task.instructions)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Start task" }));
    expect(screen.getByRole("button", { name: "Start task" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Complete task" })).toBeNull();
    await act(async () =>
      finish({
        data: { task: { ...task, status: "IN_PROGRESS" } },
        etag: '"2"',
      }),
    );
    await screen.findByRole("button", { name: "Complete task" });
    expect(api.mock.calls.find((c) => c[2])![2]).toMatchObject({
      body: { status: "IN_PROGRESS" },
      etag: '"1"',
      csrf: "csrf",
    });
  });
  it("keeps command key/body/precondition through unknown outcome and refresh", async () => {
    let calls = 0;
    api.mockImplementation(async (path, _signal, command) => {
      if (command) {
        if (++calls === 1) throw new ProofError("NETWORK", 0);
        return {
          data: { task: { ...task, status: "IN_PROGRESS" } },
          etag: '"2"',
        };
      }
      return path.includes("?")
        ? { data: list, etag: null }
        : { data: { task }, etag: '"1"' };
    });
    render(<TasksPage eventId="event" taskId="task" />);
    fireEvent.click(await screen.findByRole("button", { name: "Start task" }));
    await screen.findByRole("button", { name: "Retry same command" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh tasks" }));
    await screen.findByRole("button", { name: "Start task" });
    fireEvent.click(screen.getByRole("button", { name: "Retry same command" }));
    await screen.findByRole("button", { name: "Complete task" });
    const writes = api.mock.calls.filter((c) => c[2]);
    expect(writes[1]![2]).toEqual(writes[0]![2]);
  });
  it("requires refresh after stale revision and clears private data after revoked access", async () => {
    api.mockImplementation(async (path, _signal, command) => {
      if (command) throw new ProofError("VERSION_CONFLICT", 409);
      return path.includes("?")
        ? { data: list, etag: null }
        : { data: { task }, etag: '"1"' };
    });
    render(<TasksPage eventId="event" taskId="task" />);
    fireEvent.click(await screen.findByRole("button", { name: "Start task" }));
    await screen.findByText(/The task changed/);
    expect(screen.getByRole("button", { name: "Start task" })).toBeDisabled();
    api.mockRejectedValue(new ProofError("TASK_NOT_FOUND", 404));
    fireEvent.click(screen.getByRole("button", { name: "Refresh tasks" }));
    await screen.findByText(/no longer assigned/);
    expect(screen.queryByText(task.instructions)).toBeNull();
    expect(screen.queryByText("Test event")).toBeNull();
  });
  it("staff cancellation retains reason/history and hides terminal editing controls", async () => {
    api.mockImplementation(async (path, _signal, command) =>
      command
        ? {
            data: {
              task: {
                ...task,
                status: "CANCELLED",
                cancellation_reason: "Shift ended",
                cancelled_at: task.updated_at,
                cancelled_by_user_id: "manager",
              },
            },
            etag: '"2"',
          }
        : path.includes("?")
          ? { data: list, etag: null }
          : { data: { task }, etag: '"1"' },
    );
    render(<TasksPage eventId="event" staff />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Arrival desk/ }),
    );
    const detail = within(
      await screen.findByRole("region", { name: "Task details" }),
    );
    fireEvent.change(detail.getByLabelText("Cancellation reason"), {
      target: { value: "Shift ended" },
    });
    fireEvent.click(detail.getByRole("button", { name: "Cancel task" }));
    await screen.findByText("Cancellation reason: Shift ended");
    expect(screen.queryByRole("button", { name: "Save details" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reassign task" })).toBeNull();
    expect(screen.getByText("This task is read-only.")).toBeVisible();
  });
  it("volunteer entry exposes only current volunteer assignment destinations", async () => {
    render(<VolunteerEntry />);
    const link = await screen.findByRole("link", {
      name: /View assigned event/,
    });
    expect(link).toHaveAttribute("href", "/volunteer/event/tasks");
    expect(screen.queryByRole("link", { name: /Manage/ })).toBeNull();
  });
  it("results present factual limitations/as-of and withhold metrics for non-completed events", async () => {
    const results: Results = {
      event_id: "event",
      event_state: "COMPLETED",
      total_registrations: 3,
      cancelled_registrations: 1,
      accepted_check_ins: 1,
      attendance_rate_percentage: 50,
      gate_check_ins: [{ gate_id: "gate", accepted_check_ins: 0 }],
      certificate_eligible_count: 1,
      certificate_issued_count: 0,
      certificate_revoked_count: 0,
      certificate_delivery_counts: {
        NOT_REQUIRED: 0,
        PENDING: 0,
        SENDING: 0,
        SENT: 0,
        UNKNOWN: 0,
        FAILED: 0,
      },
      data_limitations: [
        "NO_EXIT_OR_DWELL_DATA",
        "HISTORICAL_OCCUPANCY_NOT_RECORDED",
      ],
      as_of: task.updated_at,
    };
    api.mockResolvedValue({ data: { results }, etag: null });
    render(<ResultsPage eventId="event" />);
    await screen.findByText("50%");
    expect(
      screen.getByText("Exit and dwell-duration data are unavailable."),
    ).toBeVisible();
    expect(screen.getByText(/As of/)).toBeVisible();
    api.mockRejectedValue(new ProofError("RESULTS_NOT_COMPLETED", 409));
    fireEvent.click(screen.getByRole("button", { name: "Refresh results" }));
    await screen.findByText(/Results are available after/);
    expect(screen.queryByText("50%")).toBeNull();
  });
  it("audit exact filters and pagination retain scope and show empty state", async () => {
    api
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              id: "audit",
              event_id: "event",
              actor: { kind: "SYSTEM", id: null },
              action: "EVENT_UPDATED",
              target_type: "EVENT",
              target_id: "event",
              outcome: "SUCCESS",
              occurred_at: task.updated_at,
              correlation_id: "correlation",
            },
          ],
          next_cursor: "signed",
        },
        etag: null,
      })
      .mockResolvedValue({
        data: { items: [], next_cursor: null },
        etag: null,
      });
    render(<AuditPage eventId="event" />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Next activity" }),
    );
    await screen.findByText("No matching activity.");
    expect(api.mock.calls[1]![0]).toContain("cursor=signed");
    fireEvent.change(screen.getByLabelText("Action (exact)"), {
      target: { value: "EVENT_UPDATED" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search activity" }));
    await waitFor(() =>
      expect(api.mock.calls.at(-1)![0]).toBe(
        "/events/event/audit-events?action=EVENT_UPDATED",
      ),
    );
    expect(screen.queryByText("correlation")).toBeNull();
  });
});
