# Requirements Baseline

**Status:** Planned, not implemented  
**Source:** [Product Requirements Document](../PRD.md)

This document converts product intent into stable identifiers for architecture, API, data, security, and test traceability. **Must** indicates MVP acceptance scope. **Should** indicates an important target that may be deferred only with an explicit decision. TBD values are not permission to invent behavior during implementation.

## Functional requirements

### Event management

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-EVT-001 | An Organizer must be able to create an owned Draft; an assigned Event Admin may edit that event's Draft only within the approved field allowlist and event-scoped permission. Delegated event creation/ownership transfer is not assumed. | Must |
| FR-EVT-002 | The system must block publication until required event configuration is valid, including at least one configured Gate associated with the Event, and explain missing/invalid fields. Published → Live independently rechecks the configured-Gate condition. | Must |
| FR-EVT-003 | Organizer creates/owns the event and alone controls lifecycle transitions, including Live → Cancelled. A Cancelled event blocks new registration and check-in; existing registration rows remain unchanged and auditable. Event Admin cannot cancel or transfer ownership. | Must |
| FR-EVT-004 | The event must support one MVP registration-capacity value, time zone, schedule, registration policy, and at least one configured gate before both publication and live operation. A Gate is configured for this guard by an authorized persistent Event–Gate association; staff assignment, scanner hardware, connectivity, health, and operational readiness are not prerequisites. Live occupancy is a distinct count of people INSIDE, not a second gate-capacity limit. | Must |
| FR-EVT-005 | Organizer may edit Published event details; material changes must be visible and audited. In Slice 3, an assigned Event Admin may edit only name, description, public venue/location, image/banner, and public category/tags on Draft/Published events, plus separately authorized gate configuration; this does not grant capacity, visibility, schedule, registration/attendance policy, ownership, or lifecycle edits. Once Live, registration/attendance policy changes are restricted and cannot silently rewrite the active operational contract; no unrestricted Live detail edit is granted. Event-cancellation participant notification is post-MVP. | Should |

### Registration and credentials

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-REG-001 | Without a configured opening time, registration opens on publication; a future configured opening keeps it closed until then. Registration closes at a configured closing time or, if absent, event start, and always closes on transition to Live even if a later time was configured. It also closes when REGISTERED registrations reach the cap. Organizer may manually close early and alone reopen manual closure. A freed spot reopens only capacity-only closure while the event otherwise permits registration. | Must |
| FR-REG-002 | Active registration means status REGISTERED. At most one REGISTERED registration per user/event or, for verified guests, per verified email OR verified phone/event; CANCELLED rows do not block a new registration. | Must |
| FR-REG-003 | A participant must be able to view their registration status and active credential without accessing another participant's data. | Must |
| FR-REG-004 | MVP must support verified authenticated users and email/phone OTP-verified guests without requiring a guest account; verification establishes ownership and recovery. | Must |
| FR-REG-005 | No role may cancel a registration after its first accepted check-in. Before check-in, a participant may cancel before the event-defined cutoff (event start if absent), and Organizer/Event Admin may cancel regardless of that cutoff. Retain the CANCELLED row/history with cancelled_at/by, free its registration slot, invalidate its QR, and issue a new token on any new registration. Guest self-cancellation requires OTP. Attendance history is never erased; post-check-in discrepancies use check-out or reasoned correction, and certificate problems use issue/revoke. | Must |
| FR-QR-001 | Each active registration must have at most one active, unique, non-guessable QR credential. | Must |
| FR-QR-002 | The QR payload must contain only an opaque/random token and no plaintext sensitive personal data. | Must |
| FR-QR-003 | Credential reissue must revoke the previous credential and be audited. | Must |
| FR-QR-004 | Credential expiration and revocation behavior must be enforced server-side. | Must |

### Event discovery

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-DISC-001 | PUBLIC Published events appear in the catalog with only event name, description, date, start/end time, public venue/location, organizer-provided image/banner, registration availability, remaining/available registration indication, and public category/tags. Participant lists/contact, QR credentials, internal operations, live occupancy, alerts, admin data, and audit logs are excluded. PRIVATE events are omitted from public discovery; possession of an opaque, event-scoped, server-verifiable controlled link is sufficient to view the same allowlisted details only while PRIVATE and Published. At most one link is active per event; Organizer alone issues, revokes or reissues it, with immediate old-proof invalidation on replacement. There is no automatic time-based link expiry in MVP; explicit revocation/replacement or leaving PRIVATE Published ends access. A guessed event ID is not access; viewing does not require account login or guest OTP, while registration ownership still requires verification. Invalid, revoked, malformed and other unauthorized private-link attempts return the same privacy-safe unavailable result. | Must |

### Gates and attendance

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-GATE-001 | An authorized Organizer or assigned Event Admin must be able to configure gates and assign event-scoped staff within their permitted scope. A persistent Gate associated with its Event through authorized configuration is sufficient for the Publish/Live configured-gate guard; scanner hardware, staff assignment, connectivity, health, and operational readiness are separate later concerns. | Must |
| FR-GATE-002 | A scanner session must show its selected event, gate, operator, connectivity, and readiness state. | Must |
| FR-GATE-003 | Gate/Security may see only display name, registration status, relevant attendance status, event context, and scan result; never contact, OTP, credential, or unnecessary personal data. | Must |
| FR-SCAN-001 | A scan must validate credential, registration, event, gate/operator context, and the event's attendance/re-entry policy. | Must |
| FR-SCAN-002 | The result must clearly distinguish accept, duplicate/policy rejection, invalid/revoked/wrong-event credential, authorization failure, and technical failure. | Must |
| FR-SCAN-003 | Every unique logical scan attempt, identified by a client-generated scan_id, must record time, event, gate, operator, credential reference, decision, reason, and correlation data; a transport retry is not a new logical attempt. | Must |
| FR-SCAN-004 | A retry with the same scan_id must return the original result and never create a second attendance transition; failed/new duplicate scans never change occupancy. | Must |
| FR-SCAN-005 | A failed/technical scan holds or rejects entry and cannot authorize entry; manual override and offline validation are post-MVP. | Must |
| FR-ATT-001 | Only an accepted attendance state transition may change derived occupancy. | Must |
| FR-ATT-002 | Every event may enable check-out. With it, valid attendance moves NOT_ARRIVED → INSIDE → LEFT → INSIDE; without it, NOT_ARRIVED → INSIDE and no outside/re-entry claim is made. Re-entry requires a valid check-out. | Must |
| FR-ATT-003 | Authorized Organizer/Event Admin corrections require actor and mandatory reason and append an auditable attendance transition/event; history is not overwritten and occupancy is not an unrestricted editable counter. | Must |

### Command center, alerts, and analytics

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-LIVE-001 | Authorized users must see live occupancy as people currently INSIDE, distinct from the count of REGISTERED registrations; the view compares occupancy with the single event capacity and exposes gate activity/freshness. | Must |
| FR-LIVE-002 | Live clients must recover from connection interruption by reconciling with authoritative current state. | Must |
| FR-LIVE-003 | The command center must visibly identify stale, partial, or unavailable data. | Must |
| FR-ALERT-001 | Exactly three MVP in-product alert categories exist: live-occupancy capacity threshold, gate/scanner operational failure, and data/forecast staleness. Capacity WARNING is near 90% of event capacity by default; CRITICAL is at 100% live occupancy. REGISTERED-registration fullness is not an alert. Each alert carries condition, severity, timestamp, evidence, applicable acknowledged_by; ACTIVE → ACKNOWLEDGED → RESOLVED; persistent conditions do not duplicate active alerts. | Must |
| FR-ALERT-002 | Organizer/Event Admin receive the full event alert stream and may acknowledge/resolve alerts. Gate/Security sees only assigned-gate scanner/operational alerts and cannot acknowledge/resolve; Volunteers receive no general alert stream. | Must |
| FR-ANL-001 | Authorized users must be able to inspect completed-event attendance and gate patterns. | Must |
| FR-ANL-002 | Historical comparisons must disclose incompatible/missing data and avoid false equivalence. | Should |

### Forecasting

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-FCST-001 | The system must provide 30- and 60-minute occupancy forecasts when sufficient data exists. | Must |
| FR-FCST-002 | Each forecast must include generation time, input window, horizon, model/method version, and uncertainty/confidence representation. | Must |
| FR-FCST-003 | Insufficient, stale, or invalid input data must produce an explicit unavailable/degraded result rather than fabricated values. | Must |
| FR-FCST-004 | Forecast evaluation must use time-ordered validation and compare against a naive baseline. | Must |
| FR-FCST-005 | Forecasts must remain advisory and must not autonomously change gate or safety policy. | Must |

### Roles, certificates, and audit

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-RBAC-001 | The API must enforce deny-by-default, event-scoped authorization for Organizer, Event Admin, Gate/Security Staff, Volunteer, and Participant roles. | Must |
| FR-RBAC-002 | Volunteers must have only the bounded own-assignment permissions in FR-VOL-001 and must never inherit admin or gate access. | Must |
| FR-VOL-001 | Organizer/Event Admin create bounded assignments with title, instructions, applicable time/location, and status. Volunteers see/update only their own assignment through ASSIGNED → IN_PROGRESS → COMPLETED, without gate, participant-management, correction, event-configuration, admin, or general-alert access. | Must |
| FR-CERT-001 | First accepted check-in makes a non-CANCELLED registration ELIGIBLE; registration alone, check-out, and duration do not. Eligibility does not automatically generate/send a certificate. Participants may access only their own issued artifact. | Must |
| FR-CERT-002 | Certificate eligibility, issue, reissue, and revocation actions and source evidence must be auditable; lifecycle is NOT_ELIGIBLE → ELIGIBLE → ISSUED → REVOKED. | Must |
| FR-CERT-003 | Organizer/Event Admin must be able to select a built-in certificate template/font style and preview before generation; custom templates/designers and CSV import are post-MVP. | Must |
| FR-CERT-004 | Organizer/Event Admin explicitly issue for one ELIGIBLE participant or a database-derived eligible batch. Issuance moves ELIGIBLE → ISSUED and generates a PDF with unique certificate ID as part of that action; bulk issuance uses a traceable Certificate Batch/Job. | Must |
| FR-CERT-005 | A certificate batch/job must expose event, template, eligible/generated counts, delivery counts, timestamps, and overall progress/status. Individual certificate records remain auditable. | Must |
| FR-CERT-006 | MVP must queue asynchronous PDF-attachment email delivery from a platform sender, with optional Organizer Reply-To, and show PENDING, SENT, or FAILED independently of certificate ISSUED/REVOKED state. | Must |
| FR-CERT-007 | Failed delivery can be retried; the same certificate/delivery operation must be idempotent and must not send duplicate emails. An ISSUED certificate may have FAILED delivery. | Must |
| FR-CERT-008 | Organizer/Event Admin may explicitly issue/revoke certificates and retry failed certificate email delivery. Gate/Security, Volunteers, and Participants may not retry. Registration cancellation is forbidden after accepted check-in, so it cannot invalidate an issued certificate; Participants may view/download only their own issued artifact. | Must |
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

## Later-phase implementation and scope decisions

- Terminal event reopening and registration amendment require a future product decision if proposed; neither is an MVP action. Live cancellation, publication opening, Live registration closure, and post-check-in cancellation prohibition are locked.
- Detailed implementation guards for Live policy edits; event-cancellation participant notification is post-MVP.
- Detailed operational failure/staleness detection; alert action authority is locked and external channels are post-MVP.
- Forecast update cadence/minimum data rule and Phase 8 acceptance threshold; horizons are fixed at 30/60 minutes
- Certificate provider/queue choices; duration-based eligibility is post-MVP
- Manual override/offline validation are post-MVP
- Data retention, deletion, export, and audit retention periods
- Target event size, scan throughput, dashboard concurrency, RPO, and RTO

These later decisions do not block Phase 1 MVP product approval. A future scope change must update the PRD, this file, and affected downstream plans together.
