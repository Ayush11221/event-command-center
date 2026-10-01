# Test Strategy

**Status:** Planned; no application tests exist yet. [Phase 2 test architecture](TEST_ARCHITECTURE.md) selects tool directions and high-risk scenario coverage.
**Quality sources:** [requirements](../requirements/REQUIREMENTS.md), [security plan](../security/SECURITY_PLAN.md), and future executable contracts

## Objectives

- Prove critical user journeys and their failure paths, not only happy-path code coverage.
- Protect attendance, occupancy, credential, authorization, and audit correctness under retries and concurrency.
- Measure performance and live-update latency against declared workloads.
- Verify graceful behavior when real-time, forecasting, messaging, or infrastructure dependencies fail.
- Test accessibility, security, observability, and forecast quality as first-class product requirements.

## Test placement in the monorepo

- Unit and focused component tests stay close to frontend, backend, and AI source code.
- `tests/integration` will hold cross-component/database/event-stream tests.
- `tests/e2e` will hold browser/user-journey tests.
- `tests/load` will hold documented performance scenarios.
- `tests/security` will hold authorized security regression tests and safe scan configurations.
- `tests/fixtures` will hold small, synthetic, deterministic shared fixtures.

These directories are created only when their first real suite is added.

## Test layers

### Static checks

Formatting, linting, type checking, schema validation, migration checks, dependency/secret scanning, and Python quality checks will be selected with the implemented stack. They are fast CI gates, not substitutes for behavioral tests.

### Unit tests

Prioritize pure and high-risk logic:

- Organizer-only event lifecycle including Live cancellation, Published detail editing/audit and restricted Live registration/attendance policy edits, exact PUBLIC allowlist/PRIVATE non-leakage, publication-default/future opening and Live closure, three registration closure causes, REGISTERED cap versus INSIDE occupancy, and cancellation cutoff plus post-check-in prohibition
- Role/permission evaluation
- Credential issue/revoke/validation helpers
- Attendance state machine (optional exit/re-entry) and append-only correction/occupancy fold
- Alert condition deduplication and ACTIVE → ACKNOWLEDGED → RESOLVED behavior
- Accepted-check-in ELIGIBLE without automatic issue/send, explicit single/bulk issue, post-check-in registration-cancellation denial, and independent email-delivery state
- Forecast feature preparation, baselines, and evaluation metrics

Avoid mocking every implementation detail; test observable domain behavior.

### Frontend component tests

Test role-appropriate states, accessible names/keyboard behavior, loading/error/empty/success/degraded states, scanner feedback, status cues independent of color, and live-update reconciliation. For Slice 3, cover sole-context auto-selection, multiple Event + Role choices (including two roles on one Event), authorized-only local restoration, revoked-context fallback/empty state, and proof that selector changes do not bypass server authorization. Cover locally persisted Light/Dark/System for anonymous and signed-in users, live OS changes in System, pre-render theme application, and accessible states in both rendered themes. Visual snapshots alone are insufficient.

### API and database integration tests

Run against a disposable PostgreSQL instance and real migrations. Cover validation, authentication/authorization, constraints, transactions, idempotency, rollback, concurrency, audit linkage, and query behavior. Replace only truly external dependencies at clear boundaries.

### Contract tests

Validate the OpenAPI contract and backend/frontend expectations. Validate backend-to-FastAPI requests/responses and live-event schemas across versions. Prevent undocumented breaking changes.

### End-to-end tests

Automate the four core PRD journeys, the selected bounded volunteer journey, and essential failures:

- Organizer creates/configures/publishes/completes or cancels an event, including from Live; Publish and Live each reject a missing configured Event–Gate association; Event Admin cannot control lifecycle or cancel the event
- Event Admin configures gates and grants only approved event-scoped roles
- Authenticated participant and OTP-verified guest register only while Published under default/future opening and scheduled/capacity/manual rules, cancel only before cutoff and first accepted check-in, re-register with new QR, check in, see ELIGIBLE before explicit issue, and access only own ISSUED certificate
- Gate staff accepts valid entry and rejects invalid, revoked, wrong-event, and duplicate attempts
- Organizer observes live occupancy/gate activity/forecast/degraded states
- PUBLIC Published event appears with only allowlisted fields; PRIVATE Published detail requires a valid opaque controlled bearer link, not a guessed ID or login/guest OTP. Organizer alone issues/revokes/reissues at most one active event link without time TTL; replacement denies the old proof immediately, and malformed/revoked/non-PRIVATE/non-Published/unknown requests do not leak event existence. Volunteer sees/progresses only own task
- Organizer/Admin previews a built-in certificate, explicitly issues one or starts a bulk batch, sees generation/email progress, explicitly revokes, and retries a FAILED send without duplicate email or reissue
- Unauthorized roles cannot perform protected actions or access another participant's data

Use browser automation only after real screens exist; do not create mock pages merely to satisfy tests.

### Load and concurrency tests

Model a documented workload before selecting volumes. Measure scan p50/p95/p99 latency, error rate, accepted transition integrity, live-update latency, database saturation, connection fan-out, and recovery. At minimum test normal operation, a burst at event opening, simultaneous duplicate scans, dashboard fan-out, and forecast workload isolation.

Tools are selected in Phase 10; no load library is authorized by this plan alone.

### Failure and recovery tests

Exercise database connection interruption, slow database, live-channel disconnect/reconnect, dropped/duplicated asynchronous events, forecasting timeout/unavailability, process restart, and network latency. Verify core attendance durability, explicit degraded states, bounded retries, reconciliation, and no false “live” status.

## Locked-policy scenario matrix

| Area | Conceptual tests |
| --- | --- |
| Discovery/registration | Exact PUBLIC Published field allowlist and forbidden fields; PRIVATE valid bearer link versus guessed ID/invalidated/non-Published safe unavailable, with no detail-view OTP; verified account/guest OTP for later registration. Slice 3 reports only evidenced NOT_OPEN_YET/OPEN/SCHEDULED_CLOSE_REACHED/MANUALLY_CLOSED policy reasons, not fabricated cap/count/remaining or a working registration action. Later, one REGISTERED per user or verified guest email OR phone/event. Publication opens by default; future opening blocks until time; configured/default event-start close and Live transition always block, including when configured close is later. Published detail edits are audited; assigned Admin may edit only named Draft/Published public fields, not capacity/visibility/schedule/policy, while Live registration/attendance policy changes cannot silently rewrite active contract. REGISTERED-cap and Organizer manual closure are distinct. Pre-check-in cancellation frees a slot and reopens only capacity-only closure, never manual/scheduled/Live closure. Organizer/Admin may cancel after participant cutoff only before accepted check-in; retained CANCELLED row and new token. Cancelled event denies registration but leaves rows unchanged. |
| Slice 3 event/gate/PRIVATE-link contract | Owner-only create/transitions/link issue/revoke/reissue; owned versus currently assigned list/detail isolation, permitted actions and revision; Admin allowlist and wrong-event/link-mutation denials; partial Draft save; missing persistent Event–Gate association rejects Publish and independently Live, while staff/device/connectivity/health are not guards; authorized gate create and embedded read, atomic audit, version conflict and same-key replay. PRIVATE proof is protected and absent from logs/audit; one-active uniqueness and concurrent reissue, old-proof next-request denial, no timed expiry, visibility/lifecycle invalidation, identical safe unavailable result, public serializer allowlist and no Slice 3 cap/count/remaining claims are negative tests. |
| QR/gate | Valid/invalid/wrong-event/revoked/CANCELLED QR; Cancelled event blocks check-in; assigned-gate display name, registration/attendance status, event/scan result only, with no email/phone/OTP/credentials; unique scan_id/retry/new duplicate/concurrency; failed result never increments occupancy; REGISTERED-cap fullness does not itself block gate entry. |
| Attendance | NOT_ARRIVED → INSIDE; optional check-out INSIDE → LEFT; re-entry only after valid exit; no outside claim when check-out disabled; cancellation after first accepted check-in denied for all roles even after LEFT, so CANCELLED + INSIDE cannot arise; authorized Organizer/Admin actor/reason correction remains append-only and projection reconciles. |
| Alerts | Exactly three categories: live INSIDE occupancy WARNING near default 90% and CRITICAL at 100% of event capacity, assigned-gate scanner failure, data/forecast staleness. REGISTERED-list fullness produces no alert. Persistent-condition deduplication, ACTIVE/ACKNOWLEDGED/RESOLVED, evidence/timestamps; Organizer/Admin full stream with acknowledge/resolve, Gate/Security assigned-gate read-only, Volunteer none. |
| Certificates | First accepted check-in creates ELIGIBLE on non-CANCELLED registration but no PDF/email; explicit Organizer/Admin single or database-derived bulk issue creates ISSUED/unique-ID PDF, built-in preview, batch progress; NOT_ELIGIBLE/ELIGIBLE/ISSUED/REVOKED distinct from email PENDING/SENT/FAILED (including ISSUED + FAILED). Post-check-in registration cancellation denied; explicit revoke, Organizer/Admin-only retry/idempotent no-duplicate send, own-artifact isolation. |
| RBAC/audit | Organizer owns lifecycle/Admin grants; Event Admin cannot cancel event/promote/transfer; gate has assigned-gate minimal identity and read-only operational alerts, no correction; Volunteer has own task only; Participant owns own record and cannot retry email; Organizer/Admin have restricted event-scoped audit read and no unrestricted export or direct staff credential issue/revoke. |
| Forecast | Fixed 30/60-minute horizon, current versus predicted occupancy/capacity, generation time and freshness, uncertainty, stale/unavailable; chronological validation against simple baseline, suitable MAE/RMSE reporting, no autonomous gate change. |

### Security tests

Follow the [security plan](../security/SECURITY_PLAN.md): object/role authorization, QR tamper/replay/revocation, session controls, validation/injection, abuse/rate behavior, sensitive-data leakage, dependency/secret/container scans, and deployed-surface checks. Security tests must be authorized and confined to project environments.

### Accessibility tests

Combine automated checks with keyboard-only, screen-reader-oriented semantic review, focus order/visibility, zoom/reflow, contrast, reduced motion, form error, and non-color status testing. Target WCAG 2.2 AA for core journeys.

### Forecast validation

- Use chronological train/validation/test splits; never randomize future observations into training.
- Compare against naive and seasonal baselines where data supports them.
- Fix seeds and version data, features, code, model/method, and metrics.
- Report suitable error metrics such as MAE/RMSE by fixed 30/60-minute horizon plus availability/coverage and uncertainty calibration when applicable.
- Test missing, sparse, delayed, duplicated, and anomalous inputs.
- A complex model is not accepted unless it materially improves a relevant metric and remains operable/explainable.

MVP horizons are fixed at 30/60 minutes. Cadence/minimum-data rule is an implementation-phase decision; a production acceptance threshold is not hardcoded and will be decided with Phase 8 evidence.

## Test data

- Use synthetic, deterministic identities and event histories.
- Never copy real participant data into fixtures, logs, screenshots, or repositories.
- Maintain small canonical edge-case fixtures plus generated load datasets with documented seeds.
- Ensure time zones, daylight-saving boundaries, clock skew, and event-boundary times are represented.
- Make destructive tests environment-guarded and disposable.

## Environments

| Environment | Purpose |
| --- | --- |
| Local | Fast unit/component work and disposable integration dependencies |
| CI | Repeatable static, unit, integration, contract, and selected E2E/security checks |
| Production-like demonstration | Full journey, load, failure, observability, backup/restore, and final security validation |

GitHub Actions is the Phase 2 CI direction; exact job matrix and deployment environment remain TBD for implementation.

## Traceability and evidence

Test names or metadata should reference requirement IDs where practical. A final acceptance matrix will map every Must requirement to automated evidence, manual evidence, or an explicitly approved gap. Store reports as CI artifacts when infrastructure exists; do not commit bulky generated results by default.

## Quality gates

A change is not “working” solely because it compiles. Relevant checks must pass, migrations/contracts/docs must agree, and no new critical/high security issue may remain unexplained. Final release gates include:

- Four core journeys and required failure paths pass.
- Occupancy reconciles exactly with accepted check-in/check-out and authorized correction transitions in the test data; failed/duplicate scans have no effect.
- Duplicate/retry concurrency creates one logical transition.
- NFR performance targets pass against the documented workload.
- Protected-action authorization matrix passes.
- Core accessibility checks pass or gaps are explicitly owned.
- Forecast evidence is compared with the declared baseline.
- Backup/restore and degraded dependency scenarios are demonstrated.

Coverage percentages may inform risk but will not be used as a universal quality proxy. Thresholds, if any, are TBD per component.

## Defect handling

Prioritize by user/operational impact, security, data integrity, reproducibility, and likelihood. A fixed defect receives a regression test where feasible. Flaky tests are defects: quarantine is temporary, visible, and owner/time bounded.

## TBD decisions

- Exact test-runner configuration and CI matrix; Phase 2 identifies Vitest, React Testing Library, Supertest, Playwright, pytest, Testcontainers and k6 as tool directions
- Workload volumes and performance budgets beyond current latency targets
- Supported browser/device matrix, including scanner hardware
- Accessibility assistive-technology matrix
- Forecast cadence/data sufficiency and later acceptance threshold; horizons fixed at 30/60 minutes
- Coverage/report retention expectations
- Production-like environment and failure-injection mechanism
