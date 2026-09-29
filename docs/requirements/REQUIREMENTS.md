# Requirements Baseline

**Status:** Planned, not implemented  
**Source:** [Product Requirements Document](../PRD.md)

This document converts product intent into stable identifiers for architecture, API, data, security, and test traceability. **Must** indicates MVP acceptance scope. **Should** indicates an important target that may be deferred only with an explicit decision. TBD values are not permission to invent behavior during implementation.

## Functional requirements

### Event management

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-EVT-001 | An authorized organizer or event admin must be able to create and edit a draft event. | Must |
| FR-EVT-002 | The system must block publication until required event configuration is valid and explain missing/invalid fields. | Must |
| FR-EVT-003 | Event lifecycle transitions must be explicit, authorized, validated, and audited. Exact state-transition rules are TBD in Phase 1. | Must |
| FR-EVT-004 | The event must support a capacity, time zone, schedule, registration policy, and at least one gate before live operation. | Must |
| FR-EVT-005 | Material post-publication changes must be visible and audited; the exact participant-notification policy is TBD. | Should |

### Registration and credentials

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-REG-001 | A participant must be able to register for a published event when registration policy allows it. | Must |
| FR-REG-002 | The system must prevent unintended duplicate active registrations according to a documented identity-matching rule, which is TBD. | Must |
| FR-REG-003 | A participant must be able to view their registration status and active credential without accessing another participant's data. | Must |
| FR-QR-001 | Each active registration must have at most one active, unique, non-guessable QR credential. | Must |
| FR-QR-002 | The QR payload must contain an opaque reference or signed token and must not contain plaintext sensitive personal data. | Must |
| FR-QR-003 | Credential reissue must revoke the previous credential and be audited. | Must |
| FR-QR-004 | Credential expiration and revocation behavior must be enforced server-side. | Must |

### Gates and attendance

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-GATE-001 | An authorized admin must be able to configure gates and assign event-scoped staff. | Must |
| FR-GATE-002 | A scanner session must show its selected event, gate, operator, connectivity, and readiness state. | Must |
| FR-SCAN-001 | A scan must validate credential, registration, event, gate/operator context, and the event's attendance/re-entry policy. | Must |
| FR-SCAN-002 | The result must clearly distinguish accept, duplicate/policy rejection, invalid/revoked/wrong-event credential, authorization failure, and technical failure. | Must |
| FR-SCAN-003 | Every scan attempt must record time, event, gate, operator, credential reference, decision, reason, and correlation/idempotency key. | Must |
| FR-SCAN-004 | Retrying the same logical scan must not create a second attendance transition. | Must |
| FR-ATT-001 | Only an accepted attendance state transition may change derived occupancy. | Must |
| FR-ATT-002 | The system must support check-in and, where configured, check-out. Re-entry semantics are TBD per event policy. | Must |
| FR-ATT-003 | Manual corrections, if allowed, must require an authorized role, a reason, and audit evidence. Exact policy is TBD. | Should |

### Command center, alerts, and analytics

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-LIVE-001 | Authorized users must be able to see live attendance, current occupancy, capacity utilization, gate activity, and source freshness. | Must |
| FR-LIVE-002 | Live clients must recover from connection interruption by reconciling with authoritative current state. | Must |
| FR-LIVE-003 | The command center must visibly identify stale, partial, or unavailable data. | Must |
| FR-ALERT-001 | The MVP must support bounded in-product operational alerts with defined condition, severity, time, status, and evidence. Thresholds are TBD. | Must |
| FR-ANL-001 | Authorized users must be able to inspect completed-event attendance and gate patterns. | Must |
| FR-ANL-002 | Historical comparisons must disclose incompatible/missing data and avoid false equivalence. | Should |

### Forecasting

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-FCST-001 | The system must provide a near-term occupancy or arrival forecast when sufficient data exists. | Must |
| FR-FCST-002 | Each forecast must include generation time, input window, horizon, model/method version, and uncertainty/confidence representation. | Must |
| FR-FCST-003 | Insufficient, stale, or invalid input data must produce an explicit unavailable/degraded result rather than fabricated values. | Must |
| FR-FCST-004 | Forecast evaluation must use time-ordered validation and compare against a naive baseline. | Must |
| FR-FCST-005 | Forecasts must remain advisory and must not autonomously change gate or safety policy. | Must |

### Roles, certificates, and audit

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-RBAC-001 | The API must enforce deny-by-default, event-scoped authorization for Organizer, Event Admin, Gate/Security Staff, Volunteer, and Participant roles. | Must |
| FR-RBAC-002 | Volunteer permissions must be explicitly defined before implementation; volunteers must not inherit admin access. | Must |
| FR-CERT-001 | An event may define a certificate eligibility rule; eligible participants can access their certificate after the event policy permits. | Must |
| FR-CERT-002 | Eligibility calculation, issue, reissue, and revocation actions must be auditable. | Must |
| FR-AUD-001 | Security- and operations-relevant actions must create append-oriented audit events with actor, action, target, time, outcome, and correlation data. | Must |
| FR-AUD-002 | Audit access must be restricted, queryable, and itself auditable. | Must |

## Non-functional requirements

| ID | Requirement | Verification direction |
| --- | --- | --- |
| NFR-PERF-001 | Online QR decisions must complete within 2 seconds at p95 under the agreed workload. Workload volume is TBD. | Load test with percentile reporting |
| NFR-PERF-002 | Accepted attendance changes must reach connected command-center clients within 5 seconds at p95 under the agreed workload. | End-to-end timing test |
| NFR-REL-001 | Accepted attendance transitions must remain durable if live delivery, analytics, or forecasting is unavailable. | Failure-injection integration test |
| NFR-REL-002 | Retry and concurrency behavior must preserve one logical attendance transition per idempotency key/policy decision. | Concurrent integration test |
| NFR-SEC-001 | Authentication, authorization, input validation, rate limiting/abuse controls, secret handling, and dependency controls must satisfy [SECURITY_PLAN.md](../security/SECURITY_PLAN.md). | Security test and review |
| NFR-SCALE-001 | The architecture must support horizontal API/live-delivery scaling without changing public product contracts. | Architecture review and load test |
| NFR-OBS-001 | Critical journeys must carry a correlation identifier through structured logs, metrics, traces, and audit events where applicable. | Observability integration test |
| NFR-OBS-002 | User-facing live data must expose freshness/degraded status. | UI/API acceptance test |
| NFR-A11Y-001 | Implemented core journeys must target WCAG 2.2 AA and pass the agreed automated plus manual checks. | Accessibility audit |
| NFR-MAINT-001 | Domain boundaries, versioned contracts, database migrations, and dependency rationale must be reviewable. | Code/documentation review |
| NFR-AUD-001 | Privileged changes and scan decisions must be reconstructable without relying on mutable application logs alone. | Audit reconciliation test |
| NFR-PRIV-001 | Personal data collection, exposure, retention, export, and deletion behavior must follow an approved data policy. Retention durations are TBD. | Privacy review and tests |

## Open requirement decisions

- Event lifecycle states and which changes are allowed after publication
- Registration identity matching and cancellation/waitlist policy
- Check-out requirement, re-entry policy, and occupancy correction workflow
- Offline/degraded scanning policy and acceptable consistency risk
- Volunteer permission matrix
- Alert thresholds, acknowledgement/escalation behavior, and external channels
- Forecast horizon, update cadence, accuracy metric, and minimum data threshold
- Certificate eligibility and verification format
- Data retention, deletion, export, and audit retention periods
- Target event size, scan throughput, dashboard concurrency, RPO, and RTO

These decisions belong in Phase 1 discovery or the relevant later technical phase and must update the PRD, this file, and affected downstream plans together.

