# Database Plan

**Status:** Conceptual plan; no schema or migration exists  
**Planned primary database:** PostgreSQL  
**Planned data-access layer:** Prisma, subject to concurrency, migration, and query validation

## Data principles

- Model event-scoped authorization and attendance transitions explicitly.
- Protect integrity with database constraints and transactions, not UI assumptions.
- Store timestamps in UTC and preserve the event's IANA time-zone identifier for display/policy.
- Keep QR payloads opaque and store credential secrets as hashes where verification design permits.
- Separate append-oriented scan/audit evidence from mutable projections.
- Minimize personal data and define retention before real participant data is used.

## Conceptual entities

Names are provisional and do not prescribe ORM model names.

| Entity | Purpose and key relationships |
| --- | --- |
| Account / verified guest identity | Authenticated account with verified email/phone, or OTP-verified guest contact/ownership without a permanent account; participant PII minimized and protected |
| Event | Organizer ownership and lifecycle including Live cancellation, PUBLIC/PRIVATE visibility and public-detail allowlist, controlled-link policy, schedule/time zone, one REGISTERED-registration cap, optional registration opening/closing times (publication-default opening and Live closure), manual closure state/cause, cancellation cutoff, optional check-out, venue summary; event cancellation retains registration rows unchanged |
| EventRoleAssignment | Links an account to an event-scoped role; unique per applicable account/event/role tuple |
| VolunteerTaskAssignment | Organizer/Admin-created bounded title, instructions, applicable assigned time/location, owning volunteer, and ASSIGNED → IN_PROGRESS → COMPLETED status |
| Gate | Belongs to an event and carries operational status/configuration |
| Registration | Links verified account or guest identity to event; REGISTERED/CANCELLED state, cancelled_at/by, registration-capacity claim, and retained history; new row on re-registration. Cancellation is forbidden after first accepted check-in, preventing CANCELLED + INSIDE. Event cancellation does not rewrite existing rows. |
| Credential | Belongs to one registration; stores opaque/random token verifier/identifier, status, issue/expiry/revocation metadata, and replacement lineage; old CANCELLED-registration token remains invalid |
| ScannerSession | Optional explicit record tying operator, event, gate, device/session metadata, and start/end times |
| ScanAttempt | Append-oriented record of each unique logical scan_id and original server validation decision, with event/gate/operator/time/correlation; transport retry reuses that result rather than creating a new logical attempt |
| AttendanceTransition | Append-only accepted check-in/check-out or authorized actor/reason-backed CORRECTION event linked to source scan/action |
| OccupancyProjection | Rebuildable count of people currently INSIDE (plus any authorized correction transition) with version/freshness; distinct from REGISTERED-registration count and not a separate capacity rule |
| OperationalAlert | Exactly three event condition categories: live INSIDE occupancy threshold (near-90% WARNING/100% CRITICAL against event cap), gate/scanner failure, data/forecast staleness; timestamp/evidence, ACTIVE → ACKNOWLEDGED → RESOLVED, acknowledged_by as applicable; persistent condition has no duplicate active record |
| ForecastRun | Input window, horizon, method/model version, status, evaluation metadata, and generation time |
| ForecastPoint | Time-indexed prediction and uncertainty values belonging to a run |
| CertificatePolicy | Versioned event-scoped first-accepted-check-in eligibility rule; duration is post-MVP |
| CertificateTemplate | Small built-in template/font-style catalog reference; no custom upload/designer in MVP |
| CertificateBatchJob | Event/template selection, eligible/generated/delivery counts, timestamps, overall progress/status for one bulk generation/send operation |
| Certificate | Registration/event, unique certificate ID when explicitly issued, NOT_ELIGIBLE/ELIGIBLE/ISSUED/REVOKED state, rule/version, PDF artifact reference/hash generated on single/bulk issue, optional batch linkage, issue/revocation metadata. Registration cancellation is forbidden after accepted check-in; certificate problems use explicit issue/revoke. |
| CertificateEmailDelivery | Recipient/certificate/batch delivery operation with independent PENDING/SENT/FAILED status, retry/attempt evidence and idempotency identity; ISSUED certificate may have FAILED email |
| AuditEvent | Append-oriented actor/action/target/outcome/correlation record with controlled detail |

Both account and OTP-verified guest ownership are required in MVP. The schema must represent them deliberately before Phase 4 rather than adding nullable relationships ad hoc. Exact OTP/provider, token hash, and encryption/query mechanics remain technical decisions.

## Integrity and concurrency rules

- One active credential per registration, enforced using a transaction plus a suitable unique/index strategy.
- Credential public identifiers/tokens must be globally unique and non-sequential.
- One logical scan result per unique client-generated scan_id; same-scan_id transport retries return the original result, while a new conflicting scan is a separate recorded rejection. Key scope/retention remains contract design.
- An attendance transition references one source scan/action and cannot be duplicated by concurrent requests.
- Event/gate/registration/credential relationships must be checked in the database transaction.
- One event capacity blocks new registration when REGISTERED count reaches it; pre-check-in cancellation releases a slot. Publication opens registration by default unless a future opening is configured. Configured/default event-start time, capacity, manual Organizer closure, and Live transition must remain distinguishable; Live closes registration even with a later configured time. Cancellation auto-reopens only capacity-only closure while the event otherwise permits registration; manual closure requires Organizer reopening. Registration creation/cancellation must be transaction-safe. No separate physical gate-capacity rejection rule exists in MVP.
- Registration cancellation must atomically reject any registration with a first accepted check-in, regardless of actor or current INSIDE/LEFT attendance state. Only valid check-out or authorized reasoned correction changes post-check-in occupancy; history stays append-only.
- Audit events and scan attempts are not casually updated or deleted through normal product APIs.
- Occupancy must be rebuildable by folding accepted check-in/check-out and authorized reasoned correction transitions. Rejected/failed/duplicate scans never enter the fold. With check-out disabled, INSIDE is not silently converted to LEFT.
- REGISTERED-registration uniqueness applies per user/event or verified guest email OR verified phone/event; CANCELLED rows remain and do not block a new REGISTERED row. The suggested normalized fields/partial-REGISTERED uniqueness are implementation directions for later review, not schema syntax here.
- Event cancellation must not cascade into rewriting or deleting existing registrations, attendance, or audit records; it blocks future registration/check-in through current event-state validation.
- Accepted check-in establishes ELIGIBLE but does not create a PDF or delivery job. Explicit Organizer/Admin single or bulk issue generates unique-ID PDFs and ISSUED records; only bulk issue requires a Certificate Batch/Job. Certificate issue and delivery are independent state changes; Organizer/Admin may retry FAILED email without reissuing, and explicit certificate revocation remains separate.
- Certificate IDs are unique; batch count/progress and per-certificate delivery status reconcile without equating ISSUED with SENT. A retry of the same delivery operation cannot create duplicate sends.

## Index planning

Indexes will be based on measured query plans. Expected access paths include:

- Event lifecycle and schedule queries
- Registration lookup by event and participant identity/normalized contact rule
- Credential validation by hashed/public identifier and status
- Scan attempts by event, gate, time, credential, result, and correlation/idempotency key
- Attendance transitions by event, registration, and time
- Current event-scoped role lookup by account
- REGISTERED registration by event and verified user/email/phone, including cancellation history and capacity claims
- Alerts by event/condition/active lifecycle; certificate batches, certificate IDs and delivery operations by event/batch/status/idempotency identity
- Forecast runs/points by event, generation time, and horizon
- Audit events by event, actor, target, action, correlation identifier, and time

Avoid indexing sensitive plaintext values solely for convenience; define normalized lookup and encryption/hash behavior deliberately.

## Transaction boundaries

The scan decision transaction should lock or otherwise serialize the relevant credential/registration attendance state, insert the scan attempt, insert at most one accepted transition, and persist reliable publication/audit intent. The exact isolation/locking approach requires a concurrency proof and tests.

Event publication, registration/cancellation-capacity changes, credential replacement, role assignment, reasoned attendance correction, alert deduplication/state changes, certificate issue/revocation, batch creation, and delivery enqueue/retry also require explicit transactional boundaries. Exact locking, queue, and provider mechanisms are deferred to implementation review.

## Event publication and derived data

If asynchronous consumers are introduced, use a transactional outbox or an equivalently justified mechanism. Consumers must deduplicate by immutable event ID. Occupancy summaries, live views, analytics, and model features are projections and must be rebuildable or reconcilable from authoritative facts.

## Migrations and seed data

- Every schema change must use a reviewed migration committed with the behavior it supports.
- Production/demo migrations must be forward-safe and backed up; destructive changes need an explicit data migration/rollback plan.
- Seed data must be synthetic and visibly non-production.
- Tests should create isolated data and never depend on a developer's persistent database.
- No Prisma models will be created until Phase 4 requirements and identity choices are resolved.

## Privacy, security, and retention

- Classify fields before implementation: public event data, account/security data, participant PII, operational data, audit evidence, and model/analytics data.
- Do not store QR images when they can be deterministically rendered from a protected credential representation.
- Do not copy participant PII into scan, audit, log, event-stream, or forecast records without a demonstrated need.
- Encrypt transport and use deployment-supported encryption at rest; consider field-level protection only after threat and query needs are known.
- Define retention and deletion/anonymization for registrations, scans, audits, forecasts, certificate PDFs/batches/email addresses/delivery evidence, and backups. All durations are TBD.
- Audit/data export access must be authorized and itself audited.

## Backup, recovery, and reconciliation

Backup technology, frequency, RPO, and RTO are TBD for the deployment target. Before demonstration with meaningful data, verify a restore, run attendance-to-occupancy reconciliation, and document how missing/duplicate projection events are repaired.

## Open decisions

- Account and guest verification/session representation and identity normalization details
- Terminal event reopening if proposed later; MVP publication opening, Live registration closure/cancellation, and post-check-in cancellation prohibition are locked
- Correction delta validation details; no physical gate-capacity rule in MVP
- Credential token format, hashing, expiry, and rotation
- Multi-event/organization tenancy needs
- Volunteer assignment escalation details beyond own bounded task status
- Exact audit immutability and retention controls
- Certificate artifact storage, batch/queue and provider design, email delivery key retention; explicit single/bulk Organizer/Admin issuance is locked
- Forecast feature retention and anonymization
- Database scale, backup, RPO, and RTO targets
