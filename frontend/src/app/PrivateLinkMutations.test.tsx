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
  reissuePrivateLink,
  revokePrivateLink,
} from "../services/events";
import { eventDetailFixture } from "../test/event-fixture";
import { PrivateLinkPanel } from "./PrivateLinkPanel";
import { applyTheme, type ThemeMode } from "./theme";
vi.mock("../services/events", async (original) => ({
  ...(await original<typeof import("../services/events")>()),
  reissuePrivateLink: vi.fn(),
  revokePrivateLink: vi.fn(),
  getEventDetail: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});
const url = `http://127.0.0.1:5173/private#access=${"b".repeat(43)}`;
const base = {
  event_id: "one",
  revision: 4,
  as_of: "2026-10-03T10:00:00Z",
  correlation_id: "ref",
};
const reissued = {
  ...base,
  link_state: "ACTIVE" as const,
  access_url: url,
  issued_at: base.as_of,
  previous_revoked_at: base.as_of,
};
const revoked = {
  ...base,
  link_state: "REVOKED" as const,
  revoked_at: base.as_of,
};
function props() {
  return {
    detail: eventDetailFixture({ state: "PUBLISHED", visibility: "PRIVATE" }),
    owner: true,
    csrf: "csrf",
    onCurrent: vi.fn(),
    onSessionExpired: vi.fn(),
    onScopeLost: vi.fn(),
  };
}
function begin(operation: "reissue" | "revoke") {
  fireEvent.click(
    screen.getByRole("button", {
      name:
        operation === "reissue"
          ? "Reissue private link"
          : "Revoke private link",
    }),
  );
}
function confirm(operation: "reissue" | "revoke") {
  fireEvent.click(
    screen.getByRole("button", {
      name: operation === "reissue" ? "Confirm reissue" : "Confirm revoke",
    }),
  );
}
describe("V9 Organizer standalone link controls", () => {
  it.each(["reissue", "revoke"] as const)(
    "requires explicit consequence confirmation for %s and supports cancellation",
    (operation) => {
      render(<PrivateLinkPanel {...props()} />);
      begin(operation);
      expect(screen.getByText(/immediately stops/)).toBeVisible();
      expect(
        screen.getByRole("heading", {
          name:
            operation === "reissue"
              ? "Confirm private-link reissue"
              : "Confirm private-link revocation",
        }),
      ).toHaveFocus();
      expect(reissuePrivateLink).not.toHaveBeenCalled();
      expect(revokePrivateLink).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", { name: "Keep current link" }),
      );
      expect(screen.queryByRole("group")).not.toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "PRIVATE controlled link" }),
      ).toHaveFocus();
    },
  );
  it.each(["light", "dark", "system"] satisfies ThemeMode[])(
    "returns only the new shareable URL in %s",
    async (mode) => {
      applyTheme(mode, false);
      vi.mocked(reissuePrivateLink).mockResolvedValue(reissued);
      const p = props();
      render(<PrivateLinkPanel {...p} />);
      begin("reissue");
      confirm("reissue");
      expect(await screen.findByLabelText("Shareable URL")).toHaveValue(url);
      expect(screen.getByText(/previous URL stopped working/)).toBeVisible();
      expect(p.onCurrent).toHaveBeenCalledWith(
        expect.objectContaining({ revision: 4 }),
      );
      expect(sessionStorage.length).toBe(0);
      expect(JSON.stringify(localStorage)).not.toContain(url);
      expect(
        screen.queryByRole("button", { name: /Register/i }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Hide private URL" }));
      expect(screen.queryByLabelText("Shareable URL")).not.toBeInTheDocument();
    },
  );
  it("confirms revocation without showing a URL", async () => {
    vi.mocked(revokePrivateLink).mockResolvedValue(revoked);
    render(<PrivateLinkPanel {...props()} />);
    begin("revoke");
    confirm("revoke");
    expect(await screen.findByText(/Private link revoked/)).toBeVisible();
    expect(screen.queryByLabelText("Shareable URL")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy private URL" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("REVOKED")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Load current private-link detail" }),
    ).toHaveFocus();
  });
  it.each(["reissue", "revoke"] as const)(
    "disables duplicate %s and aborts on unmount",
    (operation) => {
      const command =
        operation === "reissue" ? reissuePrivateLink : revokePrivateLink;
      if (operation === "reissue")
        vi.mocked(reissuePrivateLink).mockReturnValue(new Promise(() => {}));
      else vi.mocked(revokePrivateLink).mockReturnValue(new Promise(() => {}));
      const view = render(<PrivateLinkPanel {...props()} />);
      begin(operation);
      confirm(operation);
      expect(
        screen.queryByRole("button", { name: /Confirm re/ }),
      ).not.toBeInTheDocument();
      expect(command).toHaveBeenCalledTimes(1);
      const signal = vi.mocked(command).mock.calls[0][4];
      view.unmount();
      expect(signal?.aborted).toBe(true);
    },
  );
  it.each(["reissue", "revoke"] as const)(
    "retries unknown %s with exactly the original revision/key",
    async (operation) => {
      const command =
        operation === "reissue" ? reissuePrivateLink : revokePrivateLink;
      if (operation === "reissue")
        vi.mocked(reissuePrivateLink)
          .mockRejectedValueOnce(new EventApiError("NETWORK", 0))
          .mockResolvedValueOnce(reissued);
      else
        vi.mocked(revokePrivateLink)
          .mockRejectedValueOnce(new EventApiError("NETWORK", 0))
          .mockResolvedValueOnce(revoked);
      render(<PrivateLinkPanel {...props()} />);
      begin(operation);
      confirm(operation);
      const retry = await screen.findByRole("button", {
        name: `Retry same ${operation}`,
      });
      await waitFor(() => expect(retry).toHaveFocus());
      fireEvent.click(retry);
      await waitFor(() => expect(command).toHaveBeenCalledTimes(2));
      expect(vi.mocked(command).mock.calls[0].slice(0, 4)).toEqual(
        vi.mocked(command).mock.calls[1].slice(0, 4),
      );
      await screen.findByText(
        operation === "reissue"
          ? /previous URL stopped working/
          : /Private link revoked/,
      );
    },
  );
  it.each([
    "VERSION_CONFLICT",
    "IDEMPOTENCY_CONFLICT",
    "LINK_NOT_ACTIVE",
    "VALIDATION",
    "WRONG_LIFECYCLE_STATE",
  ])("reconciles %s instead of silently retrying", async (code) => {
    vi.mocked(reissuePrivateLink).mockRejectedValue(
      new EventApiError(
        code,
        code === "VALIDATION"
          ? 400
          : code === "WRONG_LIFECYCLE_STATE"
            ? 422
            : 409,
      ),
    );
    const p = props();
    vi.mocked(getEventDetail).mockResolvedValue({ ...p.detail, revision: 9 });
    render(<PrivateLinkPanel {...p} />);
    begin("reissue");
    confirm("reissue");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Load current private-link detail",
      }),
    );
    await waitFor(() =>
      expect(p.onCurrent).toHaveBeenCalledWith(
        expect.objectContaining({ revision: 9 }),
      ),
    );
    expect(reissuePrivateLink).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "PRIVATE controlled link" }),
      ).toHaveFocus(),
    );
    expect(screen.queryByLabelText("Shareable URL")).not.toBeInTheDocument();
  });
  it.each([401, 403, 404])(
    "clears %s forbidden/session/scope-loss results",
    async (status) => {
      const p = props();
      vi.mocked(revokePrivateLink).mockRejectedValue(
        new EventApiError("DENIED", status),
      );
      render(<PrivateLinkPanel {...p} />);
      begin("revoke");
      confirm("revoke");
      await waitFor(() =>
        expect(
          status === 401 ? p.onSessionExpired : p.onScopeLost,
        ).toHaveBeenCalled(),
      );
      expect(screen.queryByRole("group")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Shareable URL")).not.toBeInTheDocument();
    },
  );
  it("discards confirmation and result when current context loses eligibility", async () => {
    const p = props(),
      view = render(<PrivateLinkPanel {...p} />);
    begin("reissue");
    view.rerender(
      <PrivateLinkPanel {...p} detail={{ ...p.detail, state: "LIVE" }} />,
    );
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    view.rerender(<PrivateLinkPanel {...p} />);
    vi.mocked(reissuePrivateLink).mockResolvedValue(reissued);
    begin("reissue");
    confirm("reissue");
    await screen.findByLabelText("Shareable URL");
    view.rerender(<PrivateLinkPanel {...p} owner={false} />);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
  it("exposes no mutation controls to Event Admin", () => {
    render(<PrivateLinkPanel {...props()} owner={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
