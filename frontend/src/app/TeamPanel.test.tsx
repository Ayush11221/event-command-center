import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProofError } from "../services/proof";
import {
  grantStaff,
  listStaff,
  lookupStaffAccount,
  revokeStaff,
  type StaffAssignment,
  type StaffList,
} from "../services/staff";
import { eventDetailFixture } from "../test/event-fixture";
import { TeamPanel } from "./TeamPanel";
vi.mock("../services/staff", async (original) => ({
  ...(await original<typeof import("../services/staff")>()),
  grantStaff: vi.fn(),
  listStaff: vi.fn(),
  lookupStaffAccount: vi.fn(),
  revokeStaff: vi.fn(),
}));
const assigned: StaffAssignment = {
  id: "assignment-uuid",
  userId: "person-uuid",
  email: "member@example.test",
  role: "VOLUNTEER",
  gateId: null,
  grantedAt: new Date().toISOString(),
};
const empty: StaffList = {
  assignments: [],
  allowed_roles: ["EVENT_ADMIN", "GATE_SECURITY", "VOLUNTEER"],
};
const detail = eventDetailFixture({
  gates: [{ gate_id: "gate-uuid", event_id: "one" }],
});
beforeEach(() => {
  vi.mocked(listStaff).mockResolvedValue(empty);
  vi.mocked(lookupStaffAccount).mockResolvedValue({
    user_id: "person-uuid",
    email: assigned.email!,
  });
  vi.mocked(grantStaff).mockResolvedValue();
  vi.mocked(revokeStaff).mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
async function find() {
  fireEvent.change(screen.getByLabelText("Verified email"), {
    target: { value: "member@example.test" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Find verified account" }),
  );
  await screen.findByLabelText("Role");
}
describe("event Team & Staff", () => {
  it("loads authorized staff, with useful empty state and no normal UUID entry", async () => {
    // Empty email keeps lookup disabled even after the list loads.
    render(
      <TeamPanel
        detail={detail}
        csrf="csrf"
        onSessionExpired={vi.fn()}
        onScopeLost={vi.fn()}
      />,
    );
    expect(screen.getByText("Loading team assignments…")).toBeVisible();
    await screen.findByText(/No team members assigned/);
    expect(listStaff).toHaveBeenCalledWith("one", expect.any(AbortSignal));
    expect(
      screen.queryByLabelText(/UUID|user id|gate id/i),
    ).not.toBeInTheDocument();
  });
  it.each([401, 403, 404])(
    "denies stale/unauthorized access %s without staff data",
    async (status) => {
      vi.mocked(listStaff).mockRejectedValue(new ProofError("DENIED", status));
      const callbacks = { onSessionExpired: vi.fn(), onScopeLost: vi.fn() };
      render(<TeamPanel detail={detail} csrf="csrf" {...callbacks} />);
      await screen.findByText(/could not be loaded/);
      expect(
        status === 401 ? callbacks.onSessionExpired : callbacks.onScopeLost,
      ).toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Find verified account" }),
      ).toBeDisabled();
    },
  );
  it("allows a verified account and requires a configured gate for Gate / Security", async () => {
    render(
      <TeamPanel
        detail={detail}
        csrf="csrf"
        onSessionExpired={vi.fn()}
        onScopeLost={vi.fn()}
      />,
    );
    await screen.findByText(/No team members assigned/);
    await find();
    expect(
      screen.getByRole("button", { name: "Add team member" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Gate"), {
      target: { value: "gate-uuid" },
    });
    expect(screen.getByRole("option", { name: "Gate 1" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Add team member" }));
    await screen.findByText("Team assignment saved.");
    expect(grantStaff).toHaveBeenCalledWith(
      "one",
      { user_id: "person-uuid", role: "GATE_SECURITY", gate_id: "gate-uuid" },
      "csrf",
      expect.any(AbortSignal),
    );
    expect(document.body.textContent).not.toMatch(
      /person-uuid|gate-uuid|assignment-uuid/,
    );
  });
  it("restricts the Event Admin role selector to the server's allowed roles", async () => {
    vi.mocked(listStaff).mockResolvedValue({
      ...empty,
      allowed_roles: ["GATE_SECURITY", "VOLUNTEER"],
    });
    render(
      <TeamPanel
        detail={detail}
        csrf="csrf"
        onSessionExpired={vi.fn()}
        onScopeLost={vi.fn()}
      />,
    );
    await screen.findByText(/Only the Organizer/);
    await find();
    expect(
      screen.queryByRole("option", { name: "Event Admin" }),
    ).not.toBeInTheDocument();
  });
  it("keeps Gate / Security blocked when there are no configured gates", async () => {
    render(
      <TeamPanel
        detail={{ ...detail, gates: [] }}
        csrf="csrf"
        onSessionExpired={vi.fn()}
        onScopeLost={vi.fn()}
      />,
    );
    await screen.findByText(/No team members assigned/);
    await find();
    expect(
      screen.getByRole("button", { name: "Add team member" }),
    ).toBeDisabled();
    expect(screen.getByText(/Create an event gate above/)).toBeVisible();
    expect(
      screen
        .getAllByRole("option")
        .some((option) => option.textContent === "Gate 1"),
    ).toBe(false);
  });
  it.each([
    null,
    new ProofError("SELF_ASSIGNMENT", 403),
    new ProofError("FORBIDDEN", 403),
  ])(
    "does not assign a missing/self/unauthorized selection %#",
    async (result) => {
      if (result instanceof ProofError)
        vi.mocked(lookupStaffAccount).mockRejectedValue(result);
      else vi.mocked(lookupStaffAccount).mockResolvedValue(result);
      render(
        <TeamPanel
          detail={detail}
          csrf="csrf"
          onSessionExpired={vi.fn()}
          onScopeLost={vi.fn()}
        />,
      );
      await screen.findByText(/No team members assigned/);
      fireEvent.change(screen.getByLabelText("Verified email"), {
        target: { value: "member@example.test" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Find verified account" }),
      );
      await screen.findByText(
        result === null
          ? /No verified account/
          : result.code === "SELF_ASSIGNMENT"
            ? /cannot assign yourself/
            : /do not have permission/,
      );
      expect(screen.queryByLabelText("Role")).not.toBeInTheDocument();
      expect(grantStaff).not.toHaveBeenCalled();
    },
  );
  it("removes an active assignment and reloads current data", async () => {
    vi.mocked(listStaff)
      .mockResolvedValueOnce({ ...empty, assignments: [assigned] })
      .mockResolvedValue(empty);
    render(
      <TeamPanel
        detail={detail}
        csrf="csrf"
        onSessionExpired={vi.fn()}
        onScopeLost={vi.fn()}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Remove assignment/ }),
    );
    expect(revokeStaff).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
    await screen.findByText("Assignment removed.");
    expect(revokeStaff).toHaveBeenCalledWith(
      "one",
      assigned.id,
      "csrf",
      expect.any(AbortSignal),
    );
  });
  it("changes role/gate with revoke before grant, showing human context", async () => {
    vi.mocked(listStaff).mockResolvedValue({
      ...empty,
      assignments: [assigned],
    });
    render(
      <TeamPanel
        detail={detail}
        csrf="csrf"
        onSessionExpired={vi.fn()}
        onScopeLost={vi.fn()}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Change assignment/ }),
    );
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "GATE_SECURITY" },
    });
    fireEvent.change(screen.getByLabelText("Gate"), {
      target: { value: "gate-uuid" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save assignment change" }),
    );
    await screen.findByText("Team assignment saved.");
    expect(vi.mocked(revokeStaff).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(grantStaff).mock.invocationCallOrder[0],
    );
    expect(grantStaff).toHaveBeenCalledWith(
      "one",
      { user_id: "person-uuid", role: "GATE_SECURITY", gate_id: "gate-uuid" },
      "csrf",
      expect.any(AbortSignal),
    );
  });
  it("holds unknown grants, reconciles by reading and never resends with a new request", async () => {
    vi.mocked(grantStaff).mockRejectedValue(new ProofError("NETWORK", 0));
    vi.mocked(listStaff)
      .mockResolvedValueOnce(empty)
      .mockResolvedValue({ ...empty, assignments: [assigned] });
    render(
      <TeamPanel
        detail={detail}
        csrf="csrf"
        onSessionExpired={vi.fn()}
        onScopeLost={vi.fn()}
      />,
    );
    await screen.findByText(/No team members assigned/);
    await find();
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "VOLUNTEER" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add team member" }));
    await screen.findByText(/could not confirm this change/);
    expect(
      screen.getByRole("button", { name: "Add team member" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh team list" }));
    await screen.findByText(/Assignment confirmed/);
    expect(grantStaff).toHaveBeenCalledTimes(1);
  });
  it("does not grant a replacement until unknown removal is confirmed", async () => {
    vi.mocked(revokeStaff).mockRejectedValue(new ProofError("NETWORK", 0));
    vi.mocked(listStaff)
      .mockResolvedValueOnce({ ...empty, assignments: [assigned] })
      .mockResolvedValue(empty);
    render(
      <TeamPanel
        detail={detail}
        csrf="csrf"
        onSessionExpired={vi.fn()}
        onScopeLost={vi.fn()}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Change assignment/ }),
    );
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "EVENT_ADMIN" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save assignment change" }),
    );
    await screen.findByText(/could not confirm this change/);
    expect(grantStaff).not.toHaveBeenCalled();
    expect(screen.getByText("Last confirmed assignment")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Refresh team list" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue assignment change" }),
    );
    await screen.findByText("Team assignment saved.");
    expect(revokeStaff).toHaveBeenCalledTimes(1);
    expect(grantStaff).toHaveBeenCalledTimes(1);
  });
  it("reports a partial role change when the replacement is rejected", async () => {
    vi.mocked(grantStaff).mockRejectedValue(new ProofError("FORBIDDEN", 403));
    vi.mocked(listStaff).mockResolvedValue({
      ...empty,
      assignments: [assigned],
    });
    render(
      <TeamPanel
        detail={detail}
        csrf="csrf"
        onSessionExpired={vi.fn()}
        onScopeLost={vi.fn()}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Change assignment/ }),
    );
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: "EVENT_ADMIN" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save assignment change" }),
    );
    await screen.findByText(
      /previous assignment was removed, but its replacement was not added/,
    );
    expect(
      screen.getByRole("button", { name: "Save assignment change" }),
    ).toBeDisabled();
  });
});
