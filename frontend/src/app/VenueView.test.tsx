import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VenueView } from "./VenueView";
import { listStaff } from "../services/staff";

vi.mock("../services/staff", () => ({ listStaff: vi.fn() }));
afterEach(cleanup);

const gates = [{ gate_id: "g-b" }, { gate_id: "g-a" }];

describe("Venue view", () => {
  it("summarises authoritative occupancy and staffed gates without inventing data", async () => {
    vi.mocked(listStaff).mockResolvedValue({
      allowed_roles: ["GATE_SECURITY"],
      assignments: [
        {
          id: "1",
          userId: "u",
          role: "GATE_SECURITY",
          gateId: "g-a",
          grantedAt: "2026-10-01T00:00:00Z",
          email: null,
        },
      ],
    });
    render(
      <VenueView
        eventId="e"
        occupied={45}
        capacity={100}
        gates={gates}
        forecast={null}
        forecastStale={false}
      />,
    );
    const figure = screen.getByRole("img");
    await waitFor(() =>
      expect(figure).toHaveAttribute(
        "aria-label",
        expect.stringContaining(
          "Gate 1, 1 security; Gate 2, no staff assigned",
        ),
      ),
    );
    expect(figure.getAttribute("aria-label")).toContain(
      "45 inside of a registration limit of 100 (45%)",
    );
    // Labels are CSS-generated, so no duplicate text nodes are added.
    expect(figure.textContent).toBe("");
  });

  it("keeps rendering when the staff lookup is unavailable", async () => {
    vi.mocked(listStaff).mockRejectedValue(new Error("403"));
    render(
      <VenueView
        eventId="e"
        occupied={10}
        capacity={null}
        gates={gates}
        forecast={null}
        forecastStale={false}
      />,
    );
    const figure = screen.getByRole("img");
    await waitFor(() => expect(listStaff).toHaveBeenCalled());
    expect(figure.getAttribute("aria-label")).toContain(
      "capacity not configured",
    );
    expect(figure.getAttribute("aria-label")).not.toContain("security");
  });
});
