import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkHealth } from "../services/health";
import { App } from "./App";

vi.mock("../services/health", () => ({ checkHealth: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("developer bootstrap", () => {
  it("shows a semantic loading state without claiming product readiness", () => {
    vi.mocked(checkHealth).mockReturnValue(new Promise(() => {}));
    render(<App />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Developer bootstrap",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking API process",
    );
    expect(screen.getByRole("button", { name: "Retry check" })).toBeDisabled();
    expect(
      screen.getByText(/Event Command Center is not implemented yet/),
    ).toBeVisible();
  });

  it("shows available after the API responds", async () => {
    vi.mocked(checkHealth).mockResolvedValue({
      status: "alive",
      correlation_id: "test-id",
    });
    render(<App />);

    expect(await screen.findByRole("status")).toHaveTextContent("Available");
    expect(screen.getByRole("button", { name: "Retry check" })).toBeEnabled();
    expect(screen.getByText(/does not verify a database/)).toBeVisible();
  });

  it("shows unavailable and recovers on retry", async () => {
    vi.mocked(checkHealth)
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ status: "alive", correlation_id: "retry-id" });
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry check" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Available");
    expect(checkHealth).toHaveBeenCalledTimes(2);
  });
});
