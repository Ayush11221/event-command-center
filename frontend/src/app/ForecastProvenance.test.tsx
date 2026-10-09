import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ForecastCurrent, ForecastRun } from "../services/forecasting";
import type { OperationsSnapshot } from "../services/occupancy";
import { listStaff } from "../services/staff";
import { BigScreen } from "./BigScreen";
import { OccupancyTrend } from "./OccupancyTrend";
import { VenueView } from "./VenueView";

vi.mock("../services/staff", () => ({ listStaff: vi.fn() }));

const fixture: ForecastCurrent = JSON.parse(
  readFileSync("../tests/fixtures/slice8-forecast.json", "utf8"),
);
const snapshot: OperationsSnapshot = {
  ...fixture.observed,
  event_id: fixture.event_id,
  event_name: "Synthetic forecast event",
  event_state: "LIVE",
  registered: 300,
  remaining: -269,
  utilization_percentage: 27000,
  last_attendance_at: fixture.as_of,
  calculated_at: fixture.as_of,
  correlation_id: "fixture",
};
const samples = [
  { at: Date.parse(fixture.as_of), occupied: snapshot.occupied },
];
const surfaces = ["trend", "venue", "big screen"] as const;
type Surface = (typeof surfaces)[number];

function show(surface: Surface, forecast: ForecastRun | null, stale = false) {
  const props = { forecast, forecastStale: stale };
  if (surface === "trend")
    return render(
      <OccupancyTrend
        {...props}
        samples={samples}
        capacity={snapshot.capacity}
        timeZone="UTC"
      />,
    );
  if (surface === "venue")
    return render(
      <VenueView
        {...props}
        eventId={fixture.event_id}
        occupied={snapshot.occupied}
        capacity={snapshot.capacity}
        gates={[]}
      />,
    );
  return render(
    <BigScreen
      {...props}
      eventId={fixture.event_id}
      snapshot={snapshot}
      connectionTone="live"
      connectionLabel="Live"
      samples={samples}
      gates={[]}
      timeZone="UTC"
      onClose={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.mocked(listStaff).mockResolvedValue({
    assignments: [],
    allowed_roles: [],
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe.each(surfaces)("%s forecast provenance", (surface) => {
  it.each(["available", "stale", "unavailable", "missing"])(
    "discloses synthetic attendance for %s forecasts without a page banner",
    async (state) => {
      vi.stubEnv("VITE_FORECAST_DEMO", "synthetic_local");
      const forecast =
        state === "missing" ? null : structuredClone(fixture.forecast);
      if (forecast && state === "unavailable") {
        Object.assign(forecast, {
          status: "INSUFFICIENT_DATA",
          points: [],
          evaluation: null,
        });
        Object.assign(forecast.freshness, {
          state: "UNAVAILABLE",
          reason: "INSUFFICIENT_DATA",
        });
      }
      show(surface, forecast, state === "stale");
      await vi.waitFor(() =>
        expect(listStaff).toHaveBeenCalledTimes(surface === "trend" ? 0 : 1),
      );

      const scope =
        surface === "big screen"
          ? within(screen.getByRole("region", { name: "Advisory forecast" }))
          : screen;
      const notice = scope.getByLabelText("Synthetic forecast provenance");
      expect(notice).toBeVisible();
      expect(notice).toHaveTextContent(
        "Forecast computed from synthetic attendance",
      );
      expect(notice).toHaveTextContent("not for live operational decisions");
      expect(
        screen.queryByLabelText("Synthetic demo environment"),
      ).not.toBeInTheDocument();

      // Schematic/chart accessible summaries carry the same provenance.
      expect(screen.getByRole("img")).toHaveAttribute(
        "aria-label",
        expect.stringContaining("synthetic attendance"),
      );
      if (surface === "big screen")
        expect(
          within(screen.getByRole("region", { name: "Venue" })).getByLabelText(
            "Synthetic forecast provenance",
          ),
        ).toBeVisible();
    },
  );

  it("keeps ordinary builds free of synthetic demo labels", async () => {
    vi.stubEnv("VITE_FORECAST_DEMO", "");
    show(surface, fixture.forecast);
    await vi.waitFor(() =>
      expect(listStaff).toHaveBeenCalledTimes(surface === "trend" ? 0 : 1),
    );
    expect(
      screen.queryByLabelText("Synthetic forecast provenance"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("img").getAttribute("aria-label")).not.toContain(
      "synthetic attendance",
    );
  });
});
