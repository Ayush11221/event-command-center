import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EntryCode } from "./EntryCode";

const synthetic = "qr1." + "A".repeat(43);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("reveals and copies the same entry credential only on explicit owner action", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  render(<EntryCode code={synthetic} />);
  expect(screen.queryByLabelText("Entry code")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show entry code" }));
  expect(screen.getByLabelText("Entry code")).toHaveValue(synthetic);
  fireEvent.click(screen.getByRole("button", { name: "Copy entry code" }));
  await screen.findByText("Entry code copied.");
  expect(writeText).toHaveBeenCalledWith(synthetic);
  fireEvent.click(screen.getByRole("button", { name: "Hide entry code" }));
  expect(screen.queryByLabelText("Entry code")).not.toBeInTheDocument();
});
it("keeps a usable manual copy fallback when clipboard access fails", async () => {
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  render(<EntryCode code={synthetic} />);
  fireEvent.click(screen.getByRole("button", { name: "Show entry code" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy entry code" }));
  await screen.findByText(/copy it manually/);
  expect(screen.getByLabelText("Entry code")).toHaveValue(synthetic);
});
it.each([undefined, "https://example.invalid/", "qr1.malformed"])(
  "offers only the QR when the API has no valid text credential (%s)",
  (code) => {
    render(<EntryCode code={code} />);
    expect(screen.getByText(/Text entry code unavailable/)).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  },
);
