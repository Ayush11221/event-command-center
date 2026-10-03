import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentActor, ProofError, type ActorState } from "../services/proof";
import {
  scannerScope,
  submitScan,
  type ScanResult,
} from "../services/scanning";
import { GateScanner } from "./GateScanner";
vi.mock("../services/proof", async (original) => ({
  ...(await original<typeof import("../services/proof")>()),
  currentActor: vi.fn(),
}));
vi.mock("../services/scanning", () => ({
  scannerScope: vi.fn(),
  submitScan: vi.fn(),
}));
const actor: ActorState = {
  user_id: "operator",
  organizer_capable: false,
  csrf_token: "csrf",
  assignments: [
    {
      id: "assignment",
      event_id: "event",
      gate_id: "gate",
      role: "GATE_SECURITY",
    },
  ],
};
const accepted = {
  decision: "ACCEPTED",
  reason: "ACCEPTED",
  registration_status: "REGISTERED",
  attendance_status: "INSIDE",
  decided_at: new Date().toISOString(),
  replayed: false,
  correlation_id: "correlation",
} as ScanResult;
beforeEach(() => {
  vi.mocked(currentActor).mockResolvedValue(actor);
  vi.mocked(scannerScope).mockResolvedValue();
  vi.mocked(submitScan).mockResolvedValue(accepted);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
async function open() {
  render(<GateScanner />);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Check in" }),
    ).toBeInTheDocument(),
  );
}
function enter() {
  fireEvent.change(screen.getByLabelText("QR credential"), {
    target: { value: "qr1.opaque-secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Check in" }));
}
describe("Gate/Security scanner", () => {
  it("waits for authenticated gate context before accepting a token", async () => {
    vi.mocked(scannerScope).mockReturnValue(new Promise(() => {}));
    render(<GateScanner />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking scanner access",
    );
    await screen.findByText("Verifying gate context...");
    expect(screen.queryByLabelText("QR credential")).not.toBeInTheDocument();
    expect(scannerScope).toHaveBeenCalledWith(
      "event",
      "gate",
      expect.any(AbortSignal),
    );
  });
  it.each(["EVENT_ADMIN", "VOLUNTEER", "PARTICIPANT", "OWNER"])(
    "does not show scanning controls for %s alone",
    async (role) => {
      vi.mocked(currentActor).mockResolvedValue({
        ...actor,
        organizer_capable: role === "OWNER",
        assignments:
          role === "OWNER" || role === "PARTICIPANT"
            ? []
            : [{ ...actor.assignments[0], role, gate_id: null }],
      });
      render(<GateScanner />);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Gate/Security assignment",
      );
      expect(screen.queryByLabelText("QR credential")).not.toBeInTheDocument();
      expect(scannerScope).not.toHaveBeenCalled();
      expect(submitScan).not.toHaveBeenCalled();
    },
  );
  it("allows separately assigned managers to use their gate role", async () => {
    vi.mocked(currentActor).mockResolvedValue({
      ...actor,
      organizer_capable: true,
    });
    await open();
    expect(screen.getByLabelText("QR credential")).toBeEnabled();
  });
  it("shows accepted result and clears the token without browser persistence", async () => {
    await open();
    enter();
    await screen.findByRole("heading", { name: "Accepted" });
    expect(screen.getByRole("status")).toHaveTextContent("Entry permitted");
    expect(screen.getByLabelText("QR credential")).toHaveValue("");
    expect(submitScan).toHaveBeenCalledWith(
      {
        scan_id: expect.any(String),
        event_id: "event",
        gate_id: "gate",
        credential: "qr1.opaque-secret",
      },
      "csrf",
      expect.any(AbortSignal),
    );
    expect(
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ).not.toContain("opaque-secret");
    expect(screen.getByRole("button", { name: "Check in" })).toBeDisabled();
  });
  it.each([
    ["INVALID_CREDENTIAL", "Invalid credential"],
    ["EXPIRED_CREDENTIAL", "Credential expired"],
    ["CANCELLED_CREDENTIAL", "Registration or credential cancelled"],
    ["ALREADY_CHECKED_IN", "Already checked in"],
    ["REGISTRATION_UNAVAILABLE", "Check-in is unavailable"],
  ] as const)("explains %s safely", async (reason, message) => {
    vi.mocked(submitScan).mockResolvedValue({
      ...accepted,
      decision: "REJECTED",
      reason,
    });
    await open();
    enter();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(message),
    );
    expect(screen.queryByText("qr1.opaque-secret")).not.toBeInTheDocument();
  });
  it("shows duplicate and uses a new scan ID for a fresh attempt", async () => {
    await open();
    enter();
    await screen.findByRole("heading", { name: "Accepted" });
    const first = vi.mocked(submitScan).mock.calls[0][0];
    vi.mocked(submitScan).mockResolvedValue({
      ...accepted,
      decision: "REJECTED",
      reason: "ALREADY_CHECKED_IN",
    });
    enter();
    await screen.findByRole("heading", { name: "Duplicate" });
    expect(vi.mocked(submitScan).mock.calls[1][0].scan_id).not.toBe(
      first.scan_id,
    );
  });
  it("holds entry and disables form while awaiting a server decision", async () => {
    vi.mocked(submitScan).mockReturnValue(new Promise(() => {}));
    await open();
    enter();
    expect(screen.getByRole("status")).toHaveTextContent("Hold entry");
    expect(screen.getByLabelText("QR credential")).toBeDisabled();
    expect(screen.getByLabelText("QR credential")).toHaveValue("");
    expect(screen.getByLabelText("Assigned gate")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Check in" })).toBeDisabled();
  });
  it.each([0, 503])(
    "recovers unknown outcome %s with exactly the same command",
    async (status) => {
      vi.mocked(submitScan)
        .mockRejectedValueOnce(new ProofError("NETWORK", status))
        .mockResolvedValueOnce({ ...accepted, replayed: true });
      await open();
      enter();
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Decision unknown. Hold entry",
      );
      expect(screen.getByLabelText("QR credential")).toHaveValue("");
      const first = vi.mocked(submitScan).mock.calls[0][0];
      fireEvent.click(screen.getByRole("button", { name: "Retry same scan" }));
      await screen.findByRole("heading", { name: "Accepted" });
      expect(vi.mocked(submitScan).mock.calls[1][0]).toBe(first);
      expect(screen.getByRole("status")).toHaveTextContent("recovered result");
    },
  );
  it.each([400, 409, 410])(
    "offers deliberate recovery for non-retryable %s",
    async (status) => {
      vi.mocked(submitScan).mockRejectedValueOnce(
        new ProofError("CONFLICT", status),
      );
      await open();
      enter();
      expect(await screen.findByRole("alert")).toHaveTextContent("Hold entry");
      expect(
        screen.queryByRole("button", { name: "Retry same scan" }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Start new scan" }));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByLabelText("QR credential")).toBeEnabled();
    },
  );
  it.each([401, 403, 404])(
    "clears scanner and pending secret on scope loss %s",
    async (status) => {
      vi.mocked(submitScan).mockRejectedValueOnce(
        new ProofError("FORBIDDEN", status),
      );
      await open();
      enter();
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Scanner access lost",
      );
      expect(screen.queryByLabelText("QR credential")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Retry same scan" }),
      ).not.toBeInTheDocument();
    },
  );
  it("can retry session and gate availability checks", async () => {
    vi.mocked(currentActor).mockRejectedValueOnce(new ProofError("NETWORK", 0));
    vi.mocked(scannerScope).mockRejectedValueOnce(new ProofError("NETWORK", 0));
    render(<GateScanner />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry session check" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry gate check" }),
    );
    await screen.findByLabelText("QR credential");
  });
  it("shows sign-in recovery for unauthenticated visitors", async () => {
    vi.mocked(currentActor).mockRejectedValueOnce(
      new ProofError("UNAUTHENTICATED", 401),
    );
    render(<GateScanner />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sign in with a Gate/Security account",
    );
    expect(
      screen.getByRole("link", { name: "Sign in at the event workspace" }),
    ).toHaveAttribute("href", "/");
  });
  it("clears the previous decision when choosing another assigned gate", async () => {
    vi.mocked(currentActor).mockResolvedValue({
      ...actor,
      assignments: [
        ...actor.assignments,
        {
          id: "other",
          role: "GATE_SECURITY",
          event_id: "other-event",
          gate_id: "other-gate",
        },
      ],
    });
    await open();
    enter();
    await screen.findByRole("heading", { name: "Accepted" });
    fireEvent.change(screen.getByLabelText("Assigned gate"), {
      target: { value: "1" },
    });
    await waitFor(() =>
      expect(scannerScope).toHaveBeenCalledWith(
        "other-event",
        "other-gate",
        expect.any(AbortSignal),
      ),
    );
    expect(
      screen.queryByRole("heading", { name: "Accepted" }),
    ).not.toBeInTheDocument();
  });
  it("aborts on unmount and suppresses late accepted decisions", async () => {
    let resolve!: (value: ScanResult) => void;
    vi.mocked(submitScan).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(<GateScanner />);
    await screen.findByLabelText("QR credential");
    enter();
    const signal = vi.mocked(submitScan).mock.calls[0][2];
    view.unmount();
    expect(signal.aborted).toBe(true);
    resolve(accepted);
    expect(
      screen.queryByRole("heading", { name: "Accepted" }),
    ).not.toBeInTheDocument();
  });
  it("drops secrets and access on pagehide", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("QR credential"), {
      target: { value: "secret" },
    });
    fireEvent(window, new Event("pagehide"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Scanner access lost",
    );
    expect(screen.queryByLabelText("QR credential")).not.toBeInTheDocument();
  });
});
