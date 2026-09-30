# Architecture Plan

**Status:** Directional plan; no architecture has been implemented  
**Drivers:** [PRD](../PRD.md) and [requirements](../requirements/REQUIREMENTS.md)

## Architecture goals

- Make scan decisions correct, idempotent, and auditable before optimizing throughput.
- Keep event management, registration, credentials, attendance, live operations, forecasting, certificates, and audit boundaries explicit.
- Preserve an authoritative transactional record while allowing asynchronous live views and analytics.
- Start with the smallest deployable structure that supports the MVP; split services only for a measured boundary or scaling need.
- Surface degraded/stale states and avoid coupling core attendance writes to optional forecasting or visualization components.

## Proposed system shape

The repository is a monorepo with clear frontend, backend, forecasting, database, cross-system testing, infrastructure, documentation, and operations boundaries. The initial runtime direction is a **modular backend plus a bounded FastAPI forecasting service**, not a microservice fleet.

```text
Participant and Staff Browsers
            |
       HTTPS + live channel
            |
React/TypeScript Web Application
            |
Versioned Node.js/TypeScript API
  | event/registration/verified account + guest OTP identity
  | gate/attendance/live projection
  | certificates/batches/delivery/audit/reporting
            |
        PostgreSQL
            |
 Transactional event publication
   (mechanism chosen in Phase 7)
       |             |
 Live delivery   Forecasting worker/service
                     |
              Forecast results store
```

Certificate bulk issuance/email is a separate asynchronous job boundary backed by durable state: authorized batch creation → eligible registration selection → explicit issue action with built-in-template unique-ID PDF generation → auditable ISSUED state → platform-sender delivery attempts/status/retry. Preview precedes the issue action. The exact queue, worker, PDF library, and email provider are deferred. Kafka is **not** required for this workflow.

Kafka is a planned candidate for Phase 7/8 event streaming, not a Phase 0 commitment. A transactional outbox or equivalent reliable publication pattern must protect against database/event-bus dual-write loss if Kafka is introduced. WebSocket versus Server-Sent Events remains TBD based on client-to-server interaction needs and deployment constraints.

## Planned technology direction

| Area | Direction | Status/rationale |
| --- | --- | --- |
| Web | React + TypeScript | Planned; suitable for role-specific web flows |
| UI | Tailwind CSS + shadcn/ui + Lucide React | Candidate foundation; final design tokens remain TBD |
| API | Node.js + TypeScript + Express | Planned; keep domain modules framework-light |
| Data | PostgreSQL | Planned authoritative transactional store |
| Data access | Prisma | Planned; validate concurrency, migrations, and query requirements before relying on it |
| Live delivery | WebSocket or SSE | TBD after Phase 1 interaction modelling |
| Event streaming | Kafka | Deferred until the real-time architecture justifies operational cost |
| Forecasting | Python + FastAPI + explainable baselines/scikit-learn | Planned bounded service; no complex model by default |
| Local operations | Docker/Compose | Planned for reproducible multi-component development |
| Observability | Structured logs, OpenTelemetry, Prometheus-compatible metrics, Grafana | Planned direction; deployment-specific choices TBD |

No package selection in this document authorizes installation by itself.

## Monorepo structure rules

The workspace root is the `event-command-center` repository; do not add another nested repository directory.

```text
frontend/       React + TypeScript application
backend/        Node.js + TypeScript + Express API
ai-service/     Python + FastAPI forecasting/ML service
database/       PostgreSQL/Prisma schema, migrations, and database scripts
tests/          Cross-system E2E, integration, load, security tests, and fixtures
docs/           Product and engineering source documents
docker/         Component/container configuration
scripts/        Purpose-built automation
monitoring/     Prometheus/Grafana configuration when implemented
.github/        CI/CD workflows when implemented
.codex/         Project-scoped Codex configuration
```

Only these top-level boundaries are created in Phase 0. Deeper directories appear with real implementation:

- `frontend/src` will be feature-oriented, with `app`, `assets`, `components/{ui,common,layout}`, `features`, `hooks`, `lib`, `services`, `stores`, `types`, `utils`, and `styles` only as needed.
- `backend/src` will contain framework-level `config`, `middleware`, `routes`, `websocket`, and `kafka` boundaries only when needed, while business code lives by domain under `modules`. A module may colocate controller, service, repository, route, schema, and types files when each has real behavior.
- `ai-service/app` will separate API adapters, forecasting logic, model artifacts/loaders, schemas, services, and utilities. Experiments/notebooks must remain outside production service code.
- `database/prisma` will hold the schema, reviewed migrations, and purpose-built seed only when Phase 4 begins.
- `tests` will hold cross-system `e2e`, `integration`, `load`, `security`, and shared fixtures as those suites are introduced; unit/component tests stay close to their code.

Prefer feature/domain organization, keep related code close, and avoid duplicate utilities/types, circular dependencies, giant files, speculative abstractions, empty scaffolding, or repeated reorganizations without an architectural reason. Root `package.json` is private metadata only; package-manager workspace configuration is TBD until JavaScript packages exist. Root `docker-compose.yml` intentionally has no services until a real service needs orchestration.

## Domain boundaries

### Event operations

Owns event identity, PUBLIC/PRIVATE access with a strict public-detail allowlist, Organizer-only lifecycle including Live cancellation, one MVP registration cap, publication-default/future opening, and distinct scheduled/event-start, capacity, manual, and Live registration closure. Also owns optional check-out, gates, policies, and event-scoped role assignments. Cancelled events reject new registrations/check-ins while existing registrations remain unchanged for audit. Organizer owns the event and manages Event Admin grants; Published detail edits are permitted, while Live registration/attendance policy changes are restricted.

### Registration and credentialing

Owns verified account/OTP-guest registration, REGISTERED/CANCELLED history, pre-check-in cancellation/re-registration, and active credential lifecycle. No actor can cancel after first accepted check-in, preventing CANCELLED + INSIDE; post-check-in occupancy uses valid check-out or reasoned correction. Only REGISTERED registrations count against the cap; live INSIDE occupancy is a separate attendance projection. QR is an opaque/random token; this boundary never treats a client-presented payload as trusted identity without current server registration-state validation.

### Gate and attendance

Owns unique scan_id attempts, idempotent original-result retries, attendance state transitions, reasoned append-only correction, and occupancy derivation. Only an accepted transition changes the projection; failed/new duplicate scans do not. Optional check-out permits LEFT and subsequent re-entry; without exit, no outside claim is made.

### Live operations

Owns live projections, freshness, and exactly three deduplicated alert conditions: live-occupancy capacity (near-90% WARNING, 100% CRITICAL), gate/scanner operational failure, and data/forecast staleness. Alerts follow ACTIVE/ACKNOWLEDGED/RESOLVED, with one active alert per event condition; registration-full is not an alert. Organizer/Admin get the full stream and may acknowledge/resolve; Gate/Security sees assigned-gate operational alerts read-only; Volunteer none. A live transport failure must not roll back an accepted attendance transition.

### Forecasting

Consumes time-ordered operational facts, produces fixed MVP 30/60-minute versioned predictions with uncertainty, and cannot mutate attendance or gate policy. It must return unavailable/degraded when inputs are insufficient.

### Certificates and reporting

Evaluates first-accepted-check-in eligibility on non-CANCELLED registrations and exposes results. Owns built-in template/font preview, batch/job progress, unique-ID PDFs, independent certificate issue/revoke and email PENDING/SENT/FAILED delivery/retry from a platform sender. Artifacts and attempts trace to source data/rule/batch; an ISSUED certificate may have FAILED delivery.

### Audit

Receives security- and operations-relevant events. Application logs are diagnostic; audit records are controlled evidence and have separate access/retention requirements.

## Critical data flows

### QR validation and attendance

1. Authenticated operator selects an authorized event and gate.
2. Client submits the opaque QR token and unique client-generated scan_id for one logical attempt.
3. API validates input, operator scope, credential state, event policy, and current attendance state in a transaction.
4. The system records one immutable logical scan attempt/decision and, when accepted, one attendance transition. Same-scan_id transport retries return the original result; new conflicting scans are separate rejected attempts.
5. Occupancy is derived/updated from the accepted transition.
6. Audit and live-update publication are reliably linked to the transaction.
7. Client receives a minimal accept/reject/technical reason and correlation identifier. A failed/unknown result holds entry; no MVP manual override.

Concurrency control and unique constraints must prevent two near-simultaneous scans from creating conflicting transitions.

### Live command center

1. Authorized client obtains an authoritative snapshot with a version/time.
2. Client subscribes to scoped updates.
3. Updates carry event/correlation identifiers and ordering/reconciliation metadata.
4. On gaps or reconnect, the client refreshes from authoritative state rather than assuming no events were missed.
5. Freshness and degraded dependencies are displayed.

### Forecast generation

1. Forecast component receives or queries a defined window of accepted operational facts.
2. It validates data sufficiency and freshness.
3. A versioned baseline/model produces forecast points and uncertainty metadata.
4. Results are stored with inputs/window metadata and exposed read-only to authorized command-center clients.
5. Actual outcomes are retained for later time-aware evaluation subject to the data policy.

## Consistency and failure principles

- PostgreSQL is authoritative for event, credential, scan, attendance, and authorization state.
- Attendance writes must not depend synchronously on Kafka, forecasting, email, or dashboard delivery.
- External retries use idempotency keys; internal consumers use event identifiers and deduplication.
- Certificate issue and email delivery are separate durable state machines; generation/send retries cannot duplicate artifacts or emails for one operation. Email failure does not roll back issue or attendance.
- At-least-once delivery is acceptable only when consumers are idempotent.
- Stale dashboards and forecasts must be labeled; last-known data must never masquerade as current.
- Manual correction, replay, and reconciliation tools require authorization and audit design before implementation.

## Security and privacy boundaries

- Verified account sessions or OTP-verified guest ownership contexts establish identity; server-side event/own-record authorization decides each action.
- Browser clients are untrusted, including route guards and QR contents.
- Minimize PII in APIs, logs, QR payloads, real-time events, analytics, and model features.
- Administrative and scanner sessions require protection against credential theft, CSRF where applicable, injection, and abuse.
- Trust boundaries and controls are detailed in [SECURITY_PLAN.md](../security/SECURITY_PLAN.md).

## Scalability approach

Scale in evidence-driven steps:

1. Correct single-instance behavior and representative indexes/queries.
2. Stateless API instances behind a load balancer.
3. Shared live-delivery coordination if multiple instances require it.
4. Durable event streaming when fan-out, replay, or independent consumers justify Kafka.
5. Separately scale forecasting workloads and live connections.

Target volumes are TBD; no component is “scalable” until measured against the agreed workload.

## Deployment and environments

Planned environments are local development, automated test, and a production-like demonstration environment. Exact cloud/runtime, network topology, domains, TLS termination, secret store, backups, RPO/RTO, and cost limits are TBD in Phase 11. Environment parity should focus on contracts and dependencies, not identical scale.

## Architecture decision records

Material decisions should receive short ADRs when implementation begins, including:

- API framework and repository/application layout
- Authentication mechanism and session/token storage
- WebSocket versus SSE
- Attendance transaction and occupancy projection design
- Whether/when Kafka is introduced and the publication pattern
- Forecast service boundary and data contract
- Deployment platform and observability stack

## Risks and open decisions

- Offline scanning/manual override are post-MVP because revocation and duplicate prevention require online validation.
- Occupancy accuracy depends on whether check-out is enabled and the audited correction process; the re-entry rule itself is locked.
- MVP lifecycle, registration timing, public field allowlist, alert actions, and least-privilege role boundaries are locked in the decision register. Terminal reopening and unrestricted exports require a future decision if proposed. The sole MVP capacity is a registration cap, not an independent gate limit; certificate issuance is explicit.
- Live ordering/reconciliation semantics need concrete protocol design.
- Forecast data availability may be insufficient for more than a transparent baseline.
- Kafka and service separation may exceed capstone operational capacity if introduced early.
- All workload, recovery, retention, and deployment targets remain TBD.
