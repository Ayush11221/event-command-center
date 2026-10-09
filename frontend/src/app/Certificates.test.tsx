import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  certificateRequest,
  type OwnerCertificateStatus,
  type StaffCertificateStatus,
} from "../services/certificates";
import { currentActor, ProofError } from "../services/proof";
import { OwnerCertificatePanel } from "./OwnerCertificatePanel";
import { CertificatesPage } from "./CertificatesPage";
vi.mock("../services/certificates", async (original) => ({
  ...(await original<typeof import("../services/certificates")>()),
  certificateRequest: vi.fn(),
}));
vi.mock("../services/proof", async (original) => ({
  ...(await original<typeof import("../services/proof")>()),
  currentActor: vi.fn(),
}));
const base: OwnerCertificateStatus = {
  event_id: "event",
  registration_id: "registration",
  state: "ELIGIBLE",
  eligibility_rule_version: "CERT_ELIGIBILITY_V1",
  recipient_name_set: false,
  recipient_name: null,
  recipient_name_updated_at: null,
  recipient_name_locked: false,
  certificate: null,
};
const cert = {
  certificate_id: "certificate",
  certificate_number: "certificate",
  status: "ISSUED" as const,
  template_id: "classic",
  template_version: 1,
  font_id: "sans",
  eligibility_rule_version: "CERT_ELIGIBILITY_V1",
  issued_at: "2026-10-03T12:00:00Z",
  revoked_at: null,
};
beforeEach(() => {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:protected");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});
describe("Slice 9 certificate UI", () => {
  it.each([
    ["NOT_ELIGIBLE", false, /Check in at the entry gate/],
    ["ELIGIBLE", false, /Save the name you want/],
    ["ELIGIBLE", true, /Ask the organizer to issue/],
    ["ISSUED", true, /Your certificate PDF is ready/],
  ] as const)(
    "explains the next step for %s with saved name %s",
    async (state, saved, guidance) => {
      vi.mocked(certificateRequest).mockResolvedValue({
        ...base,
        state,
        recipient_name_set: saved,
        recipient_name: saved ? "Synthetic Attendee" : null,
        recipient_name_locked: state === "ISSUED",
        certificate: state === "ISSUED" ? cert : null,
      });
      render(
        <OwnerCertificatePanel
          registrationId="registration"
          registrationState="REGISTERED"
          csrf="csrf"
          onOwnershipLost={vi.fn()}
        />,
      );
      expect(await screen.findByText(guidance)).toBeVisible();
      expect(
        vi
          .mocked(certificateRequest)
          .mock.calls.every((call) => call[2] === undefined),
      ).toBe(true);
    },
  );
  it("rejects entry credentials as certificate references without submitting them", async () => {
    vi.mocked(currentActor).mockResolvedValue({
      csrf_token: "staff-csrf",
    } as Awaited<ReturnType<typeof currentActor>>);
    vi.mocked(certificateRequest).mockResolvedValue({
      templates: [{ template_id: "classic", template_version: 1 }],
      fonts: [{ font_id: "sans" }],
    });
    render(<CertificatesPage eventId="event" />);
    fireEvent.change(
      await screen.findByLabelText("Participant registration link or ID"),
      { target: { value: "qr1.synthetic-invalid-entry-token" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Check eligibility" }));
    await screen.findByText(
      /Paste a registration page link or registration ID\./,
      { selector: ".notice" },
    );
    expect(certificateRequest).toHaveBeenCalledTimes(1);
  });
  it("captures own name in a separate command without a registration-create change", async () => {
    vi.mocked(certificateRequest).mockResolvedValue(base);
    render(
      <OwnerCertificatePanel
        registrationId="registration"
        registrationState="REGISTERED"
        csrf="csrf"
        onOwnershipLost={vi.fn()}
      />,
    );
    await screen.findByRole("textbox", { name: "Certificate recipient name" });
    fireEvent.change(screen.getByLabelText("Certificate recipient name"), {
      target: { value: "Alice" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save recipient name" }),
    );
    await waitFor(() =>
      expect(certificateRequest).toHaveBeenCalledWith(
        "/registrations/registration/certificate/recipient-name",
        expect.anything(),
        expect.objectContaining({
          csrf: "csrf",
          body: { recipient_name: "Alice" },
          key: expect.any(String),
        }),
      ),
    );
  });
  it.each([0, 503])(
    "keeps an uncertain name command frozen under the same key after status %s",
    async (status) => {
      vi.mocked(certificateRequest)
        .mockResolvedValueOnce(base)
        .mockRejectedValue(
          new ProofError(
            status === 0 ? "NETWORK" : "DEPENDENCY_UNAVAILABLE",
            status,
          ),
        );
      render(
        <OwnerCertificatePanel
          registrationId="registration"
          registrationState="REGISTERED"
          csrf="csrf"
          onOwnershipLost={vi.fn()}
        />,
      );
      fireEvent.change(
        await screen.findByLabelText("Certificate recipient name"),
        { target: { value: "Alice" } },
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Save recipient name" }),
      );
      fireEvent.click(
        await screen.findByRole("button", { name: "Retry same name command" }),
      );
      await waitFor(() =>
        expect(
          vi.mocked(certificateRequest).mock.calls.filter((call) => call[2]),
        ).toHaveLength(2),
      );
      const calls = vi
        .mocked(certificateRequest)
        .mock.calls.filter((call) => call[2]);
      expect(calls[1][2]).toEqual(calls[0][2]);
    },
  );
  it("locks issued/revoked names, denies cancelled edits and clears binary access on pagehide", async () => {
    vi.mocked(certificateRequest)
      .mockResolvedValueOnce({
        ...base,
        state: "ISSUED",
        recipient_name: "Alice",
        recipient_name_locked: true,
        certificate: cert,
      })
      .mockResolvedValue(new Blob(["%PDF"]));
    const view = render(
      <OwnerCertificatePanel
        registrationId="registration"
        registrationState="REGISTERED"
        csrf="csrf"
        onOwnershipLost={vi.fn()}
      />,
    );
    expect(
      await screen.findByLabelText("Certificate recipient name"),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Prepare certificate download" }),
    );
    expect(
      await screen.findByRole("link", { name: "Download my certificate PDF" }),
    ).toHaveAttribute("href", "blob:protected");
    fireEvent(window, new Event("pagehide"));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:protected");
    expect(
      screen.queryByRole("link", { name: "Download my certificate PDF" }),
    ).toBeNull();
    view.unmount();
    vi.mocked(certificateRequest).mockResolvedValue({
      ...base,
      state: "REVOKED",
      recipient_name_locked: true,
      certificate: { ...cert, status: "REVOKED" },
    });
    render(
      <OwnerCertificatePanel
        registrationId="registration"
        registrationState="CANCELLED"
        csrf="csrf"
        onOwnershipLost={vi.fn()}
      />,
    );
    expect(
      await screen.findByLabelText("Certificate recipient name"),
    ).toBeDisabled();
    expect(screen.queryByText("Save recipient name")).toBeNull();
    expect(screen.queryByText("Prepare certificate download")).toBeNull();
  });
  it("clears own data when proof expires", async () => {
    const lost = vi.fn();
    vi.mocked(certificateRequest).mockRejectedValue(
      new ProofError("UNAUTHENTICATED", 401),
    );
    render(
      <OwnerCertificatePanel
        registrationId="registration"
        registrationState="REGISTERED"
        csrf="csrf"
        onOwnershipLost={lost}
      />,
    );
    await waitFor(() => expect(lost).toHaveBeenCalled());
    expect(screen.queryByLabelText("Certificate recipient name")).toBeNull();
  });
  it("shows only the staff name boolean and supplies exact template selection on explicit issue", async () => {
    vi.mocked(currentActor).mockResolvedValue({
      csrf_token: "staff-csrf",
    } as Awaited<ReturnType<typeof currentActor>>);
    const status: StaffCertificateStatus = {
      ...base,
      registration_id: "11111111-1111-4111-8111-111111111111",
      recipient_name_set: true,
      issue_work: null,
    };
    vi.mocked(certificateRequest).mockImplementation(async (path) =>
      path.endsWith("certificate-templates")
        ? {
            templates: [{ template_id: "classic", template_version: 1 }],
            fonts: [{ font_id: "sans" }],
          }
        : status,
    );
    render(<CertificatesPage eventId="event" />);
    fireEvent.change(
      await screen.findByLabelText("Participant registration link or ID"),
      {
        target: {
          value:
            window.location.origin +
            "/registrations/11111111-1111-4111-8111-111111111111",
        },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Check eligibility" }));
    await screen.findByText("Recipient name: Set by owner");
    expect(screen.queryByLabelText("Certificate recipient name")).toBeNull();
    expect(screen.queryByText("Download my certificate PDF")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Issue certificate" }));
    await waitFor(() =>
      expect(certificateRequest).toHaveBeenCalledWith(
        "/events/event/registrations/11111111-1111-4111-8111-111111111111/certificate",
        expect.anything(),
        expect.objectContaining({
          body: {
            template_id: "classic",
            template_version: 1,
            font_id: "sans",
          },
          csrf: "staff-csrf",
          key: expect.any(String),
        }),
      ),
    );
  });
});
