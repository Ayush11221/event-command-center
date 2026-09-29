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

- Every protected request resolves an authenticated account/session.
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
| `/events` | Create/update draft, validate/publish, lifecycle, capacity, schedule, policy | FR-EVT-* |
| `/events/{eventId}/roles` | Event-scoped staff and volunteer assignments | FR-RBAC-*, FR-GATE-001 |
| `/events/{eventId}/gates` | Gate configuration and operational status | FR-GATE-* |
| `/events/{eventId}/registrations` | Register, inspect status, cancel if policy permits | FR-REG-* |
| `/registrations/{id}/credential` | View, issue, revoke, or replace owned/authorized credential | FR-QR-* |
| `/scan-decisions` | Idempotent credential validation and attendance decision | FR-SCAN-*, FR-ATT-* |
| `/events/{eventId}/attendance` | Authorized snapshot, transition history, reconciliation/correction if approved | FR-ATT-*, FR-LIVE-* |
| `/events/{eventId}/operations` | Command-center snapshot, freshness, gate activity, capacity | FR-LIVE-* |
| `/events/{eventId}/alerts` | View and acknowledge defined operational alerts | FR-ALERT-001 |
| `/events/{eventId}/forecasts` | Current/history of versioned forecast results and availability | FR-FCST-* |
| `/events/{eventId}/analytics` | Completed-event summaries and valid comparisons | FR-ANL-* |
| `/certificates` | Participant access plus authorized issue/revoke/status behavior | FR-CERT-* |
| `/events/{eventId}/audit-events` | Restricted audit search/export behavior | FR-AUD-* |

No generic endpoint should expose all events or participants merely for implementation convenience.

## Scan-decision contract

This is the highest-risk contract and needs a dedicated specification before implementation.

### Request concepts

- Opaque credential value
- Event and gate context
- Client-generated idempotency key
- Scanner session/device metadata limited to a justified operational purpose
- Requested direction (`check-in` or `check-out`) if not fixed by gate policy
- Client-observed scan time, while the server remains authoritative for decision time

### Response concepts

- Decision: accepted, rejected, or technical/deferred failure
- Stable reason code plus safe operator-facing message
- Resulting attendance state when authorized to display it
- Event/gate context confirmation
- Server decision time and correlation identifier
- Whether the response was an idempotent replay

The response must not expose participant details beyond the minimum gate workflow need. Exact reason codes and whether the name/photo is ever shown are TBD through security and UX review.

### Correctness constraints

- The idempotency key identifies one logical request within a documented scope/retention window.
- Same key plus conflicting payload is rejected.
- Concurrent attempts cannot both create incompatible attendance transitions.
- A timeout does not imply rejection; a retry with the same key retrieves the authoritative outcome.
- Technical failure is distinct from a policy/credential rejection.

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
- Input window, target horizon, and requested method/version
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

Idempotency is required for scan decisions and should be considered for registration, credential replacement, certificate issue, and other retry-prone commands. The API specification must define key scope, retention, payload comparison, replay response, and concurrent-request behavior. Optimistic concurrency/version fields should protect high-risk administrative edits where appropriate.

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
- Final resource paths, event lifecycle commands, and role matrix
- Pagination and idempotency retention windows
- Scan reason-code catalog and minimal identity display
- WebSocket versus SSE and live revision protocol
- Forecast request cadence and synchronous versus asynchronous invocation
- Export formats, limits, and data-redaction rules
- API compatibility/deprecation policy

