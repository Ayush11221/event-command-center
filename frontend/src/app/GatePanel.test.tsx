import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGate,
  EventApiError,
  getEventDetail,
  type ManagementDetail,
} from "../services/events";
import { eventDetailFixture } from "../test/event-fixture";
import { GatePanel } from "./GatePanel";
import { EventDetail } from "./EventDetail";
import { applyTheme, type ThemeMode } from "./theme";

vi.mock("../services/events", async (original) => ({
  ...(await original<typeof import("../services/events")>()),
  createGate: vi.fn(),
  getEventDetail: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeMode;
});
const missing = eventDetailFixture({
  readiness: {
    configured_gate_present: false,
    publish_blockers: ["VISIBILITY_REQUIRED", "CONFIGURED_GATE_REQUIRED"],
    live_blockers: ["CONFIGURED_GATE_REQUIRED"],
  },
});
const configured = eventDetailFixture({
  gates: [{ gate_id: "gate-one", event_id: "one" }],
  revision: 4,
  readiness: {
    configured_gate_present: true,
    publish_blockers: ["VISIBILITY_REQUIRED"],
    live_blockers: [],
  },
});
const created = {
  gate_id: "gate-one",
  event_id: "one",
  revision: 4,
  readiness: configured.readiness,
  as_of: configured.as_of,
  correlation_id: "gate-reference",
};
function panel(
  detail: ManagementDetail = missing,
  csrf: string | undefined = "csrf",
) {
  const props = {
    detail,
    csrf,
    onCurrent: vi.fn(),
    onSessionExpired: vi.fn(),
    onScopeLost: vi.fn(),
  };
  const view = render(<GatePanel {...props} />);
  return { ...props, view };
}
describe("V5 Gate configuration and readiness", () => {
  it.each(["light", "dark", "system"] satisfies ThemeMode[])(
    "shows missing and configured readiness with unchanged semantics in %s",
    (mode) => {
      applyTheme(mode, true);
      const props = panel();
      expect(screen.getByText(/Gate missing/)).toHaveTextContent(
        "Publish and Live require a gate",
      );
      expect(
        screen.getByRole("heading", { name: "Publish blockers" }),
      ).toBeVisible();
      expect(
        screen.getByRole("heading", { name: "Live blockers" }),
      ).toBeVisible();
      expect(screen.getByText("No gates associated.")).toBeVisible();
      props.view.rerender(<GatePanel {...props} detail={configured} />);
      expect(screen.getByText(/Gate configured/)).toHaveTextContent(
        "gate prerequisite is satisfied",
      );
      expect(screen.getByText("Gate gate-one")).toBeVisible();
      expect(screen.getByText("Choose event visibility.")).toBeVisible();
      expect(
        screen.queryByRole("heading", { name: "Live blockers" }),
      ).not.toBeInTheDocument();
      expect(document.documentElement.dataset.themeMode).toBe(mode);
      expect(document.documentElement.dataset.theme).toBe(
        mode === "system" ? "dark" : mode,
      );
    },
  );
  it.each(["owned", "assigned"] as const)(
    "creates a gate in the authorized %s context and refreshes authoritative detail",
    async (relationship) => {
      vi.mocked(getEventDetail)
        .mockResolvedValueOnce(missing)
        .mockResolvedValueOnce(configured);
      vi.mocked(createGate).mockResolvedValue(created);
      const updated = vi.fn();
      render(
        <EventDetail
          context={{
            eventId: "one",
            name: "Owned draft",
            state: "DRAFT",
            relationship,
          }}
          csrf="csrf"
          onUpdated={updated}
          onSessionExpired={vi.fn()}
          onScopeLost={vi.fn()}
        />,
      );
      fireEvent.click(
        await screen.findByRole("button", { name: "Create gate" }),
      );
      expect(
        await screen.findByText(
          /Gate gate-one created. Current detail refreshed/,
        ),
      ).toBeVisible();
      expect(createGate).toHaveBeenCalledWith(
        "one",
        3,
        "csrf",
        expect.any(String),
        expect.any(AbortSignal),
      );
      expect(updated).toHaveBeenCalledWith(configured);
      expect(screen.getByText(/Revision 4/)).toBeVisible();
      expect(
        within(
          screen.getByRole("region", {
            name: "Gate configuration and readiness",
          }),
        ).queryByRole("button", {
          name: /publish|live|scanner|registration|cancel/i,
        }),
      ).not.toBeInTheDocument();
    },
  );
  it.each(["LIVE", "COMPLETED", "CANCELLED"] as const)(
    "hides creation in %s even with stale action guidance",
    (state) => {
      panel({ ...configured, state });
      expect(screen.getByText("Gate gate-one")).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "Create gate" }),
      ).not.toBeInTheDocument();
    },
  );
  it("hides creation when server permissions or session proof are unavailable", () => {
    const props = panel({ ...missing, permitted_actions: [] });
    expect(
      screen.queryByRole("button", { name: "Create gate" }),
    ).not.toBeInTheDocument();
    props.view.rerender(
      <GatePanel {...props} detail={missing} csrf={undefined} />,
    );
    expect(
      screen.queryByRole("button", { name: "Create gate" }),
    ).not.toBeInTheDocument();
  });
  it.each([0, 503])(
    "retries an unknown %s result with the exact original key/revision and no automatic duplicate",
    async (status) => {
      const props = panel();
      vi.mocked(createGate)
        .mockRejectedValueOnce(new EventApiError("NETWORK", status, "ref"))
        .mockResolvedValueOnce(created);
      vi.mocked(getEventDetail).mockResolvedValue(configured);
      fireEvent.click(screen.getByRole("button", { name: "Create gate" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("unknown");
      expect(screen.getByRole("alert")).toHaveTextContent("ref");
      const first = vi.mocked(createGate).mock.calls[0];
      // Another edit may advance the visible revision while the result is unknown.
      props.view.rerender(
        <GatePanel {...props} detail={{ ...missing, revision: 9 }} />,
      );
      expect(
        screen.queryByRole("button", { name: "Create gate" }),
      ).not.toBeInTheDocument();
      expect(createGate).toHaveBeenCalledTimes(1);
      fireEvent.click(
        screen.getByRole("button", { name: "Retry same gate request" }),
      );
      await screen.findByText(/Current detail refreshed/);
      expect(vi.mocked(createGate).mock.calls[1].slice(0, 4)).toEqual(
        first.slice(0, 4),
      );
    },
  );
  it.each([400, 409, 422])(
    "reloads before a new command after %s without replaying a rejected request",
    async (status) => {
      const props = panel();
      vi.mocked(createGate).mockRejectedValue(
        new EventApiError(
          status === 409 ? "VERSION_CONFLICT" : "VALIDATION",
          status,
          "ref",
        ),
      );
      vi.mocked(getEventDetail)
        .mockRejectedValueOnce(new EventApiError("NETWORK", 0))
        .mockResolvedValueOnce({ ...missing, revision: 8 });
      fireEvent.click(screen.getByRole("button", { name: "Create gate" }));
      await screen.findByRole("alert");
      expect(
        screen.queryByRole("button", { name: "Create gate" }),
      ).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: "Reload gate detail" }),
      );
      await screen.findByText(/Current detail could not be loaded/);
      fireEvent.click(
        screen.getByRole("button", { name: "Reload gate detail" }),
      );
      await screen.findByText(/Current gate configuration refreshed/);
      expect(props.onCurrent).toHaveBeenCalledWith(
        expect.objectContaining({ revision: 8 }),
      );
      expect(createGate).toHaveBeenCalledTimes(1);
    },
  );
  it("retries only the read when creation succeeded but the detail refresh failed", async () => {
    panel();
    vi.mocked(createGate).mockResolvedValue(created);
    vi.mocked(getEventDetail)
      .mockRejectedValueOnce(new EventApiError("NETWORK", 0))
      .mockResolvedValueOnce(configured);
    fireEvent.click(screen.getByRole("button", { name: "Create gate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "creation is confirmed",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload gate detail" }));
    await screen.findByText(/Current gate configuration refreshed/);
    expect(createGate).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 404])(
    "clears authority through the workspace callback on %s",
    async (status) => {
      const props = panel();
      vi.mocked(createGate).mockRejectedValue(
        new EventApiError("DENIED", status),
      );
      fireEvent.click(screen.getByRole("button", { name: "Create gate" }));
      await vi.waitFor(() =>
        expect(
          status === 401 ? props.onSessionExpired : props.onScopeLost,
        ).toHaveBeenCalledOnce(),
      );
      expect(getEventDetail).not.toHaveBeenCalled();
      expect(createGate).toHaveBeenCalledTimes(1);
    },
  );
  it("handles scope loss during post-create refresh without showing success in another context", async () => {
    const props = panel();
    vi.mocked(createGate).mockResolvedValue(created);
    vi.mocked(getEventDetail).mockRejectedValue(
      new EventApiError("EVENT_NOT_FOUND", 404),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create gate" }));
    await vi.waitFor(() => expect(props.onScopeLost).toHaveBeenCalledOnce());
    expect(props.onCurrent).not.toHaveBeenCalled();
  });
  it("ignores a late result when the event/role context is unmounted", async () => {
    const props = panel();
    let done!: (result: typeof created) => void;
    vi.mocked(createGate).mockReturnValue(
      new Promise((resolve) => {
        done = resolve;
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create gate" }));
    expect(
      screen.getByRole("button", { name: "Creating gate…" }),
    ).toBeDisabled();
    props.view.unmount();
    done(created);
    await vi.waitFor(() => expect(props.onCurrent).not.toHaveBeenCalled());
    expect(getEventDetail).not.toHaveBeenCalled();
  });
});
