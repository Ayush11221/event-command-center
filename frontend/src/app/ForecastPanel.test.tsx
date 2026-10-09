import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCurrentForecast,
  type ForecastCurrent,
} from "../services/forecasting";
import type { OperationsSnapshot } from "../services/occupancy";
import { EventApiError } from "../services/events";
import { ForecastPanel } from "./ForecastPanel";
vi.mock("../services/forecasting", () => ({ getCurrentForecast: vi.fn() }));
const fixture: ForecastCurrent = JSON.parse(
  readFileSync("../tests/fixtures/slice8-forecast.json", "utf8"),
);
const eventId = fixture.event_id;
const snapshot: OperationsSnapshot = {
  ...fixture.observed,
  event_id: eventId,
  event_name: "Forecast event",
  event_state: "LIVE",
  registered: 300,
  remaining: -269,
  utilization_percentage: 27000,
  last_attendance_at: fixture.as_of,
  calculated_at: fixture.as_of,
  correlation_id: "fixture",
};
const props = {
  eventId,
  operations: { phase: "ready" as const, snapshot },
  connection: "Live — confirmed by operations snapshot",
};
beforeEach(() => {
  vi.mocked(getCurrentForecast).mockResolvedValue(structuredClone(fixture));
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe("Command center advisory forecasts", () => {
  it.each(["available", "insufficient", "stale", "failed"])(
    "retains synthetic provenance for a %s demo forecast",
    async (state) => {
      vi.stubEnv("VITE_FORECAST_DEMO", "synthetic_local");
      const response = structuredClone(fixture);
      if (state === "insufficient")
        Object.assign(response.forecast, {
          status: "INSUFFICIENT_DATA",
          points: [],
          evaluation: null,
        });
      if (state === "stale") response.forecast.freshness.state = "STALE";
      if (state === "failed")
        vi.mocked(getCurrentForecast).mockRejectedValue(
          new EventApiError("DEPENDENCY_UNAVAILABLE", 503),
        );
      else vi.mocked(getCurrentForecast).mockResolvedValue(response);
      render(<ForecastPanel {...props} />);
      const notice = {
        available: /Current demo forecast/,
        insufficient: /Not enough accepted attendance/,
        stale: /Stale forecast/,
        failed: /Forecast read failed/,
      }[state]!;
      await screen.findByText(notice);
      expect(
        screen.getByLabelText("Synthetic forecast provenance"),
      ).toHaveTextContent("Forecast computed from synthetic attendance");
      expect(
        screen.getByLabelText("Synthetic forecast provenance"),
      ).toHaveTextContent("not for live operational decisions");
    },
  );
  it("waits for operations authority, then renders independent baseline uncertainty/evaluation", async () => {
    const view = render(
      <ForecastPanel {...props} operations={{ phase: "loading" }} />,
    );
    expect(getCurrentForecast).not.toHaveBeenCalled();
    view.rerender(<ForecastPanel {...props} />);
    await screen.findByText("Current advisory forecast.");
    expect(getCurrentForecast).toHaveBeenCalledTimes(1);
    expect(screen.getByText("30-minute prediction")).toBeVisible();
    expect(screen.getByText(/Empirical interval: 240/)).toBeVisible();
    fireEvent.click(screen.getByText("Retrospective evaluation"));
    expect(screen.getByText(/30 minutes: 60 test origins/)).toBeVisible();
  });
  it("does not generate on occupancy changes and labels incompatible retained points stale", async () => {
    const view = render(<ForecastPanel {...props} />);
    await screen.findByText("Current advisory forecast.");
    view.rerender(
      <ForecastPanel
        {...props}
        operations={{
          phase: "ready",
          snapshot: { ...snapshot, revision: 271, occupied: 271 },
        }}
      />,
    );
    expect(screen.getByText(/Stale forecast/)).toBeVisible();
    expect(getCurrentForecast).toHaveBeenCalledTimes(1);
    view.rerender(
      <ForecastPanel
        {...props}
        connection="Reconciling — attendance changed"
      />,
    );
    expect(screen.getByText("30-minute prediction (stale)")).toBeVisible();
    expect(getCurrentForecast).toHaveBeenCalledTimes(1);
    view.rerender(
      <ForecastPanel
        {...props}
        operations={{ phase: "error", status: 503, message: "Read failed" }}
        connection="Unconfirmed — reconciliation failed"
      />,
    );
    expect(screen.getByText("30-minute prediction (stale)")).toBeVisible();
    expect(getCurrentForecast).toHaveBeenCalledTimes(1);
  });
  it("marks age stale locally without generation and refreshes every visible 60 seconds", async () => {
    vi.useFakeTimers();
    vi.mocked(getCurrentForecast).mockResolvedValue({
      ...structuredClone(fixture),
      as_of: "2026-10-03T12:00:59.000Z",
    });
    render(<ForecastPanel {...props} />);
    await act(async () => {});
    expect(getCurrentForecast).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText(/Stale forecast/)).toBeVisible();
    expect(getCurrentForecast).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59000);
    });
    expect(getCurrentForecast).toHaveBeenCalledTimes(2);
  });
  it("never overlaps refreshes, including foreground and cadence", async () => {
    vi.useFakeTimers();
    vi.mocked(getCurrentForecast).mockReturnValue(new Promise(() => {}));
    render(<ForecastPanel {...props} />);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Refresh forecast" }));
    fireEvent(document, new Event("visibilitychange"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120000);
    });
    expect(getCurrentForecast).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button")).toBeDisabled();
  });
  it("pauses hidden-page generation and refreshes on foreground", async () => {
    vi.useFakeTimers();
    let visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibility as DocumentVisibilityState,
    );
    render(<ForecastPanel {...props} />);
    await act(async () => {});
    visibility = "hidden";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(getCurrentForecast).toHaveBeenCalledTimes(1);
    visibility = "visible";
    await act(async () => {
      fireEvent(document, new Event("visibilitychange"));
    });
    expect(getCurrentForecast).toHaveBeenCalledTimes(2);
  });
  it.each([401, 404])(
    "clears forecasts and aborts on operations authority loss (%s)",
    async (status) => {
      const view = render(<ForecastPanel {...props} />);
      await screen.findByText("Current advisory forecast.");
      const signal = vi.mocked(getCurrentForecast).mock.calls[0][1];
      view.rerender(
        <ForecastPanel
          {...props}
          operations={{ phase: "error", status, message: "access lost" }}
        />,
      );
      expect(screen.queryByText("Crowd forecast")).not.toBeInTheDocument();
      expect(signal.aborted).toBe(true);
    },
  );
  it("ignores late old-event results and clears on pagehide", async () => {
    let resolve!: (value: ForecastCurrent) => void;
    vi.mocked(getCurrentForecast).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(<ForecastPanel {...props} />);
    await waitFor(() => expect(getCurrentForecast).toHaveBeenCalledTimes(1));
    const oldSignal = vi.mocked(getCurrentForecast).mock.calls[0][1];
    view.rerender(
      <ForecastPanel
        {...props}
        eventId="cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        operations={{ phase: "loading" }}
      />,
    );
    await act(async () => {
      resolve(fixture);
    });
    expect(oldSignal.aborted).toBe(true);
    expect(screen.queryByText("30-minute prediction")).not.toBeInTheDocument();
    view.rerender(<ForecastPanel {...props} />);
    await screen.findByText("Current advisory forecast.");
    fireEvent(window, new Event("pagehide"));
    expect(screen.queryByText("30-minute prediction")).not.toBeInTheDocument();
    expect(vi.mocked(getCurrentForecast).mock.calls.at(-1)![1].aborted).toBe(
      true,
    );
  });
  it("replaces an available run with the latest unavailable attempt, never hiding failure", async () => {
    render(<ForecastPanel {...props} />);
    await screen.findByText("Current advisory forecast.");
    const unavailable = structuredClone(fixture);
    Object.assign(unavailable.forecast, {
      status: "MODEL_UNAVAILABLE",
      points: [],
      evaluation: null,
      freshness: {
        state: "UNAVAILABLE",
        reason: "MODEL_UNAVAILABLE",
        expires_at: fixture.forecast.freshness.expires_at,
      },
    });
    vi.mocked(getCurrentForecast).mockResolvedValue(unavailable);
    fireEvent.click(screen.getByRole("button", { name: "Refresh forecast" }));
    await screen.findByText(/Forecast unavailable/);
    expect(screen.queryByText("30-minute prediction")).not.toBeInTheDocument();
  });
  it("retains generation time and explicit stale label on HTTP failure, clears on forecast access denial", async () => {
    render(<ForecastPanel {...props} />);
    await screen.findByText("Current advisory forecast.");
    vi.mocked(getCurrentForecast).mockRejectedValue(
      new EventApiError("DEPENDENCY_UNAVAILABLE", 503),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh forecast" }));
    await screen.findByText(/Latest refresh failed/);
    expect(screen.getByText(/Generated:/)).toBeVisible();
    vi.mocked(getCurrentForecast).mockRejectedValue(
      new EventApiError("EVENT_NOT_FOUND", 404),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh forecast" }));
    await screen.findByText(/Forecast access is unavailable/);
    expect(screen.queryByText(/Generated:/)).not.toBeInTheDocument();
  });
  it("deduplicates Strict Mode initialization", async () => {
    const { StrictMode } = await import("react");
    render(
      <StrictMode>
        <ForecastPanel {...props} />
      </StrictMode>,
    );
    await screen.findByText("Current advisory forecast.");
    expect(getCurrentForecast).toHaveBeenCalledTimes(1);
  });
});
