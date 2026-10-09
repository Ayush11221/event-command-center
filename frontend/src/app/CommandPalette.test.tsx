import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LayoutGrid } from "lucide-react";
import { CommandPalette, type Command } from "./CommandPalette";

afterEach(cleanup);

function commands(run = vi.fn()): Command[] {
  return [
    { id: "a", label: "Overview", group: "Sections", Icon: LayoutGrid, run },
    { id: "b", label: "Gates", group: "Sections", Icon: LayoutGrid, run },
    { id: "c", label: "Results", group: "Pages", Icon: LayoutGrid, run },
  ];
}

describe("Command palette", () => {
  it("filters by label and runs the highlighted command with Enter", () => {
    const run = vi.fn();
    const close = vi.fn();
    render(<CommandPalette commands={commands(run)} onClose={close} />);
    const search = screen.getByRole("combobox", {
      name: "Search sections, pages and events",
    });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "res" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(close).toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("moves the active option with arrow keys and exposes it to assistive tech", () => {
    render(<CommandPalette commands={commands()} onClose={vi.fn()} />);
    const search = screen.getByRole("combobox");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    const options = screen.getAllByRole("option");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(search).toHaveAttribute("aria-activedescendant", options[1].id);
  });

  it("closes on Escape without running anything", () => {
    const run = vi.fn();
    const close = vi.fn();
    render(<CommandPalette commands={commands(run)} onClose={close} />);
    fireEvent(
      screen.getByRole("dialog", { hidden: true }),
      new Event("cancel", { cancelable: true }),
    );
    expect(close).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("states when nothing matches", () => {
    render(<CommandPalette commands={commands()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No matches.")).toBeInTheDocument();
  });
});
