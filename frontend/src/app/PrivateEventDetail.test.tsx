import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscoveryApiError, getPrivateDetail } from "../services/discovery";
import { publicDetailFixture } from "../test/public-event-fixture";
import { PrivateEventDetail } from "./PrivateEventDetail";
import { capturePrivateEntry } from "./private-entry";
import { applyTheme, type ThemeMode } from "./theme";
vi.mock("../services/discovery", async (original) => ({
  ...(await original<typeof import("../services/discovery")>()),
  getPrivateDetail: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  window.dispatchEvent(new Event("pagehide"));
  window.history.replaceState(null, "", "/");
});
describe("V8 private bearer detail", () => {
  it("rechecks detail on same-document fragment navigation and clears stale protected facts", async () => {
    window.history.replaceState(null, "", `/private#access=${"a".repeat(43)}`);
    const entry = capturePrivateEntry();
    vi.mocked(getPrivateDetail)
      .mockResolvedValueOnce(publicDetailFixture())
      .mockRejectedValueOnce(new DiscoveryApiError("PRIVATE_UNAVAILABLE", 404));
    render(<PrivateEventDetail entry={entry} />);
    await screen.findByRole("heading", { name: "Community conference" });
    window.history.replaceState(null, "", "/private#access=invalid");
    window.dispatchEvent(new Event("hashchange"));
    await screen.findByRole("heading", { name: "Private event unavailable" });
    expect(window.location.hash).toBe("");
    expect(screen.queryByText("Community conference")).not.toBeInTheDocument();
    expect(getPrivateDetail).toHaveBeenLastCalledWith(
      null,
      expect.any(AbortSignal),
    );
  });
  it("discards displayed private detail when the page context ends", async () => {
    vi.mocked(getPrivateDetail).mockResolvedValue(publicDetailFixture());
    render(<PrivateEventDetail entry={{ read: () => "a".repeat(43) }} />);
    await screen.findByRole("heading", { name: "Community conference" });
    window.dispatchEvent(new Event("pagehide"));
    await screen.findByRole("heading", { name: "Private event unavailable" });
    expect(screen.queryByText("Community conference")).not.toBeInTheDocument();
  });
  it("shows loading and aborts when the page ends", () => {
    vi.mocked(getPrivateDetail).mockReturnValue(new Promise(() => {}));
    const view = render(<PrivateEventDetail />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading private");
    const signal = vi.mocked(getPrivateDetail).mock.calls[0][1];
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
  it.each(["light", "dark", "system"] satisfies ThemeMode[])(
    "displays only approved detail/policy and distinguishes PRIVATE access in %s",
    async (mode) => {
      applyTheme(mode, false);
      vi.mocked(getPrivateDetail).mockResolvedValue(publicDetailFixture());
      const entry = { read: () => "a".repeat(43) };
      render(<PrivateEventDetail entry={entry} />);
      await screen.findByRole("heading", { name: "Community conference" });
      expect(screen.getByText(/PRIVATE access/)).toBeVisible();
      expect(
        screen.getByText(/registration is currently unavailable/),
      ).toBeVisible();
      expect(
        screen.getByRole("region", { name: "Registration policy" }),
      ).toHaveTextContent("OPEN");
      expect(
        screen.queryByRole("button", {
          name: /register|issue|revoke|reissue/i,
        }),
      ).not.toBeInTheDocument();
      expect(document.body.textContent).not.toContain("a".repeat(43));
    },
  );
  it("preserves in-memory proof through Strict Mode and refresh while leaving no fragment", async () => {
    window.history.replaceState(null, "", `/private#access=${"a".repeat(43)}`);
    const entry = capturePrivateEntry();
    vi.mocked(getPrivateDetail).mockResolvedValue(publicDetailFixture());
    render(
      <StrictMode>
        <PrivateEventDetail entry={entry} />
      </StrictMode>,
    );
    await screen.findByRole("heading", { name: "Community conference" });
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh private detail" }),
    );
    await screen.findByRole("heading", { name: "Community conference" });
    expect(window.location.hash).toBe("");
    expect(
      vi
        .mocked(getPrivateDetail)
        .mock.calls.every((call) => call[0] === "a".repeat(43)),
    ).toBe(true);
  });
  it("renders the same safe unavailable state for every backend 404 without suggesting login", async () => {
    vi.mocked(getPrivateDetail).mockRejectedValue(
      new DiscoveryApiError("PRIVATE_UNAVAILABLE", 404),
    );
    render(<PrivateEventDetail />);
    expect(
      await screen.findByRole("heading", { name: "Private event unavailable" }),
    ).toBeVisible();
    expect(screen.queryByText(/sign in|OTP/i)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Private event unavailable" }),
      ).toHaveFocus(),
    );
  });
  it("retries technical failures and drops stale detail after revoked access", async () => {
    vi.mocked(getPrivateDetail)
      .mockRejectedValueOnce(new DiscoveryApiError("NETWORK", 0))
      .mockResolvedValueOnce(publicDetailFixture())
      .mockRejectedValueOnce(new DiscoveryApiError("PRIVATE_UNAVAILABLE", 404));
    render(<PrivateEventDetail entry={{ read: () => "a".repeat(43) }} />);
    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", { name: "Retry private detail" }),
    );
    await screen.findByRole("heading", { name: "Community conference" });
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh private detail" }),
    );
    await screen.findByRole("heading", { name: "Private event unavailable" });
    expect(screen.queryByText("Community conference")).not.toBeInTheDocument();
  });
});
