# Product Requirements Document

**Product:** Real-Time Event Operations Command Center with Crowd Forecasting and QR Identity  
**Status:** Phase 0 planning baseline  
**Role:** Product-level source of truth  
**Last updated:** 2026-09-30

## 1. Product overview

The product is a web-based event operations platform that connects event setup, participant registration, QR identity, gate activity, live occupancy, operational alerts, crowd forecasting, certificates, and audit history. It is intended to help an event team understand what is happening now, act on trustworthy information, and review what happened afterward.

The command center does not replace trained safety personnel or emergency procedures. Forecasts and alerts support human decisions; they do not autonomously control gates or crowds.

## 2. Product vision

Give every event operations role the right information at the right moment: a simple credential experience for attendees, a fast and unambiguous validation flow at gates, and a dependable live operational picture for organizers.

## 3. Problem statement

Event teams commonly coordinate registration, gate validation, attendance counts, and reporting through disconnected tools or manual processes. This creates delayed occupancy data, duplicate or ambiguous entry records, limited accountability, and little ability to anticipate near-term crowd conditions. Participants experience the same fragmentation as registration friction, unclear credentials, and slow entry.

## 4. Goals

- Maintain a trustworthy event and participant record from registration through post-event reporting.
- Issue a unique, privacy-conscious QR credential for each valid registration.
- Make gate validation fast, clear, auditable, and resistant to duplicate use.
- Keep live occupancy and gate activity current enough for operational decisions.
- Present forecasts with their horizon, freshness, assumptions, and uncertainty.
- Apply least-privilege access across organizer, admin, gate/security, volunteer, and participant roles.
- Produce evidence that important workflows are correct, secure, observable, and resilient.

## 5. Non-goals and out of scope

The MVP will not include:

- A general-purpose ticket marketplace, payment processing, refunds, or dynamic pricing
- Facial recognition, biometric identity, or passive attendee tracking
- Autonomous crowd-control decisions, emergency dispatch, or replacement of venue safety procedures
- Assigned seating, complex venue mapping, or route optimization
- Native iOS or Android applications; responsive web experiences are the current direction
- A generic CRM, marketing automation suite, or social network
- Multi-region production architecture unless a demonstrated requirement is added
- Guaranteed offline QR validation; the offline policy is TBD and requires a security/consistency decision

## 6. Target users and personas

### Event Organizer

Owns the event outcome and needs lifecycle controls, live visibility, forecasts, historical results, and accountable delegation. The organizer should see overall status without performing every administrative task.

### Event Admin

Configures event details, capacity, registration, gates, staff assignments, and operational policies. The admin needs precise controls and an audit trail.

### Gate/Security Staff

Validates credentials at an assigned gate and needs a fast scanner, an unmistakable accept/reject result, the reason for rejection, duplicate protection, and a safe fallback when scanning fails.

### Volunteer

Supports bounded event tasks. Volunteers need only the minimum data and actions required for their assignment; exact permissions remain TBD during RBAC design.

### Participant/Attendee

Discovers an event, registers, receives and presents a QR credential, attends, and obtains a certificate if the event's eligibility policy is satisfied. Participants need simple, mobile-friendly flows and control over their own data.

## 7. Core user journeys

### Organizer lifecycle

Create event -> configure details, capacity, gates, roles, and policies -> publish -> monitor live operations -> complete event -> analyze results.

Important exceptions: publication must fail visibly when required configuration is incomplete; material changes after publication must be authorized and audited.

### Participant journey

Discover event -> review details -> register -> receive QR credential -> arrive -> present QR at a gate -> receive check-in result -> participate -> check out if required -> receive certificate if eligible.

Important exceptions: duplicate registration, revoked/cancelled registration, unavailable credential, rejected scan, and certificate ineligibility must each have clear next steps.

### Gate/security flow

Open scanner -> confirm event and gate context -> scan QR -> validate credential and event policy -> accept or reject -> identify duplicate/replay attempts -> record the result -> update occupancy after an accepted state transition.

The interface must distinguish invalid, expired/revoked, wrong-event, duplicate, and technical-error outcomes without exposing unnecessary participant data.

### Organizer command center

Open live event -> view attendance and current occupancy -> monitor capacity and gate activity -> inspect data freshness -> view crowd forecast and uncertainty -> investigate anomalies -> take an operational action outside or inside the system as supported -> review the audit trail.

## 8. Core product capabilities

| Capability | Product intent |
| --- | --- |
| Event management | Create, configure, publish, operate, complete, and cancel events under controlled state transitions |
| Participant registration | Capture the minimum required participant details, enforce event policy, and show registration status |
| QR participant identity | Bind an opaque credential to a registration without placing sensitive personal data in the QR payload |
| QR generation | Create a unique, non-guessable, revocable credential representation |
| QR scanning | Support camera-based scanning on operational mobile/tablet devices, with a TBD accessible fallback |
| Check-in/check-out | Record accepted attendance transitions and derive occupancy consistently |
| Duplicate scan detection | Reject or flag a credential transition that violates the event's re-entry policy |
| Gate management | Configure gates, assign staff, and attribute scans to a gate and operator context |
| Volunteer management | Assign bounded event responsibilities under least privilege |
| Real-time occupancy | Show current occupancy, capacity utilization, trend, and data freshness |
| Crowd forecasting | Estimate near-term attendance/occupancy from available signals and expose confidence/limitations |
| Historical analytics | Compare actual attendance and gate patterns across completed events when data is comparable |
| Certificates | Generate and make available certificates only when an explicit eligibility rule is satisfied |
| Audit logs | Record security- and operations-relevant actions with actor, time, target, and outcome |
| Role-based access control | Authorize every protected action in the API, not only in the interface |
| Operational dashboard | Present the most actionable event state without decorative or misleading visual noise |
| Notifications and alerts | Provide in-product operational alerts where thresholds and recipients are defined; external channels are TBD |

## 9. Functional requirements

Detailed, testable requirements and identifiers live in [requirements/REQUIREMENTS.md](requirements/REQUIREMENTS.md). The product-level requirements are:

1. Authorized organizers/admins can manage an event through explicit lifecycle states.
2. Participants can register for a published event under its capacity and eligibility policy.
3. Each active registration has at most one active QR credential at a time; replacement revokes the previous credential.
4. A scan is evaluated against credential validity, event, gate/operator context, registration state, and re-entry policy.
5. Every scan attempt records an immutable outcome; only accepted attendance transitions change occupancy.
6. Authorized users can configure gates and assign event-scoped staff permissions.
7. The command center receives live attendance, occupancy, capacity, gate health/activity, alerts, and freshness metadata.
8. Forecasts identify their input window, prediction horizon, generation time, method/version, and uncertainty or confidence indicator.
9. Authorized users can inspect historical event results and export/reporting behavior once defined.
10. Certificate eligibility is derived from an explicit event policy and is auditable.
11. Security- and operations-relevant changes are written to an append-oriented audit trail.
12. Participants can access only their own registration/credential/certificate information unless another lawful workflow is defined.

## 10. Non-functional requirements

### Performance

- A normal online QR validation should return a decision within 2 seconds at p95 under the agreed test workload.
- Accepted scan changes should appear in the command center within 5 seconds at p95 under the agreed test workload.
- Exact peak concurrent users, scans per second, event sizes, and dashboard fan-out targets are **TBD through usage modelling**; load claims must not be made before these are set.

### Reliability

- A scan request must be idempotent so retries do not create multiple attendance transitions.
- Event and audit records must not be silently lost when downstream live updates or forecasting are unavailable.
- Recovery point and recovery time objectives are **TBD** before deployment architecture is finalized.

### Security

- Protected operations require authenticated, server-authorized, event-scoped access.
- QR payloads must not contain plaintext sensitive personal data.
- Secrets must remain outside source control; sensitive data must be protected in transit and at rest where the deployment platform supports it.
- Abuse, replay, privilege escalation, injection, dependency, and data-exposure risks must be tested before demonstration.

### Scalability

- Stateless API instances and asynchronous processing should be possible without changing product contracts.
- Scaling mechanisms will be introduced only when measured needs justify them; Kafka is not an automatic prerequisite for early phases.

### Observability

- Services must emit structured logs, metrics, and trace/correlation identifiers for critical journeys.
- Dashboards must show source freshness and degraded states instead of presenting stale information as live.

### Accessibility

- Target WCAG 2.2 AA for implemented web flows.
- Core journeys must support keyboard navigation, visible focus, semantic structure, accessible forms, reduced motion, and status cues that do not depend on color alone.

### Maintainability

- Keep domain boundaries explicit, contracts versioned, migrations reviewable, and dependencies justified.
- Documentation and automated tests must change with implemented behavior.

### Auditability

- Critical actions and decisions must be reconstructable from append-oriented records with timestamps, actors, targets, outcomes, and correlation identifiers.
- Retention and access policies are **TBD** and must account for privacy obligations.

## 11. Scope by product release

This product-release grouping is separate from the numbered delivery roadmap.

### MVP

- Event lifecycle and capacity configuration
- Participant registration and self-service credential access
- Opaque QR credential generation, revocation/reissue, and online validation
- Gate setup, staff assignment, check-in/check-out, and duplicate detection
- Live attendance, occupancy, capacity, gate activity, freshness, and bounded in-product alerts
- Event-scoped RBAC and audit logging
- A baseline, explainable occupancy forecast with uncertainty/limitations
- Basic completed-event analytics
- Certificate eligibility and generation for the demonstrated policy
- Responsive, accessible flows for the five target personas

### Product Phase 2 (post-MVP)

- Configurable notification channels after consent, delivery, and escalation requirements are defined
- Richer historical comparison and forecast evaluation across sufficient event history
- Refined volunteer workflows and configurable operational thresholds
- Credential wallet/email delivery options if justified
- Carefully designed degraded/offline gate workflow if consistency and revocation risks can be resolved

### Future/optional

- Multi-venue or organization portfolio operations
- Integrations with external ticketing, identity, messaging, or venue systems
- Native mobile applications
- Advanced spatial/zone forecasting where trustworthy sensor/location data exists
- Public APIs or webhooks for approved partners

## 12. Success criteria and measurable outcomes

The MVP is successful when:

- All four core journeys can be demonstrated end to end with their failure paths.
- Duplicate/replayed credential attempts do not create duplicate attendance transitions in automated concurrency tests.
- Occupancy reconciles exactly with accepted check-in/check-out transitions in the test dataset.
- The agreed performance targets in section 10 pass under a documented workload.
- Every privileged action in the acceptance suite is denied to unauthorized roles and produces appropriate audit evidence.
- Operators can identify live occupancy, capacity status, gate activity, data freshness, and forecast limitations without consulting another screen or raw log.
- Forecast evaluation is reported against a naive baseline; the forecast is not described as useful unless it beats or meaningfully complements that baseline on held-out time-ordered data.
- No unresolved critical/high security finding remains for the demonstrated scope.
- Core journeys pass the agreed WCAG-oriented automated and manual accessibility checks.

Business outcomes such as reduced queue time or improved staffing require a real or representative operational trial; target values are **TBD** rather than assumed.

## 13. Important assumptions

- Events have a configured capacity and at least one controlled entry point.
- Gate devices normally have network access; offline behavior remains TBD.
- Each accepted scan is attributable to an authenticated operator and gate context.
- Organizers have authority to process participant data for the event and will define retention/consent text before real use.
- Forecast accuracy depends on adequate, representative, time-stamped data; the system must tolerate insufficient history.
- Certificates are optional per event and use an explicit eligibility rule.
- Time zones are stored explicitly and timestamps are persisted in UTC.

## 14. Risks and constraints

| Risk or constraint | Mitigation direction |
| --- | --- |
| QR sharing, screenshots, replay, or rapid duplicate scans | Opaque revocable credentials, server-side state, idempotency, event policy, audit evidence |
| Gate connectivity loss | Show degraded status; define an offline policy only after threat and consistency analysis |
| Incorrect occupancy from missed exits or manual exceptions | Explicit transition model, reconciliation tools/policy TBD, visible freshness and discrepancy indicators |
| Forecast overconfidence or sparse data | Baseline comparison, time-aware evaluation, uncertainty, freshness, fallbacks, no autonomous action |
| Role misconfiguration or excessive volunteer access | Event-scoped least privilege, deny-by-default API authorization, permission tests, audit logs |
| Personal-data exposure | Data minimization, opaque QR payloads, controlled logs/exports, retention policy |
| Scope growth | Enforce MVP/non-goals, require traced requirements, defer optional integrations |
| Capstone time and infrastructure limits | Modular monolith first, introduce distributed infrastructure only at its roadmap phase |

## 15. Dependencies

- Product decisions: event lifecycle, re-entry/check-out policy, capacity semantics, volunteer permissions, certificate eligibility, alert thresholds, and retention
- UX research: role-specific information architecture, scanner ergonomics, error recovery, and accessibility
- Technical foundation: authenticated API, PostgreSQL, reliable time handling, idempotency, and real-time transport
- Data: representative time-ordered attendance data or a transparent synthetic-data plan for forecast evaluation
- Operations: deployment target, secret management, monitoring, backup/restore, and CI/CD decisions
- Devices: browser camera support and permission behavior on target mobile/tablet hardware

## 16. Traceability

```text
PRD
 |-- requirements/REQUIREMENTS.md
 |    |-- architecture/ARCHITECTURE.md
 |    |-- architecture/DATABASE_PLAN.md
 |    |-- api/API_PLAN.md
 |    `-- testing/TEST_STRATEGY.md
 |-- security/SECURITY_PLAN.md
 |-- design/DESIGN_SYSTEM.md
 `-- ROADMAP.md
```

- The PRD owns product intent, users, outcomes, and scope.
- Requirements assign stable IDs to behavior and quality constraints.
- Architecture, database, and API plans explain how requirements may be satisfied without claiming implementation.
- The security plan applies threat-based controls across all layers.
- The test strategy maps evidence to requirement IDs and risks.
- The design system defines experience principles without prematurely fixing visual choices.
- The roadmap sequences work and exit criteria; it does not redefine product scope.

When documents conflict, resolve product intent here first, then update downstream documents in the same change.

