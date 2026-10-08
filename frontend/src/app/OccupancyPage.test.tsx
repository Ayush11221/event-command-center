import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventApiError, getEventDetail } from "../services/events";
import { eventDetailFixture } from "../test/event-fixture";
import { getOperations, type OperationsSnapshot } from "../services/occupancy";
import { OccupancyPage } from "./OccupancyPage";
import { currentActor } from "../services/proof";
vi.mock("../services/proof", async (original) => ({
  ...(await original<typeof import("../services/proof")>()),
  currentActor: vi.fn(),
}));
vi.mock("../services/operations-realtime", () => ({
  connectOperations: () => ({
    on: () => {},
    connect: () => {},
    disconnect: () => {},
    emit: () => {},
    removeAllListeners: () => {},
    connected: false,
  }),
}));
vi.mock("../services/occupancy", () => ({ getOperations: vi.fn() }));
vi.mock("../services/events", async (original) => ({
  ...(await original<typeof import("../services/events")>()),
  getEventDetail: vi.fn(),
}));
const snapshot: OperationsSnapshot = {
  event_id: "event",
  event_name: "Internal event",
  event_state: "LIVE",
  occupied: 2,
  registered: 3,
  capacity: 1,
  remaining: -1,
  utilization_percentage: 200,
  attendance_state: "INSIDE",
  last_attendance_at: "2026-10-03T00:00:00Z",
  calculated_at: "2026-10-03T00:01:00Z",
  correlation_id: "correlation",
  revision: 2,
  as_of: "2026-10-03T00:01:00Z",
};
beforeEach(() => {
  vi.mocked(currentActor).mockResolvedValue({
    user_id: "owner",
    organizer_capable: true,
    csrf_token: "csrf",
    assignments: [],
  });
  vi.mocked(getOperations).mockResolvedValue(snapshot);
  vi.mocked(getEventDetail).mockResolvedValue(
    eventDetailFixture({ event_id: "event", time_zone: "Asia/Kolkata" }),
  );
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe("occupancy operations view", () => {
  it("shows the assigned event role only with an authoritative operations snapshot", async () => {
    vi.mocked(currentActor).mockResolvedValue({
      user_id: "admin",
      organizer_capable: false,
      csrf_token: "csrf",
      assignments: [
        {
          id: "assignment",
          event_id: "event",
          gate_id: null,
          role: "EVENT_ADMIN",
        },
      ],
    });
    render(<OccupancyPage eventId="event" />);
    expect(await screen.findByText("Role: Event Admin")).toBeVisible();
    expect(screen.getByText(/Confirmed as of:/)).toBeVisible();
  });
  it("holds values until an authorized snapshot resolves", () => {
    vi.mocked(getOperations).mockReturnValue(new Promise(() => {}));
    render(<OccupancyPage eventId="event" />);
    expect(screen.getByText(/Loading occupancy/)).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.queryByText("200%")).not.toBeInTheDocument();
  });
  it("shows above-capacity arithmetic as factual state distinct from registration", async () => {
    render(<OccupancyPage eventId="event" />);
    await screen.findByText("200%");
    expect(screen.getByText("-1")).toBeVisible();
    expect(screen.getByText("3")).toBeVisible();
    expect(screen.getByText(/Above configured/)).toHaveTextContent(
      "valid registered participants may still check in",
    );
    expect(screen.getByText(/Calculated:/)).toHaveTextContent(
      "Attendance last changed:",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /register|check in|correct/i }),
    ).not.toBeInTheDocument();
  });
  it.each([
    [0, 2, 2, 0, "No accepted check-ins recorded."],
    [2, 2, 0, 100, "At configured registration capacity."],
    [1, 2, 1, 50, "Below configured registration capacity."],
  ])(
    "represents occupancy %s",
    async (occupied, capacity, remaining, utilization_percentage, message) => {
      vi.mocked(getOperations).mockResolvedValue({
        ...snapshot,
        occupied,
        capacity,
        remaining,
        utilization_percentage,
      });
      render(<OccupancyPage eventId="event" />);
      await screen.findByText(new RegExp(message));
    },
  );
  it("represents a legacy unset capacity without a false comparison", async () => {
    vi.mocked(getOperations).mockResolvedValue({
      ...snapshot,
      capacity: null,
      remaining: null,
      utilization_percentage: null,
    });
    render(<OccupancyPage eventId="event" />);
    await screen.findByText("Not configured");
    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    expect(
      screen.getByText(/capacity comparison is unavailable/),
    ).toBeVisible();
  });
  it.each([401, 403, 404, 409, 503, 0])(
    "handles %s with safe retry and no stale occupancy",
    async (status) => {
      vi.mocked(getOperations).mockRejectedValueOnce(
        new EventApiError("FAILURE", status, "ref"),
      );
      render(<OccupancyPage eventId="event" />);
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(
        status === 401
          ? "Sign in"
          : status === 403 || status === 404
            ? "access may have changed"
            : "Retry to read",
      );
      expect(screen.queryByText("200%")).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: "Retry operations read" }),
      );
      await screen.findByText("200%");
    },
  );
  it("clears old data when refresh discovers scope loss", async () => {
    render(<OccupancyPage eventId="event" />);
    await screen.findByText("200%");
    vi.mocked(getOperations).mockRejectedValue(
      new EventApiError("EVENT_NOT_FOUND", 404),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh occupancy" }));
    await screen.findByRole("alert");
    expect(screen.queryByText("Internal event")).not.toBeInTheDocument();
  });
  it("uses a manual refresh and aborts late results when hidden", async () => {
    render(<OccupancyPage eventId="event" />);
    await screen.findByText("200%");
    expect(getOperations).toHaveBeenCalledTimes(1);
    fireEvent(window, new Event("pagehide"));
    expect(screen.queryByText("200%")).not.toBeInTheDocument();
    expect(vi.mocked(getOperations).mock.calls[0][1].aborted).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Retry operations read" }),
    );
    await screen.findByText("200%");
    expect(getOperations).toHaveBeenCalledTimes(2);
  });
  it("aborts reads and ignores late responses on unmount", async () => {
    let resolve!: (s: OperationsSnapshot) => void;
    vi.mocked(getOperations).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(<OccupancyPage eventId="event" />);
    const signal = vi.mocked(getOperations).mock.calls[0][1];
    view.unmount();
    resolve(snapshot);
    await waitFor(() => expect(signal.aborted).toBe(true));
  });
});
