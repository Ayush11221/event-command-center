# API Plan

**Status:** Phase 0 contract direction; Slice 2 identity/staff endpoints exist, while the approved Slice 3 signatures in the [Phase 2 API contract](API_CONTRACT.md) are not implemented. That contract supersedes technical TBDs where more specific.
**Inputs:** [PRD](../PRD.md), [requirements](../requirements/REQUIREMENTS.md), and [architecture](../architecture/ARCHITECTURE.md)

## API goals

- Provide stable, event-scoped contracts for all clients.
- Enforce authentication, authorization, validation, and idempotency on the server.
- Keep QR and participant data minimal.
- Separate authoritative state changes from live notifications and forecasting.
- Make failures actionable and correlation-friendly.

## Style and versioning

The planned application API is JSON over HTTPS under a versioned prefix such as `/api/v1`. Resource names, exact paths, and payloads are provisional until Phase 1 journeys and Phase 3 backend conventions are approved.

- Breaking contract changes require a versioning/migration plan.
- Additive fields should be tolerated by clients.
- Timestamps use ISO 8601 UTC; event responses also expose the IANA time zone needed for presentation.
- Identifiers are opaque strings, not client-interpreted database keys.
- Pagination uses a stable cursor for potentially large/time-ordered collections.
- List endpoints define filtering, ordering, page limits, and authorization scope explicitly.
- OpenAPI will become the machine-readable contract when implementation begins.

## Authentication and authorization

Authentication mechanism is TBD in Phase 4. Regardless of mechanism:

- Every protected request resolves an authenticated staff/account session or an OTP-verified guest ownership context, as applicable; guests need no permanent account.
- The API checks event-scoped permission for the requested action and resource.
- Client-side route guards are convenience only, never authorization.
- Participant self-service endpoints must enforce ownership.
- Scanner requests bind operator, event, and gate context.
- Unauthorized responses reveal no unnecessary resource existence or personal data.

The role/permission matrix must be approved before protected endpoints are implemented.

## Planned resource groups

The paths below express boundaries, not final endpoint signatures.

| Resource group | Representative responsibilities | Requirement links |
| --- | --- | --- |
| `/events` | Final Slice 3 signatures in [API_CONTRACT.md](API_CONTRACT.md): server-scoped owned/assigned list and management detail with state, schedule/time zone, configuration, gates, readiness, availability reasons, permitted actions and revision; Organizer create/own/lifecycle including Live cancellation; assigned Admin Draft/Published edit only name, description, public venue/location, image/banner, public category/tags; no Admin capacity/visibility/schedule/policy/ownership/lifecycle edits; Publish and Live each check a configured Gate. Owner-only PRIVATE-link issue/revoke/reissue commands are separate from ordinary event PATCH. | FR-EVT-* |
| `/discovery/events`, `/discovery/private` | PUBLIC Published and Live catalog/detail exposes only the approved allowlist plus event_state; PRIVATE Published detail requires a valid opaque event-scoped bearer link via `PrivateLink` header, not a guessed event ID or account/guest OTP. At most one active link per event; no automatic time-based MVP expiry. Only Organizer may issue/revoke/reissue it; invalid/unauthorized PRIVATE reads safely conceal existence. No participant/credential/internal/live occupancy/alert/admin/audit public fields. | FR-DISC-001 |
| `/events/{eventId}/roles` | Event-scoped staff and volunteer assignments | FR-RBAC-*, FR-GATE-001 |
| `/events/{eventId}/volunteer-tasks`, task detail and distinct assignee/status/cancel actions | Final Slice 11 [implementation contract](API_CONTRACT.md#slice-11--implementation-contract-finalized-implemented) and SLICE_11_OPENAPI.json define current-role binding, volunteer-only progress and staff-only terminal cancellation with reason. Staff edits ASSIGNED/IN_PROGRESS, reassigns ASSIGNED only; no terminal reset/revival. Implemented. Existing `/assignments` continues to grant event roles only. | FR-VOL-001 |
| `/events/{eventId}/gates` | Slice 3 event-scoped Gate create by Organizer or assigned Admin, with Gate references/readiness embedded in scoped management detail; authorized persistent Event–Gate association alone satisfies Publish/Live configuration guard. No separate Slice 3 Gate field-update endpoint is justified by the configured-gate predicate; operational/scanner health and staff assignment are separate. | FR-GATE-* |
| `/events/{eventId}/registrations` | Verified account/guest-OTP REGISTERED creation; publication-default or future opening, configured/default event-start close, Live closure regardless of later time, REGISTERED cap, manual Organizer closure/reopen; own cutoff and no cancellation by any role after accepted check-in; new row after CANCELLED | FR-REG-* |
| `/registrations/{id}/credential` | Own-record view/approved issue or replacement; no direct staff credential issue/revoke grant | FR-QR-* |
| `/scan-decisions` | Opaque-token and current-registration validation; unique scan_id, original-result retry, accepted/rejected/failed decision and attendance transition | FR-SCAN-*, FR-ATT-* |
| `/events/{eventId}/attendance` | Authorized snapshot, check-in/check-out/re-entry history, append-only reasoned correction and reconciliation | FR-ATT-*, FR-LIVE-* |
| `/events/{eventId}/operations` | Command-center snapshot: live INSIDE occupancy, separate REGISTERED count, single event capacity, freshness and gate activity | FR-LIVE-* |
| `/events/{eventId}/alerts` | Three role-scoped categories (INSIDE occupancy threshold, gate/scanner failure, data/forecast staleness), deduplicated lifecycle and authorized acknowledge/resolve | FR-ALERT-001–002 |
| `/events/{eventId}/forecasts/current`, `/events/{eventId}/forecasts` | Final Slice 8 current-generation read and bounded persisted-history read, including 30/60-minute points, uncertainty, evaluation and freshness, are defined in [API_CONTRACT.md](API_CONTRACT.md) and [SLICE_8_OPENAPI.json](SLICE_8_OPENAPI.json). | FR-FCST-* |
| `/events/{eventId}/results` | Slice 11 completed-only factual results contract in API_CONTRACT.md; coherent authoritative counts and limitations, no cross-event comparisons. Supersedes the representative `/analytics` path for this slice; implemented. | FR-ANL-001 |
| Certificate eligibility/name/single issue/artifacts (Slice 9 finalized) | Final Slice 9 owner name/status/artifact and staff catalogue/preview/single issue/recovery/revoke paths and closed schemas are defined in [API_CONTRACT.md](API_CONTRACT.md) and [SLICE_9_OPENAPI.json](SLICE_9_OPENAPI.json). | FR-CERT-001–002, FR-CERT-004, FR-CERT-008 |
| `/events/{eventId}/certificate-batches`, `/{batchId}`, `/{batchId}/items` | Slice 10 explicit selected-ID batch acceptance, durable independent issuance and paginated progress; finalized closed schemas in API_CONTRACT.md / SLICE_10_OPENAPI.json | FR-CERT-003–005 |
| Staff certificate `/delivery`, `/delivery/retry`; owner certificate `/delivery` | Slice 10 platform SMTP, independent durable attempts, FAILED-only authorized retry, UNKNOWN safe hold; finalized contract has no Reply-To | FR-CERT-006–008 |
| `/events/{eventId}/audit-events` | Slice 11 restricted Organizer/Admin search, bounded cursor/filter contract and minimized evidence in API_CONTRACT.md; required audit-of-read fails closed. No unrestricted export; implemented. | FR-AUD-* |

No generic endpoint should expose all events or participants merely for implementation convenience.

## Scan-decision contract

This is the highest-risk contract and needs a dedicated specification before implementation.

### Request concepts

- Opaque credential value
- Event and gate context
- Client-generated unique scan_id identifying one logical scan attempt (idempotency identity)
- Scanner session/device metadata limited to a justified operational purpose
- Requested direction (`check-in` or `check-out`) if not fixed by gate policy
- Client-observed scan time, while the server remains authoritative for decision time

### Response concepts

- Decision: accepted, rejected, or technical/deferred failure; failed/unknown cannot authorize entry
- Stable reason code plus safe operator-facing message
- Resulting attendance state when authorized to display it
- Event/gate context confirmation
- Server decision time and correlation identifier
- Whether the response was a same-scan_id idempotent replay

The response may expose only display name, registration status, relevant attendance status, event context, and scan result. Email, phone, OTP data, account credentials, and unnecessary PII are excluded. Assigned-gate history is separately scoped; exact reason-code catalog remains contract design.

### Correctness constraints

- The client-generated scan_id identifies one logical attempt within a documented scope/retention window. A transport retry of the same scan_id returns its original result and is not a new logical attempt; a new scan_id is a separate attempt.
- Same key plus conflicting payload is rejected.
- Concurrent attempts cannot both create incompatible attendance transitions.
- A timeout does not imply that the server rejected the credential; entry is held/rejected operationally until a valid decision. A retry with the same scan_id retrieves the authoritative original outcome.
- Technical failure is distinct from a policy/credential rejection and never changes occupancy. Manual override/offline validation are post-MVP.

## Registration, alert, and certificate contract distinctions

- Registration availability is separate from event state: it opens on publication unless a future opening is configured; configured/default event-start close, REGISTERED-cap closure, Organizer manual closure, and Live transition can each block registration. Live closure applies even with a later configured close. Slice 3 responses may report `NOT_OPEN_YET`, `OPEN`, `SCHEDULED_CLOSE_REACHED`, and `MANUALLY_CLOSED` only from known event policy; applicable blockers may coexist. With no Registration records in Slice 3, do not fabricate count, remaining slots, capacity usage, or `CAPACITY_REACHED`, or offer a working registration action. Slice 4 adds capacity-based facts and enforcement. Only capacity-only closure lifts automatically when a pre-check-in cancellation frees a slot; only Organizer reopens manual closure. Organizer may cancel a Live event, blocking creation/check-in while preserving existing registration rows unchanged. Guest OTP establishes ownership; individual cancellation is allowed only before any accepted check-in, retains CANCELLED row, invalidates old QR, and re-registration creates a new row/token. No cancellation path can create CANCELLED + INSIDE.
- One event capacity is a registration cap, not a gate-entry rejection rule. Live occupancy is the count of people INSIDE, separately exposed from REGISTERED count. A full registration list is not an alert.
- Optional check-out governs NOT_ARRIVED → INSIDE → LEFT → INSIDE; without check-out, no outside/re-entry state is inferred. Authorized actor/reason-backed CORRECTION is an append-only attendance event, not an editable count.
- Alert reads are full event stream for Organizer/Admin, assigned-gate operational errors only for Gate/Security, and none for Volunteer. Exactly three categories: live INSIDE occupancy near-90% WARNING/100% CRITICAL relative to event capacity; gate/scanner failure; data/forecast staleness. Lifecycle is ACTIVE → ACKNOWLEDGED → RESOLVED with no duplicate active alert for a persistent condition. Organizer/Admin may acknowledge/resolve; Gate/Security may not. No generic rules engine is presumed.
- Certificate lifecycle remains separate from Slice 10 delivery NOT_REQUIRED or PENDING → SENDING → SENT/FAILED/UNKNOWN. Accepted check-in grants eligibility only; explicit single/batch issuance creates delivery intent. Organizer/Admin alone retry FAILED (three attempts maximum); UNKNOWN is held, never blindly resent. The finalized API_CONTRACT.md Slice 10 section and SLICE_10_OPENAPI.json supersede older illustrative delivery/selection rules and define exact routes, PostgreSQL/in-process recovery and platform SMTP boundaries.

## Real-time contract

Phase 2 selects Socket.IO/WebSocket with snapshot reconciliation; see [real-time architecture](../architecture/REALTIME_ARCHITECTURE.md). The live protocol must define:

- Authenticated event-scoped subscription
- Initial snapshot version/time
- Event type and schema version
- Event identifier, event scope, occurrence time, and correlation identifier
- Ordering/revision semantics or an explicit lack of ordering guarantee
- Reconnect, heartbeat, missed-update detection, and full reconciliation
- Backpressure/rate behavior
- Authorization changes and subscription termination

Likely event families include attendance transition accepted, occupancy projection changed, gate activity/health changed, alert state changed, forecast published/unavailable, and event configuration changed. Payloads should carry the minimum data needed to update the view.

## Forecast-service contract

The backend remains the client-facing authority. The FastAPI forecasting service has an internal, versioned contract that should include:

- Event or anonymized series identifier
- Ordered observations and feature metadata, not unnecessary PII
- Input window, fixed MVP target horizons of 30 and 60 minutes, and requested method/version
- Result status: available, insufficient data, stale input, invalid input, or internal failure
- Forecast points, uncertainty/confidence representation, generation time, and model/method version
- Evaluation/baseline metadata when available

Timeout, retry, and circuit/degraded behavior must keep the command center usable without a forecast.

## Errors

Use a consistent error envelope containing:

- Stable machine-readable code
- Safe human-readable message
- Correlation identifier
- Field-level validation details where appropriate
- Retryability and optional retry guidance where reliable

Do not return stack traces, database details, secrets, raw token contents, or excessive participant information. HTTP status mapping and the error-code catalog are TBD with the OpenAPI contract.

## Idempotency and concurrency

Idempotency is required for scan decisions and certificate email delivery, and should be considered for registration, cancellation, credential replacement, batch creation, certificate issue, and other retry-prone commands. The API specification must define key scope, retention, payload comparison, replay response, and concurrent-request behavior. Optimistic concurrency/version fields should protect high-risk administrative edits where appropriate.

## Rate and abuse controls

Rate limits must be based on threat and workload modelling, not copied defaults. Different policies may apply to authentication, registration, credential access, scanning, live connections, and audit/report exports. Rejection behavior must remain observable and must not block legitimate gate operations without a documented fallback.

## Contract lifecycle and verification

- Review OpenAPI changes with the consuming client and requirement IDs.
- Generate or validate types where it reduces drift, without making generated output the only readable contract.
- Run schema/contract tests for backend, frontend, and forecasting boundaries.
- Include authorization and negative cases for every protected operation.
- Never document a route as available until implementation and tests exist.

## TBD decisions

- Authentication/session mechanism and CSRF implications
- Final resource paths and action-specific contracts for **later** slices; Slice 3 event/discovery/gate/PRIVATE-link signatures are finalized in [API_CONTRACT.md](API_CONTRACT.md). Publication-default opening, Live registration closure, alert action authority, and least-privilege audit/credential grants are locked.
- Pagination and idempotency retention windows for later slices; Slice 3 uses an opaque cursor (20 default/100 maximum) and protected 24-hour PRIVATE issuance replay, which is not link expiry.
- Scan reason-code catalog (gate identity allowlist is locked; contact data excluded)
- Live revision/reconnect implementation details under the Phase 2 Socket.IO/WebSocket direction
- Slice 8 request cadence/minimum data rule and bounded synchronous invocation are finalized in [API_CONTRACT.md](API_CONTRACT.md); horizons remain exactly 30/60 minutes. Production acceptance thresholds remain deferred.
- OTP provider implementation, detailed gate/scanner staleness detection; Slice 10 certificate delivery/recovery/idempotency is finalized in API_CONTRACT.md. Slice 3 PRIVATE-link proof, Organizer-only issue/revoke/reissue, no automatic time-based expiry and exact event/discovery routes are finalized in [API_CONTRACT.md](API_CONTRACT.md); they are not implemented yet.
- Export formats, limits, and data-redaction rules
- API compatibility/deprecation policy
