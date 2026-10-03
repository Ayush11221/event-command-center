# Real-Time Event Operations Command Center

A capstone project for operating live events with participant registration, QR-based identity, gate check-in, real-time occupancy, advisory crowd forecasting, and auditable operational workflows.

The project exists to give event teams one trustworthy operational view instead of disconnected registration lists, manual gate counts, and delayed post-event reports. Forecasts are advisory: staff remain responsible for operational decisions.

## Current status

**Slices 1–11 are committed; Slice 12 adds cross-cutting deployment and release evidence.** The finalized [API contract](docs/api/API_CONTRACT.md) governs implemented behavior. Checkout/re-entry, attendance corrections, product alerts, Kafka and speculative horizontal scaling are outside this release boundary. This is a synthetic, single-instance capstone demonstration, not a production-readiness claim.

See the [deployment/demo runbook](docs/implementation/SLICE_12_RUNBOOK.md), [release evidence matrix](docs/testing/SLICE_12_RELEASE_EVIDENCE.md), and [release security review](docs/security/SLICE_12_SECURITY_REVIEW.md) for reproducible commands, measured results and remaining risks.

## Product capabilities and release boundary

- Event creation, configuration, publication, and lifecycle management
- PUBLIC/PRIVATE event access, verified account or guest-OTP registration, cancellation, and unique opaque QR credentials
- Gate configuration, QR validation, duplicate-scan handling, and accepted check-in
- Live attendance, occupancy, capacity, and gate-activity monitoring
- Advisory crowd forecasts with uncertainty and chronological baseline evaluation
- Role-based access for organizers, event admins, gate/security staff, volunteers, and participants
- Accepted-check-in certificates with built-in-template preview, bulk unique-ID PDFs, and tracked/retryable platform-email delivery
- Audit search, volunteer tasks, and factual post-event results; product alerts remain outside this release

See the [PRD](docs/PRD.md) for scope boundaries and product requirements.

## Planned architecture

The initial direction is a modular web application rather than an early collection of microservices:

- **Web client:** React and TypeScript
- **UI foundation:** Tailwind CSS, shadcn/ui, and Lucide React; Motion only where interaction feedback benefits
- **Application API:** Node.js, TypeScript, and Express
- **Primary data store:** PostgreSQL, with Prisma as the planned data-access layer
- **Real-time delivery:** Socket.IO/WebSocket is the Phase 2 live-transport direction, with authoritative API snapshot reconciliation
- **Event streaming:** Kafka when the real-time phase demonstrates a justified need; not part of initial foundation work
- **Forecasting:** a bounded Python/FastAPI service using explainable baseline methods and scikit-learn where justified
- **Operations:** containerized local environments, structured logs, metrics, and traces; exact deployment platform is TBD

The authoritative technical boundaries are in [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md).

## Repository structure

```text
.
|-- .codex/                    # Project-scoped Codex/Graphify configuration
|-- .github/workflows/         # Regression and manual release verification
|-- frontend/                  # Implemented participant and staff journeys
|-- backend/                   # Express authorization and domain API
|-- ai-service/                # Private FastAPI baseline forecasting service
|-- database/                  # Prisma schema and nine reviewed migrations
|-- tests/                     # Cross-system integration, E2E, load, and security tests
|-- docs/
|   |-- api/                   # Planned API contracts and conventions
|   |-- architecture/          # System and data architecture plans
|   |-- design/                # Design-system direction
|   |-- requirements/          # Traceable product requirements
|   |-- security/              # Security and privacy plan
|   |-- testing/               # Test strategy
|   |-- PRD.md                 # Product-level source of truth
|   `-- ROADMAP.md             # Delivery phases and exit criteria
|-- docker/                    # Component Docker configuration when services exist
|-- scripts/                   # Purpose-built developer/database/test automation
|-- monitoring/                # Private metrics/traces operating guidance
|-- AGENTS.md                  # Concise repository working rules
|-- docker-compose.yml         # Single-instance HTTPS demo deployment
|-- package.json               # Private npm workspace scripts and tooling
|-- package-lock.json          # Reproducible npm dependency lockfile
`-- README.md                  # Project entry point
```

The intended boundaries are documented in [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md). Deployment files and release harnesses now live under docker, scripts and tests/release.

## Documentation map

| Document                                                            | Purpose                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [PRD](docs/PRD.md)                                                  | Product vision, users, scope, journeys, outcomes, assumptions, and risks |
| [Requirements](docs/requirements/REQUIREMENTS.md)                   | Traceable functional and non-functional requirements                     |
| [Architecture](docs/architecture/ARCHITECTURE.md)                   | System boundaries, data flow, and architectural decisions                |
| [Database plan](docs/architecture/DATABASE_PLAN.md)                 | Conceptual data model, integrity, privacy, and migration approach        |
| [API plan](docs/api/API_PLAN.md)                                    | Planned API resources, real-time events, and contract conventions        |
| [Security plan](docs/security/SECURITY_PLAN.md)                     | Threats, controls, privacy, and security verification                    |
| [Test strategy](docs/testing/TEST_STRATEGY.md)                      | Test layers, environments, quality gates, and failure testing            |
| [Design system](docs/design/DESIGN_SYSTEM.md)                       | UX principles and provisional UI technology direction                    |
| [Roadmap](docs/ROADMAP.md)                                          | Sequenced phases and completion criteria                                 |
| [Phase 2 architecture](docs/architecture/TECHNICAL_ARCHITECTURE.md) | Implementation boundaries and links to detailed Phase 2 contracts        |
| [Phase 2 vertical slices](docs/ROADMAP_PHASE_2.md)                  | Dependency-oriented implementation handoff after approval                |

Phase 1 product specifications: [personas](docs/requirements/PERSONAS.md), [user stories](docs/requirements/USER_STORIES.md), [use cases](docs/requirements/USE_CASES.md), [event lifecycle](docs/requirements/EVENT_LIFECYCLE.md), [role permissions](docs/requirements/ROLE_PERMISSION_MATRIX.md), [MVP scope](docs/requirements/MVP_SCOPE.md), [traceability](docs/requirements/TRACEABILITY.md), and [open product decisions](docs/requirements/OPEN_PRODUCT_DECISIONS.md).

Phase 1 UX architecture: [user journeys](docs/design/USER_JOURNEYS.md), [information architecture](docs/design/INFORMATION_ARCHITECTURE.md), [screen inventory](docs/design/SCREEN_INVENTORY.md), [UX states](docs/design/UX_STATES.md), and [decision dependencies](docs/design/UX_DECISION_DEPENDENCIES.md).

Traceability flows from **PRD -> Requirements -> Architecture/API/Database -> Testing**, with security and design concerns applied across the chain.

## Planned delivery phases

0. Project foundation and documentation
1. Product definition and UX architecture
2. Technical architecture and design foundation
3. Backend foundation
4. Database, authentication, and RBAC
5. Participant registration and QR identity
6. Gate scanning and check-in
7. Real-time command center
8. Crowd forecasting/AI service
9. Certificates, audit, and reporting
10. Testing, security, load, and failure testing
11. Observability, deployment, and CI/CD
12. Final integration, documentation, and capstone demonstration

The canonical phase numbering and exit criteria are maintained in the [roadmap](docs/ROADMAP.md).

## Development setup

Deployment instructions: [local Slice 12 runbook](docs/implementation/SLICE_12_RUNBOOK.md) and [Railway deployment adaptations](docs/implementation/RAILWAY_DEPLOYMENT.md). Railway has not been deployed or verified remotely; existing release/security limitations still apply.

Slice 2 uses Node.js 22.12.0/npm 10.9.0, npm workspaces, and PostgreSQL 16 for the first persistence boundary. No external identity provider is used. `GET /health/live` remains process liveness only; `GET /health/ready` checks database access.

1. From the repository root, run `npm ci` (or `npm install` when deliberately updating the lockfile).
2. Start a disposable local PostgreSQL 16 database. Copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to `frontend/.env`; fill in the local database URL and three independent randomly generated 32-byte hex keys. Real `.env` files are ignored by Git. The defaults use backend `http://127.0.0.1:3000` and frontend `http://127.0.0.1:5173`.
3. Set `DATABASE_URL` in the root shell, run `npm run db:generate` and `npm run db:migrate`, then start `npm run dev:backend` and `npm run dev:frontend` in separate terminals. Open `http://127.0.0.1:5173`. Root database scripts do not read `backend/.env` automatically.

`GET http://127.0.0.1:3000/health/live` reports process liveness, while `/health/ready` reports database reachability without connection details. The frontend retains the Slice 1 process check and adds minimal account/guest OTP proof. Account sign-in requires a verified contact already provisioned by the controlled bootstrap command; no public account signup exists. Email delivery requires local SMTP configuration. Phone delivery requires `SMS_GATEWAY_MODULE` set to an absolute local path to an operator-provided ESM module whose default export has an async `sendSms(destination, message)` method. The Android gateway's wire protocol remains outside this application boundary; without an adapter, phone challenges fail with a generic dependency-unavailable response for every contact. Challenge acceptance means pending delivery, not confirmed receipt. Do not use real contact data until retention, key management, and deployment controls are reviewed. Only `VITE_API_ORIGIN` is browser-exposed; never put secrets in a `VITE_` variable.

From the root, `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` run local checks. Set `TEST_DATABASE_URL` to a disposable migrated PostgreSQL database to include the integration suite; without it, only those integration tests skip. GitHub Actions provisions PostgreSQL, applies the migration, and runs the full suite. A built backend can be started with `npm run start --workspace=backend` after setting its environment variables; the development script loads the ignored `backend/.env` if present.

Slice 2 routes under `/api/v1/auth` are `POST /account/challenge`, `POST /account/verify`, `POST /guest/challenge`, `POST /guest/verify`, `GET /guest/self`, `GET /me`, and `POST /logout`. Fixture-backed staff scope routes are `GET/POST /api/v1/events/:eventId/assignments`, `DELETE /api/v1/events/:eventId/assignments/:assignmentId`, and the minimal `GET /api/v1/events/:eventId/gates/:gateId/scope` authorization proof. These routes cannot create events or gates. Account JWTs are HttpOnly cookies backed by persisted Sessions; mutating authenticated routes require the current session's CSRF token from `/me` and the configured Origin. The controlled `npm run bootstrap --workspace=backend -- --confirm` command additionally requires `BOOTSTRAP_APPROVED=yes`, `BOOTSTRAP_CONTACT_TYPE`, `BOOTSTRAP_CONTACT_VALUE`, and `BOOTSTRAP_ORGANIZER=yes|no` in its environment; use only approved synthetic/local contacts during development.

An existing user's Organizer capability can be changed only through the controlled `npm run capability --workspace=backend -- --confirm` command with `CAPABILITY_APPROVED=yes`, `CAPABILITY_USER_ID`, and `CAPABILITY_ENABLED=yes|no`. Both administrative commands require protected database/key configuration and write durable audit evidence atomically with the change; neither is a public API.

The [Slice 2 plan](docs/implementation/SLICE_2_PLAN.md) describes the historical identity foundation. Subsequent implemented journeys are governed by the finalized [API contract](docs/api/API_CONTRACT.md); release verification and exclusions are recorded in the Slice 12 evidence matrix.

## Decision policy

- Product uncertainty is recorded as TBD rather than silently resolved.
- New dependencies require a concrete need and an owner.
- Documentation must be updated when an implemented contract differs from the plan.
- Security-sensitive behavior and operational claims require explicit reasoning and verification.
