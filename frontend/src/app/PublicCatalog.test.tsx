import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscoveryApiError, getPublicCatalog } from "../services/discovery";
import {
  publicCatalogFixture,
  publicDetailFixture,
} from "../test/public-event-fixture";
import { PublicCatalog } from "./PublicCatalog";
import { applyTheme, type ThemeMode } from "./theme";

vi.mock("../services/discovery", async (original) => ({
  ...(await original<typeof import("../services/discovery")>()),
  getPublicCatalog: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeMode;
});
describe("V7 public catalog", () => {
  it("puts live events first and offers registration recovery rather than new registration", async () => {
    vi.mocked(getPublicCatalog).mockResolvedValue(
      publicCatalogFixture({
        items: [
          publicDetailFixture(),
          publicDetailFixture({
            event_id: "live-one",
            name: "Live conference",
            event_state: "LIVE",
          }),
        ],
      }),
    );
    render(<PublicCatalog />);
    const live = await screen.findByRole("region", { name: "Live events" });
    expect(
      within(live).getByRole("link", { name: "Live conference" }),
    ).toHaveAttribute("href", "/events/live-one");
    expect(
      within(live).getByRole("link", { name: "View my registration" }),
    ).toHaveAttribute("href", "/events/live-one");
    expect(live).toHaveTextContent("New registration is closed");
    expect(within(live).queryByText("OPEN")).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole("region")
        .filter((region) =>
          ["Live events", "Published events"].includes(
            region.getAttribute("aria-label") ?? "",
          ),
        )
        .map((region) => region.getAttribute("aria-label")),
    ).toEqual(["Live events", "Published events"]);
  });
  it("shows loading and aborts on unmount", () => {
    vi.mocked(getPublicCatalog).mockReturnValue(new Promise(() => {}));
    const view = render(<PublicCatalog />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading public events",
    );
    const signal = vi.mocked(getPublicCatalog).mock.calls[0][1];
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
  it.each(["light", "dark", "system"] satisfies ThemeMode[])(
    "renders approved event information and policy in %s",
    async (mode) => {
      applyTheme(mode, true);
      vi.mocked(getPublicCatalog).mockResolvedValue(publicCatalogFixture());
      render(<PublicCatalog />);
      const link = await screen.findByRole("link", {
        name: "Community conference",
      });
      expect(link).toHaveAttribute("href", "/events/public-one");
      expect(screen.getByText("City hall")).toBeVisible();
      expect(screen.getByText(/Asia\/Kolkata/)).toBeVisible();
      expect(
        screen.getByRole("list", { name: "Event tags" }),
      ).toHaveTextContent("Research");
      expect(
        screen.getByRole("region", { name: "Registration policy" }),
      ).toHaveTextContent("OPEN");
      expect(
        screen.queryByRole("button", { name: /register|scan|private/i }),
      ).not.toBeInTheDocument();
      expect(document.documentElement.dataset.themeMode).toBe(mode);
      await waitFor(() =>
        expect(
          screen.getByRole("heading", { name: "Explore events" }),
        ).toHaveFocus(),
      );
    },
  );
  it("shows an empty catalog with a current refresh action", async () => {
    vi.mocked(getPublicCatalog).mockResolvedValue(
      publicCatalogFixture({ items: [] }),
    );
    render(<PublicCatalog />);
    expect(
      await screen.findByRole("heading", {
        name: "No public events available",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Load more events" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh catalog" }));
    await waitFor(() => expect(getPublicCatalog).toHaveBeenCalledTimes(2));
  });
  it("retains correlation and retries a failed initial load", async () => {
    vi.mocked(getPublicCatalog)
      .mockRejectedValueOnce(
        new DiscoveryApiError("DEPENDENCY_UNAVAILABLE", 503, "safe-ref"),
      )
      .mockResolvedValueOnce(publicCatalogFixture());
    render(<PublicCatalog />);
    expect(await screen.findByRole("alert")).toHaveTextContent("safe-ref");
    fireEvent.click(screen.getByRole("button", { name: "Retry catalog" }));
    expect(
      await screen.findByRole("link", { name: "Community conference" }),
    ).toBeVisible();
  });
  it("loads additional cursor pages without losing the existing list or adding duplicate events", async () => {
    const next = publicDetailFixture({
      event_id: "public-two",
      name: "Second conference",
    });
    vi.mocked(getPublicCatalog)
      .mockResolvedValueOnce(publicCatalogFixture({ next_cursor: "next-page" }))
      .mockResolvedValueOnce(
        publicCatalogFixture({ items: [publicDetailFixture(), next] }),
      );
    render(<PublicCatalog />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Load more events" }),
    );
    expect(
      await screen.findByRole("link", { name: "Second conference" }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("link", { name: "Community conference" }),
    ).toHaveLength(1);
    expect(getPublicCatalog).toHaveBeenLastCalledWith(
      "next-page",
      expect.any(AbortSignal),
    );
    expect(
      screen.queryByRole("button", { name: "Load more events" }),
    ).not.toBeInTheDocument();
  });
  it("keeps earlier events on a continuation failure and retries the same cursor", async () => {
    vi.mocked(getPublicCatalog)
      .mockResolvedValueOnce(publicCatalogFixture({ next_cursor: "next-page" }))
      .mockRejectedValueOnce(new DiscoveryApiError("NETWORK", 0))
      .mockResolvedValueOnce(publicCatalogFixture({ items: [] }));
    render(<PublicCatalog />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Load more events" }),
    );
    await screen.findByRole("alert");
    expect(
      screen.getByRole("link", { name: "Community conference" }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry loading more events" }),
    );
    await waitFor(() => expect(getPublicCatalog).toHaveBeenCalledTimes(3));
    expect(vi.mocked(getPublicCatalog).mock.calls[1][0]).toBe("next-page");
    expect(vi.mocked(getPublicCatalog).mock.calls[2][0]).toBe("next-page");
  });
  it("exposes a pending continuation state and prevents duplicate clicks", async () => {
    vi.mocked(getPublicCatalog)
      .mockResolvedValueOnce(publicCatalogFixture({ next_cursor: "next" }))
      .mockReturnValueOnce(new Promise(() => {}));
    render(<PublicCatalog />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Load more events" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading more events");
    expect(
      screen.getByRole("button", { name: "Load more events" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Load more events" }));
    expect(getPublicCatalog).toHaveBeenCalledTimes(2);
  });
});
