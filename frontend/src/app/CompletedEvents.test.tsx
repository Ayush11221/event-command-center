import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CompletedEvents } from "./CompletedEvents";
import type { ManagementEvent } from "../services/events";
const completed: ManagementEvent = {
  event_id: "completed",
  name: "Finished demo",
  state: "COMPLETED",
  start_at: null,
  end_at: null,
  time_zone: "Asia/Kolkata",
  relationship: "owned",
};
const props = {
  userId: "organizer",
  events: [completed],
  schedule: () => "20 Oct 2026",
  onOpen: vi.fn(),
};
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
it("hides and restores completed events across remounts without altering records", () => {
  const view = render(<CompletedEvents {...props} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Remove Finished demo from workspace" }),
  );
  expect(
    screen.queryByRole("button", { name: /Finished demo.*Completed/ }),
  ).not.toBeInTheDocument();
  expect(props.onOpen).not.toHaveBeenCalled();
  view.unmount();
  render(<CompletedEvents {...props} />);
  expect(
    screen.queryByRole("button", {
      name: "Remove Finished demo from workspace",
    }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByText(/Removed events/));
  fireEvent.click(
    screen.getByRole("button", { name: "Restore Finished demo" }),
  );
  expect(
    screen.getByRole("button", { name: "Remove Finished demo from workspace" }),
  ).toBeInTheDocument();
});
it("does not expose unauthorized events or hide active events, even with manipulated preferences", () => {
  localStorage.setItem(
    "eoc.completed.hidden.v1:organizer",
    JSON.stringify(["live", "unknown"]),
  );
  render(
    <CompletedEvents
      {...props}
      events={[
        completed,
        { ...completed, event_id: "live", name: "Live demo", state: "LIVE" },
      ]}
    />,
  );
  const section = within(
    screen.getByRole("region", { name: "Event completed" }),
  );
  expect(section.queryByText("Live demo")).not.toBeInTheDocument();
  expect(section.queryByText("unknown")).not.toBeInTheDocument();
  expect(section.queryByText(/Removed events/)).not.toBeInTheDocument();
});
it("scopes removal to the signed-in user and handles unavailable local storage", () => {
  localStorage.setItem(
    "eoc.completed.hidden.v1:another-user",
    JSON.stringify(["completed"]),
  );
  render(<CompletedEvents {...props} />);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Remove Finished demo from workspace" }),
  );
  expect(screen.getByRole("status")).toHaveTextContent("for this visit");
});
