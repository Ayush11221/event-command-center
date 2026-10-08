# Slice 1 Plan — Runnable Repository and Tooling Foundation

**Status:** planning only; no code, dependency, schema, migration, route or service has been created by this document. This plan uses item 1 of the approved-for-planning [Phase 2 vertical-slice roadmap](../ROADMAP_PHASE_2.md) and the [technical architecture](../architecture/TECHNICAL_ARCHITECTURE.md). Phase 1 product behavior remains authoritative.

## 1. Slice 1 objective

Deliver a reproducible **developer-visible** starting point: a minimal React/TypeScript/Vite application that boots, a minimal Node/TypeScript/Express API with safe liveness/configuration diagnostics, and repeatable static/test/build checks in GitHub Actions. A developer can tell which process is available without mistaking this for event, registration, or gate functionality. PostgreSQL integration starts with Slice 2, when there is an actual persistence owner; Slice 1 does not add a container merely to display a health light.

This is first because every later slice needs runnable workspaces, config validation, health, and CI evidence. The roadmap calls it a “vertical slice,” but it is **not yet a user-facing business vertical slice**. The request for a participant/staff capability and a contiguous frontend → API → PostgreSQL product flow conflicts with the roadmap's explicit “no business feature claim” and with Slice 2's ownership of persistence/identity. This plan does not silently pull Slice 2–4 work into Slice 1. The first business flow follows later, after identity/event persistence is approved.

## 2. Scope

**Included:** establish only used frontend/backend workspaces; package/tool configuration with pinned lockfile; a single minimal browser bootstrap/diagnostic surface (not a Phase 1 product screen); API process liveness; startup-time validation of actual non-secret configuration; structured request/correlation logging with redaction; minimal unit/component/API smoke tests; GitHub Actions checks; README startup/stop/test instructions and environment example containing placeholders only. Do not create directories until their first real file is added.

**Not included:** PostgreSQL integration/Compose service or API database-readiness claim; User/Event/Registration or any other domain table; Prisma models/migrations/seed; accounts, OTP, roles, product API routes, feature pages, QR, scan/attendance/occupancy, Socket.IO server, alerts, forecast service/model, certificate worker/email/PDF, Kafka, production deployment, Grafana/Prometheus stack, UI library or chart library. Do not scaffold FastAPI merely to satisfy a stack diagram; it first has work in forecast Slice 8. No real participant data.

**Phase 1 coverage:** no functional requirement, user story, use case or screen is delivered. Slice 1 prepares partial evidence for `NFR-MAINT-001` (reviewable boundaries/dependencies), `NFR-SEC-001` (configuration/secrets and safe diagnostic surface), and `NFR-OBS-001` (request correlation). It does not claim full acceptance of those NFRs or `NFR-A11Y-001`; accessibility of the bootstrap is checked without claiming a core journey exists. See [requirements](../requirements/REQUIREMENTS.md) and [traceability](../requirements/TRACEABILITY.md).

## 3. End-to-end flow and boundary

1. Vite serves the minimal React bootstrap. The browser calls the public operational `GET /health/live` through the configured local API origin. The API assigns/returns a correlation ID, reports process availability and logs only safe diagnostics; React renders reachable, unavailable, and retry states.
2. There is no authentication/authorization context, PostgreSQL query, product response or real-time path in this slice. The response is process liveness **only**, not database/write readiness.
3. The first frontend → API → PostgreSQL and authenticated, event-scoped data flow belongs to later slices after the Slice 2 identity/persistence foundation. A failed health request must not expose hostnames, credentials, SQL or stack traces.

## 4. Domain model

**Entities/tables required now: none.** There are no business fields, relationships, lifecycle/status fields, owners or row-level authorization rules to model. PostgreSQL's own catalog is not an application domain model. Health is ephemeral process/dependency state, not a stored event or audit fact. Future `User`, `Event`, assignment and `AuditLog` foundations belong to Slice 2; registration, QR, attendance and occupancy belong to Slices 4–5 per the [database architecture](../architecture/DATABASE_ARCHITECTURE.md). Do not create empty Prisma models or placeholder entities.

## 5. Backend structure — files to create during implementation, not now

| Proposed file | Single responsibility |
| --- | --- |
| `backend/package.json`, `backend/tsconfig.json` | Minimal package scripts/dependencies and strict TypeScript compilation for the Express application. |
| `backend/src/config/env.ts` | Parse and validate only actual startup configuration (listen port and local allowed origin); fail startup safely for invalid required values. |
| `backend/src/config/logger.ts` | Configure Pino structured logging/redaction for operational messages without request bodies or secrets. |
| `backend/src/middleware/correlation.ts` | Establish an opaque request/correlation ID and response header; avoid trusting arbitrary unbounded client values. |
| `backend/src/app.ts` | Compose Express middleware and health routes without opening a network port or importing domain modules. |
| `backend/src/server.ts` | Start the HTTP listener and handle startup/shutdown/connection cleanup. |
| `backend/src/routes/health.ts` | Process-liveness endpoint with a coarse safe response only; no database/readiness claim. |
| `backend/src/routes/health.test.ts` | Supertest proof for healthy/failing diagnostics, correlation and non-disclosure. |

No database adapter, `modules/`, controller/service/repository scaffolds, auth middleware, websocket folder, or generic error framework yet. The root `package.json` gains only workspaces/scripts actually needed; lockfile and package-manager choice are recorded with the first installation in the later implementation turn.

Cross-cutting files when implementation begins: update root `package.json` for the two real workspaces and common checks; create the selected package-manager lockfile; add `.github/workflows/checks.yml` for install/type/lint/test/build; update `README.md` with verified commands; add `backend/.env.example` and `frontend/.env.example` only for configuration keys actually consumed. Existing `.gitignore` already excludes real `.env` files; change it only if generated output reveals a gap. Leave `docker-compose.yml` untouched in this slice.

## 6. Frontend structure — files to create during implementation, not now

| Proposed file | Single responsibility |
| --- | --- |
| `frontend/package.json`, `frontend/tsconfig.json`, `frontend/vite.config.ts`, `frontend/index.html` | Minimal Vite/React build, configuration and HTML entry. |
| `frontend/src/main.tsx` | Mount React once, without product routing or global state libraries. |
| `frontend/src/app/App.tsx` | Minimal developer diagnostic shell; text-first API availability with loading/error/retry and explicit “no product features yet” context. No Phase 1 screen ID is claimed. |
| `frontend/src/services/health.ts` | One bounded fetch adapter for the operational health response; no business API client abstraction or credential handling. |
| `frontend/src/styles.css` | Minimal readable system-font, spacing, focus and semantic status styling consistent with the [design-system foundation](../design/DESIGN_SYSTEM.md); no final palette claim. |
| `frontend/src/app/App.test.tsx` | React Testing Library smoke/accessibility-state test using a controlled health response. |

Server state is limited to the last health result; local UI state is retry/loading. No router, feature directories, shared component library, hooks/store or Socket.IO adapter is needed. An API failure displays **unavailable**, not “offline gate” or another product state.

## 7. API contract for Slice 1

These are operational diagnostics, outside the versioned business `/api/v1` contract in [API_CONTRACT.md](../api/API_CONTRACT.md). They do not represent product endpoints. The local browser may use them; deployment exposure must be reviewed before public hosting.

| Method/path | Access and request | Response | Validation/errors/idempotency |
| --- | --- | --- | --- |
| `GET /health/live` | No authentication/role; no body or query parameters. | `200` with only `status: alive` and opaque `correlation_id` (also in a response header). | Ignore extraneous query parameters without changing state; never include process internals/secrets. Read-only GET; repeated calls have no side effects or idempotency key. |

No `POST`, auth, event, registration, credential or audit endpoint is required. No idempotency key is needed for health GETs. The frontend must treat network timeout as unknown/unavailable, not a product decision.

## 8. Database plan

No PostgreSQL service, application tables, constraints, indexes, uniqueness rules, migrations, transactions or API database-readiness check in this slice. Those begin when Slice 2 has a real persistence use. Slice 1 does not establish registration uniqueness, capacity, cancellation, QR, attendance or occupancy correctness—those require schema and concurrency proofs in later slices. Do not create fake test tables or a speculative audit record to make this slice appear vertical.

## 9. Authentication and authorization

None is required for diagnostic boot/health. Public health output is strictly allowlisted and gives no user/event/participant data; CORS is limited to the configured local frontend origin. Do not implement a mock role, hard-coded Organizer, fake guest OTP or permissive business endpoint. Identity provider, session/cookie/CSRF and event-scoped RBAC remain Slice 2 decisions under [AUTH_RBAC_ARCHITECTURE.md](../security/AUTH_RBAC_ARCHITECTURE.md). If health is exposed beyond local/CI, deployment controls and information disclosure must be reviewed before that exposure.

## 10. Testing plan

| Layer | Slice 1 evidence |
| --- | --- |
| Unit | Config parser accepts valid local placeholders and rejects missing/invalid required values without echoing secrets; health status selection and correlation ID bounds. Vitest is the TypeScript tool direction. |
| API/integration | Supertest verifies liveness 200, safe response/header and no product routes; no real domain integration tests yet. |
| Database/concurrency | None is meaningful without schema or persistence operations. Explicitly defer last-slot registration, scan and occupancy concurrency. |
| Frontend | React Testing Library checks initial loading, reachable, API-unavailable and retry states, semantic status/focus, and no claim of product functionality. |
| End-to-end | One development smoke: clean clone → install selected minimal packages → start chosen dependencies/services → open bootstrap → see API status → stop API → see unavailable/retry → restart. Manual first; Playwright automation only if it earns its setup cost now or with first product journey. |
| Security/authorization | No authorization matrix yet. Check no secrets/config internals in health/headers/logs/bundle, local CORS restriction, no accidental business route, and no privileged-looking fake UI. |

CI runs formatting/lint/type/unit/build checks for workspaces that exist, plus backend API tests. Do not add PostgreSQL, pytest, Testcontainers, k6 or a FastAPI build job before they have work.

## 11. Acceptance checklist

- [ ] From a clean checkout, documented commands install only justified pinned packages and start the frontend and backend reproducibly on non-conflicting configurable ports.
- [ ] No PostgreSQL/Prisma setup or database-readiness claim is made; these are reserved for Slice 2.
- [ ] Browser bootstrap renders meaningful loading/available/unavailable states and makes no product capability claim.
- [ ] Liveness responds safely and includes a correlation ID; it is labeled as process liveness, not database/write readiness.
- [ ] Invalid/missing required configuration fails predictably without printing secrets.
- [ ] Type, lint/format, relevant tests and builds pass locally and in GitHub Actions from a clean checkout.
- [ ] No auth, domain endpoints, Prisma model/migration, FastAPI runtime, Socket.IO, business page or unrelated infrastructure is present.
- [ ] README documents startup, stop, tests, configuration placeholders, degraded cases and exact limitations; no real `.env`/secret is committed.
- [ ] Changed dependencies have explicit purpose, lockfile and reviewable versions; no generated build artifacts are committed.

## 12. Risks, deferred decisions and assumptions

**Handle now:** prevent process liveness from being described as database/write readiness; avoid leaking secrets or host internals through health, logs or Vite variables; keep CI and local commands consistent; avoid package/workspace sprawl. The absence of a contiguous DB request is explicit and intentional.

**Deferred by architecture:** identity/OTP/session provider and RBAC; Prisma models/migrations and transaction locks; product API paths; realtime revision protocol; QR/idempotency; capacity/cancellation/attendance projections; FastAPI model; PDF/email/job provider; deployment, workload/RPO/RTO, retention and final visual tokens. None blocks a truthful foundation slice.

**Validate before implementation:** package manager/Node runtime version and lockfile convention; availability of required local ports and GitHub Actions runner; a safe local frontend-to-API origin/configuration mechanism. Docker/PostgreSQL requirements are validated at Slice 2, not made prerequisites here. No library version or infrastructure service is assumed installed by this plan.

## 13. Recommended coding order (future work only)

1. Record the small package-manager/runtime decision; verify local prerequisites and confirm the accepted Slice 1 checklist.
2. Add root workspace scripts/lockfile and `backend/package.json`/TypeScript configuration; implement config validation and safe logger/correlation.
3. Add Express app, liveness route, server start/stop and its Supertest tests.
4. Add Vite/React entry, one diagnostic fetch adapter and minimal accessible bootstrap/status states with component tests.
5. Add only the local placeholder config example actually needed; update README with verified commands/failure behavior.
6. Add GitHub Actions checks for the now-existing workspaces; run clean-start, API-outage, tests, type/lint/build and secret/generated-artifact review. Do not start Slice 2 until this evidence passes.

## 14. Traceability

| Source | Slice 1 relationship |
| --- | --- |
| [ROADMAP_PHASE_2.md](../ROADMAP_PHASE_2.md), item 1; [ROADMAP.md](../ROADMAP.md), Phase 3 | Direct source for runnable foundation, health, configuration and CI. Slice 2/Phase 4 own persistence/identity. |
| [TECHNICAL_ARCHITECTURE.md](../architecture/TECHNICAL_ARCHITECTURE.md); [DEVELOPMENT_ENVIRONMENT.md](../architecture/DEVELOPMENT_ENVIRONMENT.md); [OBSERVABILITY.md](../architecture/OBSERVABILITY.md) | React/Express boundaries and safe process liveness/correlation; PostgreSQL readiness is deferred until the persistence slice. |
| [TEST_ARCHITECTURE.md](../testing/TEST_ARCHITECTURE.md); [DESIGN_SYSTEM.md](../design/DESIGN_SYSTEM.md) | Small relevant test layers and accessible semantic bootstrap states. |
| `NFR-MAINT-001`, `NFR-SEC-001`, `NFR-OBS-001`; [requirements](../requirements/REQUIREMENTS.md) | Partial enabling evidence only; full requirements remain open for later slices. |
| Phase 1 user stories, use cases, screen IDs in [TRACEABILITY.md](../requirements/TRACEABILITY.md) | **None implemented**; the bootstrap is a development diagnostic, not `S-PUB-*`, `S-ORG-*`, `S-GAT-01` or `S-VOL-01`. |

The brief cited `AUTH_RBAC_ARCHITECTURE.md`, `API_CONTRACT.md` and `TEST_ARCHITECTURE.md` under `docs/architecture/`; their actual repository locations are `docs/security/`, `docs/api/` and `docs/testing/` respectively. Those existing files were used; no duplicate documents are proposed.
