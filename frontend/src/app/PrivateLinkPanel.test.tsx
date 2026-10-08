import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EventApiError,
  getEventDetail,
  issuePrivateLink,
} from "../services/events";
import { eventDetailFixture } from "../test/event-fixture";
import { PrivateLinkPanel } from "./PrivateLinkPanel";
import { accountSignedOut } from "../services/account-session";
import { applyTheme, type ThemeMode } from "./theme";
vi.mock("../services/events", async (original) => ({
  ...(await original<typeof import("../services/events")>()),
  issuePrivateLink: vi.fn(),
  getEventDetail: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});
const url = `http://127.0.0.1:5173/private#access=${"a".repeat(43)}`;
const response = {
  event_id: "one",
  link_state: "ACTIVE" as const,
  access_url: url,
  issued_at: "2026-10-03T10:00:00Z",
  revision: 4,
  as_of: "2026-10-03T10:00:00Z",
  correlation_id: "ref",
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
describe("V8 Organizer private link panel", () => {
  it("discards bearer link material when account access ends while forms are retained", async () => {
    vi.mocked(issuePrivateLink).mockResolvedValue(response);
    render(<PrivateLinkPanel {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Issue private link" }));
    await screen.findByLabelText("Shareable URL");
    act(() => accountSignedOut());
    expect(screen.queryByLabelText("Shareable URL")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(url);
  });
  it("discards the shareable result when the page context ends", async () => {
    vi.mocked(issuePrivateLink).mockResolvedValue(response);
    render(<PrivateLinkPanel {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Issue private link" }));
    await screen.findByLabelText("Shareable URL");
    window.dispatchEvent(new Event("pagehide"));
    await waitFor(() =>
      expect(screen.queryByLabelText("Shareable URL")).not.toBeInTheDocument(),
    );
  });
  it("exposes no panel or secret to Event Admin", () => {
    render(<PrivateLinkPanel {...props()} owner={false} />);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
  it.each(["DRAFT", "LIVE", "COMPLETED", "CANCELLED"] as const)(
    "hides issuance in %s",
    (state) => {
      const p = props();
      render(<PrivateLinkPanel {...p} detail={{ ...p.detail, state }} />);
      expect(
        screen.queryByRole("button", { name: "Issue private link" }),
      ).not.toBeInTheDocument();
    },
  );
  it("hides issuance for PUBLIC or missing CSRF", () => {
    const p = props();
    const v = render(
      <PrivateLinkPanel
        {...p}
        detail={{ ...p.detail, visibility: "PUBLIC" }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Issue private link" }),
    ).not.toBeInTheDocument();
    v.rerender(<PrivateLinkPanel {...p} csrf={undefined} />);
    expect(
      screen.queryByRole("button", { name: "Issue private link" }),
    ).not.toBeInTheDocument();
  });
  it.each(["light", "dark", "system"] satisfies ThemeMode[])(
    "shows one-time result/copy/hide without persistent secret in %s",
    async (mode) => {
      applyTheme(mode, false);
      const p = props();
      vi.mocked(issuePrivateLink).mockResolvedValue(response);
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
      render(<PrivateLinkPanel {...p} />);
      fireEvent.click(
        screen.getByRole("button", { name: "Issue private link" }),
      );
      expect(await screen.findByLabelText("Shareable URL")).toHaveValue(url);
      expect(p.onCurrent).toHaveBeenCalledWith(
        expect.objectContaining({ revision: 4 }),
      );
      expect(localStorage.getItem("access")).toBeNull();
      expect(sessionStorage.length).toBe(0);
      expect(
        screen.queryByRole("link", { name: /private/i }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Copy private URL" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(url));
      fireEvent.click(screen.getByRole("button", { name: "Hide private URL" }));
      expect(screen.queryByLabelText("Shareable URL")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /revoke|reissue|register/i }),
      ).not.toBeInTheDocument();
    },
  );
  it("disables duplicate submissions and aborts on unmount", () => {
    vi.mocked(issuePrivateLink).mockReturnValue(new Promise(() => {}));
    const v = render(<PrivateLinkPanel {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Issue private link" }));
    expect(
      screen.getByRole("button", { name: "Issue private link" }),
    ).toBeDisabled();
    const signal = vi.mocked(issuePrivateLink).mock.calls[0][4];
    v.unmount();
    expect(signal?.aborted).toBe(true);
  });
  it("retries unknown outcomes with the same key and revision", async () => {
    vi.mocked(issuePrivateLink)
      .mockRejectedValueOnce(new EventApiError("NETWORK", 0))
      .mockResolvedValueOnce(response);
    render(<PrivateLinkPanel {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Issue private link" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry same issuance" }),
    );
    await screen.findByLabelText("Shareable URL");
    expect(vi.mocked(issuePrivateLink).mock.calls[0].slice(0, 4)).toEqual(
      vi.mocked(issuePrivateLink).mock.calls[1].slice(0, 4),
    );
  });
  it.each([400, 409, 422])(
    "requires reconciliation after %s instead of silently rotating",
    async (status) => {
      vi.mocked(issuePrivateLink).mockRejectedValue(
        new EventApiError("VERSION_CONFLICT", status),
      );
      const p = props();
      vi.mocked(getEventDetail).mockResolvedValue({ ...p.detail, revision: 9 });
      render(<PrivateLinkPanel {...p} />);
      fireEvent.click(
        screen.getByRole("button", { name: "Issue private link" }),
      );
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
      expect(issuePrivateLink).toHaveBeenCalledTimes(1);
    },
  );
  it("explains already-active without recovering or exposing the URL", async () => {
    vi.mocked(issuePrivateLink).mockRejectedValue(
      new EventApiError("LINK_ALREADY_ACTIVE", 409),
    );
    render(<PrivateLinkPanel {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Issue private link" }));
    expect(
      await screen.findByText(/already active.*cannot be recovered/),
    ).toBeVisible();
    expect(screen.queryByLabelText("Shareable URL")).not.toBeInTheDocument();
  });
  it.each([401, 403, 404])(
    "drops command/result and handles scope/session loss %s",
    async (status) => {
      vi.mocked(issuePrivateLink).mockRejectedValue(
        new EventApiError("DENIED", status),
      );
      const p = props();
      render(<PrivateLinkPanel {...p} />);
      fireEvent.click(
        screen.getByRole("button", { name: "Issue private link" }),
      );
      await waitFor(() =>
        expect(
          status === 401 ? p.onSessionExpired : p.onScopeLost,
        ).toHaveBeenCalled(),
      );
      expect(screen.queryByLabelText("Shareable URL")).not.toBeInTheDocument();
    },
  );
  it("removes the result when current lifecycle/visibility loses eligibility", async () => {
    vi.mocked(issuePrivateLink).mockResolvedValue(response);
    const p = props(),
      v = render(<PrivateLinkPanel {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Issue private link" }));
    await screen.findByLabelText("Shareable URL");
    v.rerender(
      <PrivateLinkPanel {...p} detail={{ ...p.detail, state: "LIVE" }} />,
    );
    expect(screen.queryByLabelText("Shareable URL")).not.toBeInTheDocument();
  });
});
