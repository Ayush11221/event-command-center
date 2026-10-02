import type { ManagementDetail } from "../services/events";

export function eventDetailFixture(
  overrides: Partial<ManagementDetail> = {},
): ManagementDetail {
  return {
    event_id: "one",
    name: "Owned draft",
    state: "DRAFT",
    description: "Read-only configuration",
    visibility: null,
    public_location: null,
    image_url: null,
    category: null,
    tags: [],
    start_at: null,
    end_at: null,
    time_zone: null,
    registration_capacity: null,
    registration_opens_at: null,
    registration_closes_at: null,
    registration_cancellation_cutoff_at: null,
    registration_manually_closed: false,
    checkout_enabled: false,
    gates: [],
    readiness: {
      configured_gate_present: false,
      publish_blockers: [],
      live_blockers: [],
    },
    availability: {
      policy_status: "OPEN",
      reasons: [],
      opens_at: null,
      closes_at: null,
      as_of: "2026-10-02T12:00:00Z",
    },
    permitted_actions: ["EDIT_EVENT", "CREATE_GATE", "CANCEL"],
    revision: 3,
    as_of: "2026-10-02T12:00:00Z",
    correlation_id: "detail-ref",
    ...overrides,
  };
}
