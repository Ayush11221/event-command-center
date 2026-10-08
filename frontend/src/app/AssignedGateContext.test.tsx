import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { scannerScope } from "../services/scanning";
import { AssignedGateContext } from "./AssignedGateContext";

vi.mock("../services/scanning", () => ({ scannerScope: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const assignments = [
  {
    id: "assignment-secret",
    event_id: "event-secret",
    gate_id: "gate-secret",
    role: "GATE_SECURITY",
  },
  { id: "admin", event_id: "other-secret", gate_id: null, role: "EVENT_ADMIN" },
];
it("uses only server-confirmed gate names and the exact assigned scope", async () => {
  vi.mocked(scannerScope).mockResolvedValue({
    event_name: "TechFest 2026",
    gate_label: "Gate 1",
  });
  render(<AssignedGateContext assignments={assignments} />);
  expect(screen.getByText("Role: Gate / Security")).toBeVisible();
  expect(
    await screen.findByText("Event: TechFest 2026 · Gate: Gate 1"),
  ).toBeVisible();
  expect(scannerScope).toHaveBeenCalledExactlyOnceWith(
    "event-secret",
    "gate-secret",
    expect.any(AbortSignal),
  );
  expect(document.body.textContent).not.toMatch(/secret/);
});
it("does not invent names after a failed scope read and offers recovery", async () => {
  vi.mocked(scannerScope)
    .mockRejectedValueOnce(new Error("private provider detail"))
    .mockResolvedValueOnce({
      event_name: "TechFest 2026",
      gate_label: "Gate 2",
    });
  render(<AssignedGateContext assignments={assignments} />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Retry assigned gate information",
    }),
  );
  expect(await screen.findByText(/Gate: Gate 2/)).toBeVisible();
  expect(document.body.textContent).not.toMatch(/private|secret/);
});
it("aborts pending metadata and does not publish a previous assignment's late scope", async () => {
  let finish!: (scope: { event_name: string; gate_label: string }) => void;
  vi.mocked(scannerScope)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValue({ event_name: "Current event", gate_label: "Gate 3" });
  const view = render(<AssignedGateContext assignments={assignments} />);
  const signal = vi.mocked(scannerScope).mock.calls[0][2];
  view.rerender(
    <AssignedGateContext
      assignments={[
        { ...assignments[0], id: "current", gate_id: "current-gate" },
      ]}
    />,
  );
  expect(await screen.findByText(/Current event/)).toBeVisible();
  finish({ event_name: "Old event", gate_label: "Gate 1" });
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText(/Old event/)).toBeNull();
});
