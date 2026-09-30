# Event Lifecycle

**Status:** Phase 1 locked MVP lifecycle and registration-availability rules. Registration availability and gate readiness are separate conditions, not additional event states.

## States

| State | Meaning | Participant/operational effect |
| --- | --- | --- |
| Draft | Event is being configured and is not discoverable for registration. | No participant registration or gate validation. |
| Published | PUBLIC events appear in the catalog; PRIVATE events require a controlled link/invitation. Registration may independently be open or closed. | Participants can access permitted details; register only when registration is open. |
| Live | The event is in active operation. | Authorized gates may validate credentials; command center shows live conditions. New registration is closed. |
| Completed | Live operations have ended. | New gate entry stops; eligible certificate and results workflows can proceed under their policies. |
| Cancelled | Organizer has cancelled the event. | No new registration or check-in; existing registration rows remain unchanged and auditable. Participant event-cancellation notification is post-MVP. |

`Archived` is not a required product state. Retention and read-only archival behavior are TBD and do not need a separate state for the MVP.

## Transition baseline

| From → To | Trigger/guard | Actor | Effects and open decision |
| --- | --- | --- | --- |
| Draft → Published | Required configuration passes publication validation (FR-EVT-002/004). | Organizer only. | PUBLIC event enters catalog; PRIVATE event is accessible by controlled link. Registration opens immediately unless a future opening time is configured, subject to capacity/manual/closing rules. |
| Published → Live | Event is ready, at least one gate is configured, and operation begins. | Organizer only. | Gate validation and live monitoring become available; new registration closes regardless of a later configured closing time. |
| Live → Completed | Operations end and attendance state is reconciled or discrepancy is visible. | Organizer only. | Gate entry stops; results remain available. Eligibility alone does not issue certificates; Organizer/Admin explicitly issue eligible certificates. |
| Draft/Published → Cancelled | Explicit cancellation under a reason/confirmation policy. | Organizer only. | New registration/check-in stop; existing registrations remain unchanged and auditable. No MVP participant notification. |
| Live → Cancelled | Explicit Organizer cancellation. | Organizer only. | New registration/check-in stop; existing registration and attendance history remain unchanged and auditable. No MVP participant notification. |

No *event lifecycle* transition occurs automatically based solely on a clock. Registration opening/closing times are separate availability rules.

## Invalid transitions and invariants

- A Published, Live, Completed, or Cancelled event cannot be treated as Draft by an ordinary edit.
- Completed and Cancelled are terminal for attendance operations in the MVP; no terminal reopening action is in the MVP flow.
- An incomplete Draft cannot publish.
- A Published event cannot skip authorization and validation to become Live.
- A registration or credential cannot make a Cancelled event operational. Existing registration status is not rewritten merely because the event is Cancelled, and no new check-in is accepted.
- Every state change is authorized, timestamped, and audited. Organizer may edit Published event details; material changes are visible and auditable. Once Live, changes affecting registration or attendance policy are restricted and cannot silently rewrite the active operational contract.
- Registration capacity is one event value, applied to the number of REGISTERED registrations. Live occupancy counts people INSIDE and is not a second physical/gate-capacity rule.

## Registration availability

Registration availability is a policy/status distinct from lifecycle. Three independent closure causes must be represented:

1. **Scheduled/event-based:** Without a configured opening time, registration opens on publication; a future configured opening time keeps it closed until then. A configured closing time closes registration while Published; without one, registration closes at event start. Transition to Live always closes registration, even if a configured closing time is later.
2. **Capacity-based:** When the number of REGISTERED registrations reaches the single event capacity, new registration blocks. Cancellation frees a slot and automatically reopens only when capacity was the sole closure cause.
3. **Manual Organizer closure:** Organizer may close early; cancellation does not undo that closure. Only Organizer may reopen it.

A Cancelled event blocks registration regardless of these causes. Registration cancellation cutoff (configured or event start by default) is distinct from registration closing; cancellation is never allowed after an accepted check-in, even before the cutoff or by staff. Capacity can reopen only when a pre-check-in cancellation frees a slot and no other closure cause applies. Waitlist is post-MVP. The interface must show the applicable cause rather than treating event state, registration capacity, and live occupancy as synonyms.

## Decision points before implementation

MVP does not include terminal reopening. Any later policy for it or for unrestricted Live policy changes requires a new decision. Forecast cadence/minimum-data and production acceptance criteria belong to the forecasting phase. See [OPEN_PRODUCT_DECISIONS.md](OPEN_PRODUCT_DECISIONS.md).
