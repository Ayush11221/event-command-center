# Delivery Roadmap

**Current phase:** Phase 0 - Project foundation and documentation  
**Status rule:** A phase is complete only when its exit criteria have evidence. Future phases below are planned, not implemented.

The sequence reduces rework by resolving product and UX decisions before UI implementation, protecting transactional correctness before real-time distribution, and delaying operationally expensive infrastructure until a demonstrated need exists.

## Phase 0 - Project foundation and documentation

**Goal:** Establish the monorepo boundaries and a coherent, traceable planning baseline.

**Deliverables:** PRD, requirements, architecture, database, API, security, test, design-system, roadmap, README, concise repository rules, top-level monorepo directories, minimal private package metadata, and no-service Compose foundation.

**Exit criteria:** All planned documents exist; internal links and terminology are consistent; unresolved decisions are marked TBD; Graphify/Codex setup remains valid; no features or unnecessary dependencies exist; repository status is understood.

## Phase 1 - Product definition and UX architecture

**Goal:** Resolve the highest-impact product ambiguities and design role-specific flows before visual styling or backend contracts harden.

**Planned work:** Validate personas/journeys, lifecycle and attendance policies, role/permission matrix, information architecture, content model, scanner error recovery, command-center priorities, low-fidelity flows, workload assumptions, and acceptance criteria.

**Exit criteria:** Approved MVP journey/state maps, permission matrix, key policy decisions, low-fidelity UX architecture, updated PRD/requirements, and owned remaining TBDs.

## Phase 2 - Design system and UI direction

**Goal:** Establish an intentional, accessible visual and interaction system from representative product screens.

**Planned work:** Evaluate typography/color directions, tokens, themes, component states/variants, density, responsive behavior, scanner feedback, dashboard/chart requirements, and Figma use if beneficial. Install only selected dependencies.

**Exit criteria:** Reviewed design direction, tokens, representative prototypes, accessibility checks, chosen UI/chart tools with rationale, and implementation-ready component guidance.

## Phase 3 - Backend foundation

**Goal:** Create a maintainable Node.js/TypeScript/Express application skeleton with production-minded contracts and diagnostics.

**Planned work:** Backend package/tooling, domain-module conventions, configuration validation, health/readiness, error/validation patterns, OpenAPI foundation, structured logging/correlation, and test harness.

**Exit criteria:** Minimal service starts in supported environments; health and contract examples pass; no business feature is falsely claimed complete; architectural conventions are documented.

## Phase 4 - Database, authentication, and RBAC

**Goal:** Establish trustworthy identity, event-scoped authorization, and transactional persistence.

**Planned work:** PostgreSQL/Prisma, initial reviewed migrations, account/session integration, event and role foundations, permission enforcement, audit foundation, disposable integration database, and backup/retention decisions appropriate to the environment.

**Exit criteria:** Authentication and role matrix tests pass; cross-event/role access is denied; migrations work from empty state; security review covers session, secrets, and data handling.

## Phase 5 - Participant registration and QR identity

**Goal:** Deliver registration and a secure credential lifecycle.

**Planned work:** Event registration policy, participant ownership, duplicate rule, opaque QR generation/display, expiry, revocation/reissue, and privacy-safe delivery/access.

**Exit criteria:** Registration and credential journeys/failures pass; QR exposes no plaintext PII; ownership, duplicate, revoke, and replacement behavior is tested and audited.

## Phase 6 - Gate scanning and check-in

**Goal:** Deliver fast, explicit, idempotent gate decisions and authoritative attendance transitions.

**Planned work:** Scanner UX, camera permission/recovery, gate/operator context, scan-decision API, check-in/check-out policy, concurrency and duplicate handling, occupancy derivation, technical/policy error distinction, and correction policy if approved.

**Exit criteria:** Valid/invalid/revoked/wrong-event/duplicate/retry/concurrent cases pass; occupancy reconciles; target scan latency is measured; mobile/tablet accessibility is reviewed.

## Phase 7 - Real-time command center

**Goal:** Provide a trustworthy live operational view without weakening transactional correctness.

**Planned work:** Authoritative snapshot, WebSocket/SSE decision, live event schemas, reconnect/reconciliation, occupancy/capacity/gate activity, data freshness, degraded states, bounded alerts, and Kafka only if its need is demonstrated.

**Exit criteria:** Live latency target passes under documented workload; reconnect cannot silently miss state; stale/degraded states are visible; optional dependencies cannot lose attendance writes.

## Phase 8 - Crowd forecasting / AI service

**Goal:** Provide an honest, explainable near-term forecast that adds evidence beyond a naive baseline.

**Planned work:** FastAPI service, versioned data contract, synthetic/representative time-series plan, baseline, explainable model only if justified, chronological evaluation, uncertainty/freshness, missing-data handling, monitoring, and fallback.

**Exit criteria:** Reproducible time-aware evaluation is reported against baseline; limitations are visible; stale/insufficient data degrades safely; forecasting cannot change operational policy.

## Phase 9 - Certificates, audit, and reporting

**Goal:** Complete post-event workflows and accountable evidence.

**Planned work:** Versioned certificate eligibility, issue/access/revoke, completed-event analytics, audit search/access, privacy-safe reports/exports, and historical comparison rules.

**Exit criteria:** Eligibility and artifact lineage are reproducible; audit access is protected/audited; reports reconcile with authoritative data; exports honor privacy policy.

## Phase 10 - Testing, security, load, and failure testing

**Goal:** Validate the integrated system against product, security, performance, accessibility, and resilience requirements.

**Planned work:** Complete traceability matrix; broaden E2E/contract/concurrency tests; run threat model and security checks; execute load, live fan-out, failure injection, restore, accessibility, and supported-device/browser validation.

**Exit criteria:** Must requirements have evidence; agreed workloads and recovery scenarios pass; no unresolved critical/high security issue remains in scope; accepted gaps have explicit owners.

## Phase 11 - Observability, deployment, and CI/CD

**Goal:** Make builds, releases, runtime health, and failures visible and repeatable.

**Planned work:** Deployment platform, containers/Compose as relevant, CI quality gates, secret/environment management, migrations, structured logs, metrics, traces, Prometheus/Grafana configuration where selected, alerts/runbooks, backup/restore, and rollback.

**Exit criteria:** Reproducible build/deploy, environment separation, observable critical journeys, tested migration/restore/rollback, and documented operational ownership.

## Phase 12 - Final integration, documentation, and capstone demonstration

**Goal:** Present a coherent, evidence-backed product without overstating unfinished work.

**Planned work:** Final integration, seeded demonstration scenario, requirement/test evidence, architecture/security/operations review, user and developer documentation, rehearsed failure/recovery narrative, and limitations/future work.

**Exit criteria:** Demonstration covers core journeys and selected failures; setup is reproducible; documents match implementation; metrics/security/forecast claims have evidence; known limitations and future work are explicit.

## Cross-phase controls

- Do not enter a later phase merely because a technology is available.
- Update upstream product requirements before implementing scope changes.
- Record material architectural decisions when they are made.
- Add dependencies, directories, services, and automation only when they have an immediate owner and use.
- Preserve security, privacy, accessibility, observability, and test traceability throughout rather than postponing them to Phase 10/11.

