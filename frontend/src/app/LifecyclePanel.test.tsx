import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EventApiError,
  getEventDetail,
  transitionEvent,
  type ManagementDetail,
} from "../services/events";
import { eventDetailFixture } from "../test/event-fixture";
import { LifecyclePanel } from "./LifecyclePanel";
import { applyTheme, type ThemeMode } from "./theme";

vi.mock("../services/events", async (original) => ({
  ...(await original<typeof import("../services/events")>()),
  getEventDetail: vi.fn(),
  transitionEvent: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeMode;
});
const ready = eventDetailFixture({ permitted_actions: ["PUBLISH", "CANCEL"] });
function panel(
  detail: ManagementDetail = ready,
  owner = true,
  csrf: string | undefined = "csrf",
) {
  const props = {
    detail,
    owner,
    csrf,
    onCurrent: vi.fn(),
    onSessionExpired: vi.fn(),
    onScopeLost: vi.fn(),
  };
  return { ...props, view: render(<LifecyclePanel {...props} />) };
}
function confirmPublish() {
  fireEvent.click(screen.getByRole("button", { name: "Publish event" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm publish event" }),
  );
}
describe("V6 lifecycle and availability UI", () => {
  it.each(["COMPLETED", "CANCELLED"] as const)(
    "hides all owner lifecycle controls in terminal %s even with stale action guidance",
    (state) => {
      panel(
        eventDetailFixture({
          state,
          permitted_actions: ["PUBLISH", "LIVE", "COMPLETE", "CANCEL"],
        }),
      );
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );
  it.each(["light", "dark", "system"] satisfies ThemeMode[])(
    "separates LIVE from policy OPEN in %s",
    (mode) => {
      applyTheme(mode, true);
      panel(
        eventDetailFixture({
          state: "LIVE",
          permitted_actions: ["COMPLETE", "CANCEL"],
        }),
      );
      expect(screen.getByText("LIVE")).toBeVisible();
      expect(screen.getByText("OPEN")).toBeVisible();
      expect(
        screen.getByText(
          /LIVE lifecycle prevents new registration independently/,
        ),
      ).toBeVisible();
      expect(
        screen.getByText(/No registration policy closure reasons/),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Complete event" }),
      ).toBeVisible();
      expect(document.documentElement.dataset.themeMode).toBe(mode);
    },
  );
  it.each(["DRAFT", "PUBLISHED", "LIVE", "COMPLETED", "CANCELLED"] as const)(
    "shows %s to Admin with no lifecycle controls even if actions were supplied",
    (state) => {
      panel(
        eventDetailFixture({
          state,
          permitted_actions: ["PUBLISH", "LIVE", "COMPLETE", "CANCEL"],
        }),
        false,
      );
      expect(screen.getByText(state)).toBeVisible();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );
  it("requires server-permitted controls, CSRF, and readiness", () => {
    const props = panel(eventDetailFixture({ permitted_actions: [] }));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    props.view.rerender(
      <LifecyclePanel {...props} detail={ready} csrf={undefined} />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    props.view.rerender(
      <LifecyclePanel
        {...props}
        detail={eventDetailFixture({
          permitted_actions: ["PUBLISH"],
          readiness: {
            configured_gate_present: false,
            publish_blockers: ["CONFIGURED_GATE_REQUIRED"],
            live_blockers: ["CONFIGURED_GATE_REQUIRED"],
          },
        })}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Publish event" }),
    ).toBeDisabled();
    expect(screen.getByText(/Resolve the Publish blockers/)).toBeVisible();
  });
  it("shows all approved policy reasons and no participant metrics", () => {
    panel(
      eventDetailFixture({
        availability: {
          policy_status: "CLOSED",
          reasons: [
            "NOT_OPEN_YET",
            "SCHEDULED_CLOSE_REACHED",
            "MANUALLY_CLOSED",
          ],
          opens_at: "2030-01-01T10:00:00Z",
          closes_at: "2030-01-01T12:00:00Z",
          as_of: ready.as_of,
        },
      }),
    );
    for (const text of [
      /opening time has not been reached/,
      /closing time has been reached/,
      /Registration is manually closed/,
    ])
      expect(screen.getByText(text)).toBeVisible();
    expect(
      screen.queryByText(/occupancy|remaining capacity|CAPACITY_REACHED/),
    ).not.toBeInTheDocument();
  });
  it.each([
    ["DRAFT", "PUBLISH", "PUBLISHED", "Publish event"],
    ["PUBLISHED", "LIVE", "LIVE", "Start live event"],
    ["LIVE", "COMPLETE", "COMPLETED", "Complete event"],
  ] as const)(
    "confirms %s → %s and reloads authoritative detail",
    async (from, action, state, label) => {
      const detail = eventDetailFixture({
        state: from,
        permitted_actions: [action],
      });
      const current = eventDetailFixture({
        state,
        revision: 4,
        permitted_actions: [],
      });
      vi.mocked(transitionEvent).mockResolvedValue({
        event_id: "one",
        previous_state: from,
        state,
        revision: 4,
        readiness: current.readiness,
        availability: current.availability,
        as_of: current.as_of,
        correlation_id: "transition-ref",
      });
      vi.mocked(getEventDetail).mockResolvedValue(current);
      const props = panel(detail);
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(transitionEvent).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", { name: `Confirm ${label.toLowerCase()}` }),
      );
      await waitFor(() =>
        expect(props.onCurrent).toHaveBeenCalledWith(current),
      );
      expect(transitionEvent).toHaveBeenCalledWith(
        "one",
        { target_state: state },
        3,
        "csrf",
        expect.any(String),
        expect.any(AbortSignal),
      );
      expect(screen.getByRole("status")).toHaveTextContent(
        `Lifecycle changed to ${state}`,
      );
    },
  );
  it("requires explicit cancellation confirmation and a nonblank reason", async () => {
    vi.mocked(transitionEvent).mockReturnValue(new Promise(() => {}));
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Cancel event" }));
    expect(
      screen.getByRole("textbox", { name: "Cancellation reason" }),
    ).toHaveFocus();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm cancel event" }),
    );
    expect(screen.getByText(/Enter a nonblank/)).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Cancellation reason" }),
    ).toHaveAttribute("aria-invalid", "true");
    expect(transitionEvent).not.toHaveBeenCalled();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Cancellation reason" }),
      { target: { value: " Venue unavailable " } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm cancel event" }),
    );
    expect(transitionEvent).toHaveBeenCalledWith(
      "one",
      { target_state: "CANCELLED", reason: "Venue unavailable" },
      3,
      "csrf",
      expect.any(String),
      expect.any(AbortSignal),
    );
    expect(
      screen.getByRole("button", { name: "Changing lifecycle…" }),
    ).toBeDisabled();
  });
  it("keeps a cancellation reason when the confirmation is dismissed", () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: "Cancel event" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Venue unavailable" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Keep current lifecycle" }),
    );
    expect(transitionEvent).not.toHaveBeenCalled();
  });
  it("retries an unknown outcome with the identical command, revision and key", async () => {
    vi.mocked(transitionEvent).mockRejectedValue(
      new EventApiError("NETWORK", 0),
    );
    panel();
    confirmPublish();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Retry same lifecycle request",
      }),
    );
    await waitFor(() => expect(transitionEvent).toHaveBeenCalledTimes(2));
    const first = vi.mocked(transitionEvent).mock.calls[0],
      second = vi.mocked(transitionEvent).mock.calls[1];
    expect(first.slice(0, 5)).toEqual(second.slice(0, 5));
    expect(
      screen.queryByRole("button", { name: "Cancel event" }),
    ).not.toBeInTheDocument();
  });
  it.each([
    [409, "VERSION_CONFLICT"],
    [409, "IDEMPOTENCY_CONFLICT"],
    [409, "INVALID_TRANSITION"],
    [422, "MISSING_CONFIGURED_GATE"],
    [422, "VALIDATION"],
    [400, "VALIDATION"],
  ] as const)(
    "reconciles %s %s before another command",
    async (status, code) => {
      vi.mocked(transitionEvent).mockRejectedValue(
        new EventApiError(code, status, "safe-ref"),
      );
      vi.mocked(getEventDetail).mockResolvedValue(ready);
      const props = panel();
      confirmPublish();
      expect(await screen.findByRole("alert")).toHaveTextContent("safe-ref");
      expect(
        screen.queryByRole("button", { name: "Retry same lifecycle request" }),
      ).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: "Reload lifecycle detail" }),
      );
      await waitFor(() => expect(props.onCurrent).toHaveBeenCalledWith(ready));
    },
  );
  it.each([401, 403, 404])(
    "delegates %s to session/scope removal",
    async (status) => {
      vi.mocked(transitionEvent).mockRejectedValue(
        new EventApiError("DENIED", status),
      );
      const props = panel();
      confirmPublish();
      await waitFor(() =>
        expect(
          status === 401 ? props.onSessionExpired : props.onScopeLost,
        ).toHaveBeenCalled(),
      );
      expect(props.onCurrent).not.toHaveBeenCalled();
    },
  );
  it("reloads after a confirmed transition whose detail refresh failed, without repeating the command", async () => {
    vi.mocked(transitionEvent).mockResolvedValue({
      event_id: "one",
      previous_state: "DRAFT",
      state: "PUBLISHED",
      revision: 4,
      readiness: ready.readiness,
      availability: ready.availability,
      as_of: ready.as_of,
      correlation_id: "ref",
    });
    vi.mocked(getEventDetail)
      .mockRejectedValueOnce(new EventApiError("NETWORK", 0))
      .mockResolvedValueOnce(ready);
    panel();
    confirmPublish();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "change is confirmed",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Reload lifecycle detail" }),
    );
    await screen.findByText(/Current lifecycle and availability refreshed/);
    expect(transitionEvent).toHaveBeenCalledTimes(1);
  });
  it("aborts a pending transition on unmount", () => {
    vi.mocked(transitionEvent).mockReturnValue(new Promise(() => {}));
    const props = panel();
    confirmPublish();
    const signal = vi.mocked(transitionEvent).mock.calls[0][5];
    props.view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
