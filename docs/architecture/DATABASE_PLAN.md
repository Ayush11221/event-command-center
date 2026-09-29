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
| Account | Authenticated identity with status and security metadata; participant profile fields should be separated/minimized as needed |
| Event | Lifecycle, schedule, time zone, capacity, venue summary, registration policy, and operational configuration |
| EventRoleAssignment | Links an account to an event-scoped role; unique per applicable account/event/role tuple |
| Gate | Belongs to an event and carries operational status/configuration |
| Registration | Links participant/account to event with lifecycle, eligibility, and timestamps; duplicate rule is TBD |
| Credential | Belongs to a registration; stores opaque identifier/hash, status, issue/expiry/revocation metadata, and replacement lineage |
| ScannerSession | Optional explicit record tying operator, event, gate, device/session metadata, and start/end times |
| ScanAttempt | Append-oriented record of every validation attempt and decision, including idempotency/correlation data |
| AttendanceTransition | Accepted check-in/check-out or authorized correction linked to its source attempt/action |
| OccupancyProjection | Rebuildable current/event/gate aggregate with version and freshness; not the only source of truth |
| OperationalAlert | Condition, severity, evidence, lifecycle, acknowledgement, and event scope |
| ForecastRun | Input window, horizon, method/model version, status, evaluation metadata, and generation time |
| ForecastPoint | Time-indexed prediction and uncertainty values belonging to a run |
| CertificatePolicy | Versioned event-scoped eligibility rule |
| Certificate | Participant/event issue status, policy version, artifact reference/hash, issue/revocation metadata |
| AuditEvent | Append-oriented actor/action/target/outcome/correlation record with controlled detail |

If participants may register without accounts, the identity and ownership model must be decided before schema design rather than adding nullable relationships ad hoc.

## Integrity and concurrency rules

- One active credential per registration, enforced using a transaction plus a suitable unique/index strategy.
- Credential public identifiers/tokens must be globally unique and non-sequential.
- One logical scan result per event/idempotency key; repeated requests return the original decision where safe.
- An attendance transition references one source scan/action and cannot be duplicated by concurrent requests.
- Event/gate/registration/credential relationships must be checked in the database transaction.
- Capacity warnings do not automatically reject entry unless an explicit event policy says so; that policy is TBD.
- Audit events and scan attempts are not casually updated or deleted through normal product APIs.
- Occupancy must be rebuildable by folding accepted transitions under the approved re-entry/correction policy.

## Index planning

Indexes will be based on measured query plans. Expected access paths include:

- Event lifecycle and schedule queries
- Registration lookup by event and participant identity/normalized contact rule
- Credential validation by hashed/public identifier and status
- Scan attempts by event, gate, time, credential, result, and correlation/idempotency key
- Attendance transitions by event, registration, and time
- Current event-scoped role lookup by account
- Forecast runs/points by event, generation time, and horizon
- Audit events by event, actor, target, action, correlation identifier, and time

Avoid indexing sensitive plaintext values solely for convenience; define normalized lookup and encryption/hash behavior deliberately.

## Transaction boundaries

The scan decision transaction should lock or otherwise serialize the relevant credential/registration attendance state, insert the scan attempt, insert at most one accepted transition, and persist reliable publication/audit intent. The exact isolation/locking approach requires a concurrency proof and tests.

Event publication, credential replacement, role assignment, manual attendance correction, and certificate issue/revocation also require explicit transactional boundaries.

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
- Define retention and deletion/anonymization for registrations, scans, audits, forecasts, certificates, and backups. All durations are TBD.
- Audit/data export access must be authorized and itself audited.

## Backup, recovery, and reconciliation

Backup technology, frequency, RPO, and RTO are TBD for the deployment target. Before demonstration with meaningful data, verify a restore, run attendance-to-occupancy reconciliation, and document how missing/duplicate projection events are repaired.

## Open decisions

- Account-required versus guest registration
- Participant identity/duplicate matching keys
- Event lifecycle and cancellation retention
- Check-out, re-entry, manual correction, and capacity-enforcement policy
- Credential token format, hashing, expiry, and rotation
- Multi-event/organization tenancy needs
- Exact audit immutability and retention controls
- Certificate artifact storage
- Forecast feature retention and anonymization
- Database scale, backup, RPO, and RTO targets
