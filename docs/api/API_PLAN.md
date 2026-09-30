# API Plan

**Status:** Contract direction only; no endpoints are implemented  
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
| `/events` | Organizer create/own and control lifecycle including Live cancellation; assigned Admin edit only, no event cancellation/ownership transfer; Published detail edits allowed, Live registration/attendance policy edits restricted; one REGISTERED cap, schedule and policy | FR-EVT-* |
| Published event discovery/read (path TBD) | PUBLIC catalog exposes only name, description, date, start/end time, public venue/location, organizer-provided image/banner, registration availability, remaining/available indication, category/tags; PRIVATE controlled-link/invitation access without discovery leakage; no participant/credential/internal/live occupancy/alert/admin/audit public fields | FR-DISC-001 |
| `/events/{eventId}/roles` | Event-scoped staff and volunteer assignments | FR-RBAC-*, FR-GATE-001 |
| Volunteer assignment/task status (path TBD) | Organizer/Admin titled assignment, instructions, applicable time/location; own ASSIGNED → IN_PROGRESS → COMPLETED updates only | FR-VOL-001 |
| `/events/{eventId}/gates` | Gate configuration and operational status | FR-GATE-* |
| `/events/{eventId}/registrations` | Verified account/guest-OTP REGISTERED creation; publication-default or future opening, configured/default event-start close, Live closure regardless of later time, REGISTERED cap, manual Organizer closure/reopen; own cutoff and no cancellation by any role after accepted check-in; new row after CANCELLED | FR-REG-* |
| `/registrations/{id}/credential` | Own-record view/approved issue or replacement; no direct staff credential issue/revoke grant | FR-QR-* |
| `/scan-decisions` | Opaque-token and current-registration validation; unique scan_id, original-result retry, accepted/rejected/failed decision and attendance transition | FR-SCAN-*, FR-ATT-* |
| `/events/{eventId}/attendance` | Authorized snapshot, check-in/check-out/re-entry history, append-only reasoned correction and reconciliation | FR-ATT-*, FR-LIVE-* |
| `/events/{eventId}/operations` | Command-center snapshot: live INSIDE occupancy, separate REGISTERED count, single event capacity, freshness and gate activity | FR-LIVE-* |
| `/events/{eventId}/alerts` | Three role-scoped categories (INSIDE occupancy threshold, gate/scanner failure, data/forecast staleness), deduplicated lifecycle and authorized acknowledge/resolve | FR-ALERT-001–002 |
| `/events/{eventId}/forecasts` | Current/history of versioned forecast results and availability | FR-FCST-* |
| `/events/{eventId}/analytics` | Completed-event summaries and valid comparisons | FR-ANL-* |
| Certificate eligibility/artifacts (paths TBD) | First accepted check-in grants ELIGIBLE only; explicit Organizer/Admin single issue and revoke; participant own ISSUED PDF/status | FR-CERT-001–002, FR-CERT-004, FR-CERT-008 |
| Certificate templates/preview/batches (paths TBD) | Built-in template/font preview; explicit bulk issue from eligible database records; batch generation/delivery progress | FR-CERT-003–005 |
| Certificate deliveries (paths TBD) | Platform-sender queue, independent per-certificate PENDING/SENT/FAILED status, Organizer/Admin-only failed-send retry and idempotent operation | FR-CERT-006–007 |
| `/events/{eventId}/audit-events` | Restricted event-scoped Organizer/Admin audit search; no unrestricted export permission | FR-AUD-* |

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

- Registration availability is separate from event state: it opens on publication unless a future opening is configured; configured/default event-start close, REGISTERED-cap closure, Organizer manual closure, and Live transition can each block registration. Live closure applies even with a later configured close. Only capacity-only closure lifts automatically when a pre-check-in cancellation frees a slot; only Organizer reopens manual closure. Organizer may cancel a Live event, blocking creation/check-in while preserving existing registration rows unchanged. Guest OTP establishes ownership; individual cancellation is allowed only before any accepted check-in, retains CANCELLED row, invalidates old QR, and re-registration creates a new row/token. No cancellation path can create CANCELLED + INSIDE.
- One event capacity is a registration cap, not a gate-entry rejection rule. Live occupancy is the count of people INSIDE, separately exposed from REGISTERED count. A full registration list is not an alert.
- Optional check-out governs NOT_ARRIVED → INSIDE → LEFT → INSIDE; without check-out, no outside/re-entry state is inferred. Authorized actor/reason-backed CORRECTION is an append-only attendance event, not an editable count.
- Alert reads are full event stream for Organizer/Admin, assigned-gate operational errors only for Gate/Security, and none for Volunteer. Exactly three categories: live INSIDE occupancy near-90% WARNING/100% CRITICAL relative to event capacity; gate/scanner failure; data/forecast staleness. Lifecycle is ACTIVE → ACKNOWLEDGED → RESOLVED with no duplicate active alert for a persistent condition. Organizer/Admin may acknowledge/resolve; Gate/Security may not. No generic rules engine is presumed.
- Certificate lifecycle NOT_ELIGIBLE → ELIGIBLE → ISSUED → REVOKED is separate from email PENDING → SENT/FAILED → RETRY. Accepted check-in grants ELIGIBLE but does not generate/send. Explicit Organizer/Admin single or bulk issue generates unique-ID PDF and moves to ISSUED; a batch tracks event/template/eligible/generated/delivery counts/progress. Post-check-in registration cancellation is forbidden; explicit Organizer/Admin certificate revocation remains. Organizer/Admin alone retry FAILED delivery; idempotency prevents duplicate sending. Exact routes, queue, provider, and payloads remain deferred.

## Real-time contract

WebSocket versus Server-Sent Events is TBD. The live protocol must define:

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
- Final resource paths and action-specific contracts; publication-default opening, Live registration closure, alert action authority, and least-privilege audit/credential grants are locked
- Pagination and idempotency retention windows
- Scan reason-code catalog (gate identity allowlist is locked; contact data excluded)
- WebSocket versus SSE and live revision protocol
- Forecast request cadence/minimum data rule and synchronous versus asynchronous invocation; horizons fixed at 30/60 minutes
- OTP verification mechanism, controlled PRIVATE link semantics, detailed gate/staleness detection, and certificate queue/provider/delivery idempotency retention
- Export formats, limits, and data-redaction rules
- API compatibility/deprecation policy
