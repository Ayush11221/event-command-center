import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { certificateRequest, CertificateError } from "../services/certificates";
import { ProofError } from "../services/proof";
import { CertificateBatchPanel } from "./CertificateBatchPanel";
import { CertificateDeliveryPanel } from "./CertificateDeliveryPanel";
import type { Batch, Delivery } from "../services/certificate-delivery";
vi.mock("../services/certificates", async (original) => ({
  ...(await original<typeof import("../services/certificates")>()),
  certificateRequest: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const catalogue = {
  templates: [{ template_id: "classic", template_version: 1 }],
  fonts: [{ font_id: "sans" }],
};
const batch: Batch = {
  batch_id: "batch",
  event_id: "event",
  status: "RUNNING",
  template_id: "classic",
  template_version: 1,
  font_id: "sans",
  selected_count: 2,
  eligible_count: 1,
  generated_count: 0,
  already_satisfied_count: 0,
  successful_count: 0,
  failed_count: 1,
  pending_count: 1,
  delivery_counts: {
    not_required: 0,
    pending: 0,
    sending: 0,
    sent: 0,
    unknown: 0,
    failed: 0,
  },
  created_at: "2026-10-03T12:00:00Z",
  started_at: null,
  completed_at: null,
};
const delivery: Delivery = {
  delivery_id: "delivery",
  certificate_id: "certificate",
  status: "FAILED",
  reason_code: "SUBMISSION_REJECTED",
  attempt_count: 1,
  max_attempts: 3,
  created_at: batch.created_at,
  updated_at: batch.created_at,
  last_attempt_at: null,
  sent_at: null,
};
function setupBatch() {
  render(
    <CertificateBatchPanel
      eventId="event"
      csrf="csrf"
      catalogue={catalogue}
      onFailure={vi.fn()}
    />,
  );
}
it("confirms explicit selection and submits the finalized closed request", async () => {
  vi.mocked(certificateRequest).mockImplementation(async (path) =>
    path.includes("/items")
      ? { items: [], next_cursor: null }
      : ({ batch } as never),
  );
  setupBatch();
  fireEvent.change(screen.getByLabelText(/Registration links or IDs/), {
    target: {
      value:
        "11111111-1111-4111-8111-111111111111, /registrations/22222222-2222-4222-8222-222222222222",
    },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Review batch selection" }),
  );
  expect(screen.getByText(/Confirm issuance for 2/)).toBeInTheDocument();
  expect(certificateRequest).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm batch issuance" }),
  );
  await screen.findByText(/Running: 0 successful, 1 failed, 1 pending/);
  expect(certificateRequest).toHaveBeenCalledWith(
    "/events/event/certificate-batches",
    expect.anything(),
    expect.objectContaining({
      csrf: "csrf",
      key: expect.any(String),
      body: {
        registration_ids: [
          "11111111-1111-4111-8111-111111111111",
          "22222222-2222-4222-8222-222222222222",
        ],
        template_id: "classic",
        template_version: 1,
        font_id: "sans",
      },
    }),
  );
  expect(screen.getByText(/No item outcomes/)).toBeInTheDocument();
});
it("reads saved batch progress and paginates outcomes without losing context", async () => {
  vi.mocked(certificateRequest).mockImplementation(async (path) => {
    if (path.includes("/items"))
      return {
        items: [
          {
            registration_id: path.includes("cursor") ? "second" : "first",
            status: "FAILED",
            result_code: "NAME_MISSING",
          },
        ],
        next_cursor: path.includes("cursor") ? null : "first",
      } as never;
    return { batch } as never;
  });
  setupBatch();
  fireEvent.change(screen.getByLabelText("Batch reference"), {
    target: { value: "batch" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Read batch status" }));
  await screen.findByText(/Registration reference: first — NAME_MISSING/);
  fireEvent.click(screen.getByRole("button", { name: "Next item page" }));
  await screen.findByText(/Registration reference: second — NAME_MISSING/);
  expect(certificateRequest).toHaveBeenCalledWith(
    "/events/event/certificate-batches/batch/items?limit=25&cursor=first",
    expect.anything(),
  );
  fireEvent.click(screen.getByRole("button", { name: "First item page" }));
  await screen.findByText(/Registration reference: first — NAME_MISSING/);
});
it("retains the same batch key/body for an uncertain request and reports validation errors", async () => {
  vi.mocked(certificateRequest).mockRejectedValue(new ProofError("NETWORK", 0));
  setupBatch();
  fireEvent.change(screen.getByLabelText(/Registration links or IDs/), {
    target: { value: "11111111-1111-4111-8111-111111111111" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Review batch selection" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm batch issuance" }),
  );
  await screen.findByRole("button", { name: "Retry same batch command" });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Retry same batch command" }),
    ).toBeEnabled(),
  );
  const original = vi.mocked(certificateRequest).mock.calls[0][2];
  vi.mocked(certificateRequest).mockRejectedValue(
    new CertificateError("VALIDATION", 422),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Retry same batch command" }),
  );
  await screen.findByText("Check the input and supported certificate text.");
  expect(vi.mocked(certificateRequest).mock.calls[1][2]).toEqual(original);
});
it.each(["SENT", "UNKNOWN", "NOT_REQUIRED"] as const)(
  "renders independent owner delivery %s without write controls",
  async (status) => {
    vi.mocked(certificateRequest).mockResolvedValue({
      delivery: {
        ...delivery,
        status,
        reason_code: status === "NOT_REQUIRED" ? "NOT_DELIVERABLE" : null,
      },
    });
    render(
      <CertificateDeliveryPanel
        path="/registrations/reg/certificate/delivery"
        csrf="csrf"
        onFailure={vi.fn()}
      />,
    );
    await screen.findByText(status);
    expect(
      screen.queryByRole("button", { name: /Retry failed|Request email/ }),
    ).not.toBeInTheDocument();
    if (status === "SENT")
      expect(
        screen.getByText(/recipient delivery is not confirmed/),
      ).toBeInTheDocument();
    if (status === "UNKNOWN")
      expect(screen.getByText(/Held for reconciliation/)).toBeInTheDocument();
  },
);
it("retries FAILED through the delivery endpoint, without issuance, and exposes loading state", async () => {
  vi.mocked(certificateRequest)
    .mockResolvedValueOnce({ delivery })
    .mockResolvedValueOnce({
      delivery: { ...delivery, status: "PENDING", attempt_count: 2 },
    });
  render(
    <CertificateDeliveryPanel
      path="/events/event/registrations/reg/certificate/delivery"
      csrf="csrf"
      staff
      onFailure={vi.fn()}
    />,
  );
  expect(screen.getByText("Checking delivery…")).toBeInTheDocument();
  fireEvent.click(
    await screen.findByRole("button", { name: "Retry failed delivery" }),
  );
  await screen.findByText("Pending");
  expect(certificateRequest).toHaveBeenLastCalledWith(
    "/events/event/registrations/reg/certificate/delivery/retry",
    expect.anything(),
    expect.objectContaining({
      csrf: "csrf",
      key: expect.any(String),
      body: {},
    }),
  );
});
it.each([
  { status: "UNKNOWN", count: 1, revoked: false },
  { status: "FAILED", count: 3, revoked: false },
  { status: "FAILED", count: 1, revoked: true },
])("does not offer unsafe retries %j", async (row) => {
  vi.mocked(certificateRequest).mockResolvedValue({
    delivery: { ...delivery, status: row.status, attempt_count: row.count },
  });
  render(
    <CertificateDeliveryPanel
      path="/staff/delivery"
      csrf="csrf"
      staff
      revoked={row.revoked}
      onFailure={vi.fn()}
    />,
  );
  await screen.findByText(
    row.status.charAt(0) + row.status.slice(1).toLowerCase(),
  );
  expect(
    screen.queryByRole("button", { name: "Retry failed delivery" }),
  ).not.toBeInTheDocument();
});
it("shows empty state, enrolls previous issuance and clears data on scope loss", async () => {
  const fail = vi.fn();
  vi.mocked(certificateRequest)
    .mockResolvedValueOnce({ delivery: null })
    .mockResolvedValueOnce({ delivery: { ...delivery, status: "PENDING" } })
    .mockRejectedValueOnce(new ProofError("REGISTRATION_NOT_FOUND", 404));
  render(
    <CertificateDeliveryPanel
      path="/staff/delivery"
      csrf="csrf"
      staff
      onFailure={fail}
    />,
  );
  await screen.findByText("No delivery intent yet.");
  fireEvent.click(
    screen.getByRole("button", { name: "Request email delivery" }),
  );
  await screen.findByText("Pending");
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh delivery status" }),
  );
  await waitFor(() =>
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ status: 404 })),
  );
});
