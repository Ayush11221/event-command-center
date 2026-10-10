import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountProfileForm } from "./AccountProfileForm";
import { accountProfile, saveAccountProfile } from "../services/profile";
import { currentActor, ProofError } from "../services/proof";
vi.mock("../services/profile", () => ({
  accountProfile: vi.fn(),
  saveAccountProfile: vi.fn(),
}));
vi.mock("../services/proof", async (original) => ({
  ...(await original<typeof import("../services/proof")>()),
  currentActor: vi.fn(),
}));
const actor = {
  user_id: "account",
  organizer_capable: false,
  assignments: [],
  csrf_token: "csrf",
  display_name: null,
};
beforeEach(() => {
  vi.mocked(accountProfile).mockResolvedValue({
    display_name: null,
    verified_email: "person@example.test",
    phone_number: null,
    organization: null,
    affiliation_id: null,
  });
  vi.mocked(saveAccountProfile).mockResolvedValue();
  vi.mocked(currentActor).mockResolvedValue({
    ...actor,
    display_name: "Asha Rao",
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe("account details form", () => {
  it("shows verified email as read-only and waits for server save before continuing", async () => {
    const done = vi.fn();
    render(<AccountProfileForm actor={actor} onComplete={done} />);
    expect(await screen.findByLabelText("Verified email")).toHaveAttribute(
      "readonly",
    );
    expect(screen.getByLabelText("Verified email")).toHaveValue(
      "person@example.test",
    );
    expect(
      screen.getByRole("button", { name: "Save and continue" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: " Asha Rao " },
    });
    fireEvent.change(screen.getByLabelText("Contact number"), {
      target: { value: "9876543210" },
    });
    fireEvent.change(screen.getByLabelText("College or organization"), {
      target: { value: "College" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() =>
      expect(done).toHaveBeenCalledWith(
        expect.objectContaining({ display_name: "Asha Rao" }),
      ),
    );
    expect(saveAccountProfile).toHaveBeenCalledWith(
      {
        display_name: "Asha Rao",
        phone_number: "9876543210",
        organization: "College",
        affiliation_id: null,
      },
      "csrf",
      expect.any(AbortSignal),
    );
    expect(
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ).not.toContain("Asha Rao");
  });
  it("keeps entered details and blocks continuation when saving fails", async () => {
    vi.mocked(saveAccountProfile).mockRejectedValue(
      new ProofError("DEPENDENCY_UNAVAILABLE", 503),
    );
    const done = vi.fn();
    render(<AccountProfileForm actor={actor} onComplete={done} />);
    fireEvent.change(await screen.findByLabelText("Full name"), {
      target: { value: "Asha Rao" },
    });
    fireEvent.change(screen.getByLabelText("Contact number"), {
      target: { value: "9876543210" },
    });
    fireEvent.change(screen.getByLabelText("College or organization"), {
      target: { value: "College" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByLabelText("Full name")).toHaveValue("Asha Rao");
    expect(done).not.toHaveBeenCalled();
  });
});
