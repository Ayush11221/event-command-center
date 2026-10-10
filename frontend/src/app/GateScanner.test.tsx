import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  act,
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
const camera = vi.hoisted(() => ({
  detect: null as null | ((value: string) => void),
}));
vi.mock("./CameraCapture", () => ({
  CameraCapture: ({
    onDetect,
    blocked,
  }: {
    onDetect: (value: string) => void;
    blocked: boolean;
  }) => {
    camera.detect = onDetect;
    return (
      <button
        type="button"
        disabled={blocked}
        onClick={() => onDetect("qr1.camera-secret")}
      >
        Start camera
      </button>
    );
  },
}));
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
  vi.mocked(scannerScope).mockResolvedValue({
    event_name: "Community event",
    gate_label: "Gate 1",
  });
  vi.mocked(submitScan).mockResolvedValue(accepted);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
async function open() {
  render(<GateScanner />);
  await waitFor(() =>
    expect(screen.getByLabelText("Entry QR code")).toBeInTheDocument(),
  );
  screen.getByText("Enter QR code manually").closest("details")!.open = true;
}
function enter() {
  screen.getByText("Enter QR code manually").closest("details")!.open = true;
  fireEvent.change(screen.getByLabelText("Entry QR code"), {
    target: { value: "qr1.opaque-secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Check in" }));
}
describe("Gate/Security scanner", () => {
  it("records exit with the same QR, clears stale entry feedback and locks direction during recovery", async () => {
    vi.mocked(scannerScope).mockResolvedValue({
      event_name: "Community event",
      gate_label: "Gate 1",
      checkout_enabled: true,
    });
    await open();
    enter();
    await screen.findByRole("heading", { name: "Entry allowed" });
    fireEvent.change(screen.getByLabelText("Scan mode"), {
      target: { value: "CHECK_OUT" },
    });
    expect(screen.queryByRole("heading", { name: "Entry allowed" })).toBeNull();
    vi.mocked(submitScan)
      .mockRejectedValueOnce(new ProofError("NETWORK", 0))
      .mockResolvedValueOnce({ ...accepted, attendance_status: "LEFT" });
    fireEvent.change(screen.getByLabelText("Entry QR code"), {
      target: { value: "qr1.opaque-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check out" }));
    await screen.findByRole("button", { name: "Retry same scan" });
    expect(screen.getByRole("alert")).toHaveTextContent("Exit unconfirmed");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Hold entry");
    expect(screen.getByLabelText("Scan mode")).toBeDisabled();
    const original = vi.mocked(submitScan).mock.calls[1][0];
    expect(original.direction).toBe("CHECK_OUT");
    fireEvent.click(screen.getByRole("button", { name: "Retry same scan" }));
    await screen.findByRole("heading", { name: "Exit recorded" });
    expect(vi.mocked(submitScan).mock.calls[2][0]).toEqual(original);
  });
  it("does not enable exit when the assigned-event policy disables checkout", async () => {
    await open();
    expect(screen.getByRole("option", { name: "Exit" })).toBeDisabled();
    expect(
      screen.getByText("Exit scanning is disabled for this event."),
    ).toBeVisible();
  });
  it("keeps role context and offers next-person focus without remounting capture", async () => {
    await open();
    expect(screen.getByText("Gate / Security")).toBeVisible();
    const captureButton = screen.getByRole("button", { name: "Start camera" });
    fireEvent.click(captureButton);
    await screen.findByRole("heading", { name: "Entry allowed" });
    const result = screen.getByRole("status");
    expect(result).toHaveTextContent("Entry allowed");
    expect(result).toHaveAttribute("aria-live", "polite");
    fireEvent.click(screen.getByRole("button", { name: "Scan next person" }));
    expect(screen.queryByRole("heading", { name: "Entry allowed" })).toBeNull();
    expect(screen.getByRole("button", { name: "Start camera" })).toBe(
      captureButton,
    );
    expect(captureButton.parentElement).toHaveFocus();
    expect(submitScan).toHaveBeenCalledTimes(1);
  });
  it("retains manual input and pending recovery on application switching without mutations", async () => {
    await open();
    const input = screen.getByLabelText("Entry QR code");
    fireEvent.change(input, { target: { value: "qr1.unsaved" } });
    fireEvent(document, new Event("visibilitychange"));
    expect(input).toHaveValue("qr1.unsaved");
    expect(submitScan).not.toHaveBeenCalled();
    vi.mocked(submitScan).mockRejectedValueOnce(new ProofError("NETWORK", 0));
    enter();
    await screen.findByRole("alert");
    fireEvent(document, new Event("visibilitychange"));
    expect(
      screen.getByRole("button", { name: "Retry same scan" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Scan next person" }),
    ).toBeNull();
    expect(submitScan).toHaveBeenCalledTimes(1);
  });
  it("camera detection uses the existing scan API, masks values and permits the next attempt without reload", async () => {
    await open();
    expect(screen.getByText("Community event")).toBeVisible();
    expect(screen.getByText("Gate 1")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Start camera" }));
    await screen.findByRole("heading", { name: "Entry allowed" });
    expect(submitScan).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: "qr1.camera-secret",
        event_id: "event",
        gate_id: "gate",
      }),
      "csrf",
      expect.any(AbortSignal),
    );
    act(() => camera.detect!("qr1.next-secret"));
    await waitFor(() => expect(submitScan).toHaveBeenCalledTimes(2));
    expect(vi.mocked(submitScan).mock.calls[0][0].scan_id).not.toBe(
      vi.mocked(submitScan).mock.calls[1][0].scan_id,
    );
    expect(document.body.textContent).not.toMatch(
      /camera-secret|next-secret|opaque-secret/,
    );
  });
  it("ignores rapid camera callbacks during a mutation and retains the original unknown command", async () => {
    vi.mocked(submitScan).mockRejectedValueOnce(new ProofError("NETWORK", 0));
    await open();
    act(() => {
      camera.detect!("qr1.camera-secret");
      camera.detect!("qr1.camera-secret");
    });
    await screen.findByRole("alert");
    act(() => camera.detect!("qr1.other-secret"));
    expect(submitScan).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Start new scan" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry same scan" }));
    await screen.findByRole("heading", { name: "Entry allowed" });
    expect(vi.mocked(submitScan).mock.calls[1][0]).toBe(
      vi.mocked(submitScan).mock.calls[0][0],
    );
  });
  it("handles a non-entry QR without sending an oversized value", async () => {
    await open();
    act(() => camera.detect!("x".repeat(129)));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "cannot be read as an entry code",
    );
    expect(submitScan).not.toHaveBeenCalled();
  });
  it("waits for authenticated gate context before accepting a token", async () => {
    vi.mocked(scannerScope).mockReturnValue(new Promise(() => {}));
    render(<GateScanner />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking scanner access",
    );
    await screen.findByText("Verifying gate context...");
    expect(screen.queryByLabelText("Entry QR code")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(scannerScope).toHaveBeenCalledWith(
        "event",
        "gate",
        expect.any(AbortSignal),
      ),
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
      expect(screen.queryByLabelText("Entry QR code")).not.toBeInTheDocument();
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
    expect(screen.getByLabelText("Entry QR code")).toBeEnabled();
  });
  it("shows accepted result and clears the token without browser persistence", async () => {
    await open();
    enter();
    await screen.findByRole("heading", { name: "Entry allowed" });
    expect(screen.getByRole("status")).toHaveTextContent("Entry allowed");
    expect(screen.getByLabelText("Entry QR code")).toHaveValue("");
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
    ["INVALID_CREDENTIAL", "QR code not recognized"],
    ["EXPIRED_CREDENTIAL", "QR code expired"],
    ["CANCELLED_CREDENTIAL", "Registration cancelled"],
    ["ALREADY_CHECKED_IN", "Already checked in"],
    ["REGISTRATION_UNAVAILABLE", "Entry is not currently open"],
  ] as const)("explains %s safely", async (reason, message) => {
    vi.mocked(submitScan).mockResolvedValue({
      ...accepted,
      decision: "REJECTED",
      reason,
      registration_status:
        reason === "CANCELLED_CREDENTIAL" ? "CANCELLED" : "REGISTERED",
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
    await screen.findByRole("heading", { name: "Entry allowed" });
    const first = vi.mocked(submitScan).mock.calls[0][0];
    vi.mocked(submitScan).mockResolvedValue({
      ...accepted,
      decision: "REJECTED",
      reason: "ALREADY_CHECKED_IN",
    });
    enter();
    await screen.findByRole("heading", { name: "Already checked in" });
    expect(vi.mocked(submitScan).mock.calls[1][0].scan_id).not.toBe(
      first.scan_id,
    );
  });
  it("does not claim a registration was cancelled when only its QR was revoked", async () => {
    vi.mocked(submitScan).mockResolvedValue({
      ...accepted,
      decision: "REJECTED",
      reason: "CANCELLED_CREDENTIAL",
      registration_status: "REGISTERED",
    });
    await open();
    enter();
    expect(
      await screen.findByRole("heading", { name: "QR code cancelled" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Registration cancelled" }),
    ).toBeNull();
  });
  it("holds entry and disables form while awaiting a server decision", async () => {
    vi.mocked(submitScan).mockReturnValue(new Promise(() => {}));
    await open();
    enter();
    expect(screen.getByRole("status")).toHaveTextContent("Hold entry");
    expect(screen.getByLabelText("Entry QR code")).toBeDisabled();
    expect(screen.getByLabelText("Entry QR code")).toHaveValue("");
    expect(screen.queryByLabelText("Assigned gate")).toBeNull();
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
      expect(screen.getByLabelText("Entry QR code")).toHaveValue("");
      const first = vi.mocked(submitScan).mock.calls[0][0];
      fireEvent.click(screen.getByRole("button", { name: "Retry same scan" }));
      await screen.findByRole("heading", { name: "Entry allowed" });
      expect(vi.mocked(submitScan).mock.calls[1][0]).toBe(first);
      expect(screen.getByRole("status")).toHaveTextContent("Recovered result");
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
      expect(screen.getByLabelText("Entry QR code")).toBeEnabled();
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
      expect(screen.queryByLabelText("Entry QR code")).not.toBeInTheDocument();
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
    await screen.findByLabelText("Entry QR code");
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
    await screen.findByRole("heading", { name: "Entry allowed" });
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
      screen.queryByRole("heading", { name: "Entry allowed" }),
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
    await screen.findByLabelText("Entry QR code");
    enter();
    const signal = vi.mocked(submitScan).mock.calls[0][2];
    view.unmount();
    expect(signal.aborted).toBe(true);
    resolve(accepted);
    expect(
      screen.queryByRole("heading", { name: "Entry allowed" }),
    ).not.toBeInTheDocument();
  });
  it("drops secrets and access on pagehide", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Entry QR code"), {
      target: { value: "secret" },
    });
    fireEvent(window, new Event("pagehide"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Scanner access lost",
    );
    expect(screen.queryByLabelText("Entry QR code")).not.toBeInTheDocument();
  });
});
