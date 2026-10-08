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
  type ManagementDetail,
} from "../services/events";
import { eventDetailFixture } from "../test/event-fixture";
import { EventDetail } from "./EventDetail";

vi.mock("../services/events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/events")>()),
  getEventDetail: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const context = {
  eventId: "one",
  name: "List name",
  state: "DRAFT",
  relationship: "assigned",
} as const;

describe("read-only management detail", () => {
  it("loads current server data, revision and read-only policy without rendering mutation controls", async () => {
    vi.mocked(getEventDetail).mockReturnValueOnce(new Promise(() => {}));
    const props = { context, onSessionExpired: vi.fn(), onScopeLost: vi.fn() };
    const view = render(<EventDetail {...props} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading event detail",
    );
    view.unmount();
    vi.mocked(getEventDetail).mockResolvedValue(
      eventDetailFixture({
        name: "Current name",
        registration_capacity: 200,
        description: "Authorized configuration",
      }),
    );
    render(<EventDetail {...props} />);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Current name" }),
      ).toHaveFocus(),
    );
    expect(screen.getByText("Version")).not.toBeVisible();
    fireEvent.click(screen.getByText("Advanced details"));
    expect(screen.getByText("Version")).toBeVisible();
    expect(screen.getByText("Authorized configuration")).toBeVisible();
    expect(screen.getByText("Registration limit")).toBeVisible();
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Reload detail"]);
    expect(
      screen.getByText("Registration opens after the event is published"),
    ).toBeVisible();
    expect(
      screen.queryByText(/remaining places|occupancy|certificate/i),
    ).not.toBeInTheDocument();
  });
  it.each([503, 409])(
    "retries a %s detail error with current data",
    async (status) => {
      vi.mocked(getEventDetail)
        .mockRejectedValueOnce(
          new EventApiError(
            status === 409 ? "VERSION_CONFLICT" : "DEPENDENCY_UNAVAILABLE",
            status,
            "reference",
          ),
        )
        .mockResolvedValueOnce(eventDetailFixture());
      render(
        <EventDetail
          context={context}
          onSessionExpired={vi.fn()}
          onScopeLost={vi.fn()}
        />,
      );
      expect(await screen.findByRole("alert")).toHaveTextContent("reference");
      fireEvent.click(
        screen.getByRole("button", { name: "Retry event detail" }),
      );
      expect(
        await screen.findByRole("heading", { name: "Owned draft" }),
      ).toBeVisible();
    },
  );
  it.each([401, 403, 404])(
    "discards data and delegates %s to the authoritative context refresh",
    async (status) => {
      const expired = vi.fn(),
        lost = vi.fn();
      vi.mocked(getEventDetail).mockRejectedValue(
        new EventApiError("DENIED", status),
      );
      render(
        <EventDetail
          context={context}
          onSessionExpired={expired}
          onScopeLost={lost}
        />,
      );
      await vi.waitFor(() =>
        expect(status === 401 ? expired : lost).toHaveBeenCalledOnce(),
      );
      expect(
        screen.queryByText("Read-only configuration"),
      ).not.toBeInTheDocument();
    },
  );
  it("ignores a late response after the context has changed", async () => {
    let oldResponse!: (detail: ManagementDetail) => void;
    vi.mocked(getEventDetail)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          oldResponse = resolve;
        }),
      )
      .mockResolvedValueOnce(
        eventDetailFixture({ event_id: "two", name: "Current event" }),
      );
    const props = { onSessionExpired: vi.fn(), onScopeLost: vi.fn() };
    const view = render(<EventDetail context={context} {...props} />);
    view.rerender(
      <EventDetail context={{ ...context, eventId: "two" }} {...props} />,
    );
    expect(
      await screen.findByRole("heading", { name: "Current event" }),
    ).toBeVisible();
    oldResponse(eventDetailFixture({ name: "Old event" }));
    await vi.waitFor(() =>
      expect(screen.queryByText("Old event")).not.toBeInTheDocument(),
    );
  });
});
