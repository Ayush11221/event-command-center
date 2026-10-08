import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscoveryApiError, getPublicDetail } from "../services/discovery";
import { publicDetailFixture } from "../test/public-event-fixture";
import { PublicEventDetail } from "./PublicEventDetail";
import { applyTheme, type ThemeMode } from "./theme";

vi.mock("../services/discovery", async (original) => ({
  ...(await original<typeof import("../services/discovery")>()),
  getPublicDetail: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeMode;
});
describe("V7 public event detail", () => {
  it("shows loading, preserves catalog navigation and aborts on unmount", () => {
    vi.mocked(getPublicDetail).mockReturnValue(new Promise(() => {}));
    const view = render(<PublicEventDetail eventId="one" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading public event detail",
    );
    expect(
      screen.getByRole("link", { name: "Back to public events" }),
    ).toHaveAttribute("href", "/events");
    const signal = vi.mocked(getPublicDetail).mock.calls[0][1];
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
  it.each(["light", "dark", "system"] satisfies ThemeMode[])(
    "renders approved fields, banner, policy and participant entry in %s",
    async (mode) => {
      applyTheme(mode, false);
      vi.mocked(getPublicDetail).mockResolvedValue(publicDetailFixture());
      render(<PublicEventDetail eventId="one" />);
      await screen.findByRole("heading", { name: "Community conference" });
      expect(
        screen.getByText("A day of talks and shared ideas."),
      ).toBeVisible();
      expect(screen.getByText("City hall")).toBeVisible();
      expect(screen.getByText("Asia/Kolkata")).toBeVisible();
      expect(document.querySelector("img")).toHaveAttribute(
        "src",
        "https://example.org/banner.png",
      );
      expect(document.querySelector("img")).toHaveAttribute(
        "referrerpolicy",
        "no-referrer",
      );
      expect(
        screen.getByText(/Registration also requires a Published event/),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", {
          name: /scan|publish|cancel|private/i,
        }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Register" })).toBeVisible();
      expect(document.documentElement.dataset.themeMode).toBe(mode);
      await waitFor(() =>
        expect(
          screen.getByRole("heading", { name: "Community conference" }),
        ).toHaveFocus(),
      );
    },
  );
  it.each([
    "NOT_OPEN_YET",
    "SCHEDULED_CLOSE_REACHED",
    "MANUALLY_CLOSED",
  ] as const)("explains the approved %s policy closure", async (reason) => {
    const base = publicDetailFixture();
    vi.mocked(getPublicDetail).mockResolvedValue(
      publicDetailFixture({
        availability: {
          ...base.availability,
          policy_status: "CLOSED",
          reasons: [reason],
        },
      }),
    );
    render(<PublicEventDetail eventId="one" />);
    await screen.findByRole("heading", { name: "Community conference" });
    expect(
      screen.getByRole("region", { name: "Registration policy" }),
    ).toHaveTextContent("CLOSED");
    expect(
      screen.getByRole("region", { name: "Registration policy" }),
    ).toHaveTextContent(
      reason === "NOT_OPEN_YET"
        ? "opening time has not been reached"
        : reason === "SCHEDULED_CLOSE_REACHED"
          ? "closing time has been reached"
          : "Registration is manually closed",
    );
  });
  it("uses one safe unavailable state for every public not-found cause", async () => {
    vi.mocked(getPublicDetail).mockRejectedValue(
      new DiscoveryApiError("EVENT_NOT_FOUND", 404),
    );
    render(<PublicEventDetail eventId="guessed-id" />);
    expect(
      await screen.findByRole("heading", { name: "Event unavailable" }),
    ).toBeVisible();
    expect(
      screen.queryByText(/PRIVATE|DRAFT|LIVE|CANCELLED|COMPLETED/),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Check availability again" }),
    );
    await waitFor(() => expect(getPublicDetail).toHaveBeenCalledTimes(2));
  });
  it("retries technical errors while keeping privacy-safe copy and correlation", async () => {
    vi.mocked(getPublicDetail)
      .mockRejectedValueOnce(
        new DiscoveryApiError("DEPENDENCY_UNAVAILABLE", 503, "safe-ref"),
      )
      .mockResolvedValueOnce(publicDetailFixture());
    render(<PublicEventDetail eventId="one" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("safe-ref");
    fireEvent.click(screen.getByRole("button", { name: "Retry event detail" }));
    expect(
      await screen.findByRole("heading", { name: "Community conference" }),
    ).toBeVisible();
  });
  it("discards visible detail when a fresh read becomes unavailable without fabricating a lifecycle policy reason", async () => {
    vi.mocked(getPublicDetail)
      .mockResolvedValueOnce(publicDetailFixture())
      .mockRejectedValueOnce(new DiscoveryApiError("EVENT_NOT_FOUND", 404));
    render(<PublicEventDetail eventId="one" />);
    await screen.findByRole("heading", { name: "Community conference" });
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh event detail" }),
    );
    await screen.findByRole("heading", { name: "Event unavailable" });
    expect(screen.queryByText("Community conference")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Registration policy" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/LIVE|CANCELLED|COMPLETED|MANUALLY_CLOSED/),
    ).not.toBeInTheDocument();
  });
  it("handles missing optional fields and a failed image without placeholders for participant facts", async () => {
    vi.mocked(getPublicDetail).mockResolvedValue(
      publicDetailFixture({
        description: null,
        category: null,
        tags: [],
        public_location: null,
      }),
    );
    render(<PublicEventDetail eventId="one" />);
    await screen.findByRole("heading", { name: "Community conference" });
    fireEvent.error(document.querySelector("img")!);
    expect(screen.getByText("Event image unavailable.")).toBeVisible();
    expect(screen.getByText("No description provided.")).toBeVisible();
    expect(screen.getByText("Location not provided")).toBeVisible();
    expect(
      screen.queryByText(
        /remaining capacity|occupancy|participants registered/,
      ),
    ).not.toBeInTheDocument();
  });
  it("renders organizer text as plain text, including HTML-like descriptions", async () => {
    vi.mocked(getPublicDetail).mockResolvedValue(
      publicDetailFixture({ description: '<script>alert("unsafe")</script>' }),
    );
    render(<PublicEventDetail eventId="one" />);
    expect(
      await screen.findByText('<script>alert("unsafe")</script>'),
    ).toBeVisible();
    expect(document.querySelector("script")).toBeNull();
  });
});
