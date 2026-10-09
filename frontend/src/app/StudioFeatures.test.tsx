import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventCampus } from "./EventCampus";
import { GuidedTour } from "./GuidedTour";
import { BigScreen } from "./BigScreen";
import { Celebration } from "../components/common/Celebration";
import type { OperationsSnapshot } from "../services/occupancy";

vi.mock("../services/staff", () => ({
  listStaff: vi.fn().mockRejectedValue(new Error("not needed")),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const event = (id: string, state: "DRAFT" | "LIVE") => ({
  event_id: id,
  name: `Event ${id}`,
  state,
  start_at: null,
  end_at: null,
  time_zone: null,
  relationship: "owned" as const,
});

describe("Event campus", () => {
  it("draws one decorative building per event styled by real state", () => {
    const open = vi.fn();
    const { container } = render(
      <EventCampus
        events={[event("a", "DRAFT"), event("b", "LIVE")]}
        selectedId="b"
        onOpen={open}
      />,
    );
    const campus = container.querySelector(".campus")!;
    expect(campus).toHaveAttribute("aria-hidden", "true");
    expect(campus.textContent).toBe("");
    expect(container.querySelector(".cb-draft")).toBeInTheDocument();
    expect(container.querySelector(".cb-live.is-selected")).toBeInTheDocument();
    fireEvent.click(container.querySelector(".cb-draft")!);
    expect(open).toHaveBeenCalledWith("a");
  });
});

describe("Guided tour", () => {
  it("only visits rendered targets and closes on Escape", () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div class="present"></div>',
    );
    const close = vi.fn();
    render(
      <GuidedTour
        steps={[
          { target: ".missing", title: "Missing", body: "x" },
          { target: ".present", title: "Present", body: "y" },
        ]}
        onClose={close}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Present" })).toBeVisible();
    expect(screen.getByText("Step 1 of 1")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalled();
    document.querySelector(".present")?.remove();
  });
});

describe("Big screen", () => {
  it("lists only observed changes derived from authoritative samples", () => {
    const snapshot: OperationsSnapshot = {
      event_id: "e",
      event_name: "Hall",
      event_state: "LIVE",
      occupied: 12,
      registered: 40,
      capacity: 50,
      remaining: 38,
      utilization_percentage: 24,
      attendance_state: "INSIDE",
      last_attendance_at: null,
      calculated_at: "2026-10-09T10:00:00.000Z",
      correlation_id: "c",
      revision: 3,
      as_of: "2026-10-09T10:00:00.000Z",
    };
    render(
      <BigScreen
        eventId="e"
        snapshot={snapshot}
        forecast={null}
        forecastStale={false}
        connectionTone="live"
        connectionLabel="Live"
        samples={[
          { at: 1, occupied: 9 },
          { at: 2, occupied: 9 },
          { at: 3, occupied: 12 },
        ]}
        gates={[]}
        timeZone="UTC"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("+3")).toBeInTheDocument();
    expect(screen.queryByText("+0")).not.toBeInTheDocument();
    expect(screen.getByText("No current forecast.")).toBeInTheDocument();
  });
});

describe("Celebration", () => {
  it("renders nothing under reduced motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener() {},
        removeEventListener() {},
      })),
    );
    const { container } = render(<Celebration trigger={1} />);
    expect(container.querySelector(".celebration")).toBeNull();
  });
});
