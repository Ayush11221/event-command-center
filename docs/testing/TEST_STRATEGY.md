# Test Strategy

**Status:** Planned; no application tests exist yet  
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

- Event lifecycle and policy decisions
- Role/permission evaluation
- Credential issue/revoke/validation helpers
- Attendance state machine and occupancy fold
- Alert threshold/state behavior
- Certificate eligibility
- Forecast feature preparation, baselines, and evaluation metrics

Avoid mocking every implementation detail; test observable domain behavior.

### Frontend component tests

Test role-appropriate states, accessible names/keyboard behavior, loading/error/empty/success/degraded states, scanner feedback, status cues independent of color, and live-update reconciliation. Visual snapshots alone are insufficient.

### API and database integration tests

Run against a disposable PostgreSQL instance and real migrations. Cover validation, authentication/authorization, constraints, transactions, idempotency, rollback, concurrency, audit linkage, and query behavior. Replace only truly external dependencies at clear boundaries.

### Contract tests

Validate the OpenAPI contract and backend/frontend expectations. Validate backend-to-FastAPI requests/responses and live-event schemas across versions. Prevent undocumented breaking changes.

### End-to-end tests

Automate the four PRD journeys plus essential failures:

- Organizer creates/configures/publishes/completes an event
- Participant registers, obtains a credential, checks in, and accesses an eligible certificate
- Gate staff accepts valid entry and rejects invalid, revoked, wrong-event, and duplicate attempts
- Organizer observes live occupancy/gate activity/forecast/degraded states
- Unauthorized roles cannot perform protected actions or access another participant's data

Use browser automation only after real screens exist; do not create mock pages merely to satisfy tests.

### Load and concurrency tests

Model a documented workload before selecting volumes. Measure scan p50/p95/p99 latency, error rate, accepted transition integrity, live-update latency, database saturation, connection fan-out, and recovery. At minimum test normal operation, a burst at event opening, simultaneous duplicate scans, dashboard fan-out, and forecast workload isolation.

Tools are selected in Phase 10; no load library is authorized by this plan alone.

### Failure and recovery tests

Exercise database connection interruption, slow database, live-channel disconnect/reconnect, dropped/duplicated asynchronous events, forecasting timeout/unavailability, process restart, and network latency. Verify core attendance durability, explicit degraded states, bounded retries, reconciliation, and no false “live” status.

### Security tests

Follow the [security plan](../security/SECURITY_PLAN.md): object/role authorization, QR tamper/replay/revocation, session controls, validation/injection, abuse/rate behavior, sensitive-data leakage, dependency/secret/container scans, and deployed-surface checks. Security tests must be authorized and confined to project environments.

### Accessibility tests

Combine automated checks with keyboard-only, screen-reader-oriented semantic review, focus order/visibility, zoom/reflow, contrast, reduced motion, form error, and non-color status testing. Target WCAG 2.2 AA for core journeys.

### Forecast validation

- Use chronological train/validation/test splits; never randomize future observations into training.
- Compare against naive and seasonal baselines where data supports them.
- Fix seeds and version data, features, code, model/method, and metrics.
- Report the approved error metric by horizon plus availability/coverage and uncertainty calibration when applicable.
- Test missing, sparse, delayed, duplicated, and anomalous inputs.
- A complex model is not accepted unless it materially improves a relevant metric and remains operable/explainable.

Forecast horizon, cadence, metric, and minimum useful improvement are TBD in Phase 8.

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

Exact CI provider and deployment environment are TBD in Phase 11.

## Traceability and evidence

Test names or metadata should reference requirement IDs where practical. A final acceptance matrix will map every Must requirement to automated evidence, manual evidence, or an explicitly approved gap. Store reports as CI artifacts when infrastructure exists; do not commit bulky generated results by default.

## Quality gates

A change is not “working” solely because it compiles. Relevant checks must pass, migrations/contracts/docs must agree, and no new critical/high security issue may remain unexplained. Final release gates include:

- Four core journeys and required failure paths pass.
- Occupancy reconciles exactly with accepted transitions in the test data.
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

- Concrete test frameworks and CI matrix
- Workload volumes and performance budgets beyond current latency targets
- Supported browser/device matrix, including scanner hardware
- Accessibility assistive-technology matrix
- Forecast metrics/horizons and acceptance threshold
- Coverage/report retention expectations
- Production-like environment and failure-injection mechanism

