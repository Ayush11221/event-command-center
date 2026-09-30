# Real-Time Event Operations Command Center

A capstone project for operating live events with participant registration, QR-based identity, gate check-in/check-out, real-time occupancy, crowd forecasting, and auditable operational workflows.

The project exists to give event teams one trustworthy operational view instead of disconnected registration lists, manual gate counts, and delayed post-event reports. Forecasts are advisory: staff remain responsible for operational decisions.

## Current status

**Slice 1: runnable repository/tooling foundation, in progress.** Phase 1 product/UX decisions were approved and committed at `3cd972b`. The Phase 2 architecture and Slice 1 plan guide this minimal developer bootstrap. No event, registration, gate, database, authentication, or other product workflow has been implemented.

## Planned capabilities

- Event creation, configuration, publication, and lifecycle management
- PUBLIC/PRIVATE event access, verified account or guest-OTP registration, cancellation, and unique opaque QR credentials
- Gate configuration, QR validation, duplicate-scan handling, and check-in/check-out
- Live attendance, occupancy, capacity, and gate-activity monitoring
- Crowd forecasts with uncertainty and historical comparisons
- Role-based access for organizers, event admins, gate/security staff, volunteers, and participants
- Accepted-check-in certificates with built-in-template preview, bulk unique-ID PDFs, and tracked/retryable platform-email delivery
- Audit trails, operational alerts, and post-event reporting

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
|-- .github/workflows/         # Slice 1 verification workflow
|-- frontend/                  # React + TypeScript diagnostic bootstrap
|-- backend/                   # Node.js + TypeScript + Express liveness API
|-- ai-service/                # Planned Python + FastAPI forecasting service
|-- database/                  # Planned PostgreSQL/Prisma assets
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
|-- monitoring/                # Future metrics/dashboard configuration
|-- AGENTS.md                  # Concise repository working rules
|-- docker-compose.yml         # Valid placeholder; currently defines no services
|-- package.json               # Private npm workspace scripts and tooling
|-- package-lock.json          # Reproducible npm dependency lockfile
`-- README.md                  # Project entry point
```

Only the frontend and backend Slice 1 source trees are now populated. Other top-level boundaries remain empty until they gain real work; the intended layout is documented in [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md).

## Documentation map

| Document | Purpose |
| --- | --- |
| [PRD](docs/PRD.md) | Product vision, users, scope, journeys, outcomes, assumptions, and risks |
| [Requirements](docs/requirements/REQUIREMENTS.md) | Traceable functional and non-functional requirements |
| [Architecture](docs/architecture/ARCHITECTURE.md) | System boundaries, data flow, and architectural decisions |
| [Database plan](docs/architecture/DATABASE_PLAN.md) | Conceptual data model, integrity, privacy, and migration approach |
| [API plan](docs/api/API_PLAN.md) | Planned API resources, real-time events, and contract conventions |
| [Security plan](docs/security/SECURITY_PLAN.md) | Threats, controls, privacy, and security verification |
| [Test strategy](docs/testing/TEST_STRATEGY.md) | Test layers, environments, quality gates, and failure testing |
| [Design system](docs/design/DESIGN_SYSTEM.md) | UX principles and provisional UI technology direction |
| [Roadmap](docs/ROADMAP.md) | Sequenced phases and completion criteria |
| [Phase 2 architecture](docs/architecture/TECHNICAL_ARCHITECTURE.md) | Implementation boundaries and links to detailed Phase 2 contracts |
| [Phase 2 vertical slices](docs/ROADMAP_PHASE_2.md) | Dependency-oriented implementation handoff after approval |

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

Slice 1 uses the installed Node.js 22.12.0/npm 10.9.0 convention and npm workspaces. It does not require Docker, PostgreSQL, Prisma, or an identity provider. The health check is **process liveness only**; it does not imply database/write readiness or any product capability.

1. From the repository root, run `npm ci` (or `npm install` when deliberately updating the lockfile).
2. Copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to `frontend/.env`. The examples contain only the local port and origins. Real `.env` files are ignored by Git. The defaults use backend `http://127.0.0.1:3000` and frontend `http://127.0.0.1:5173`.
3. In separate terminals, run `npm run dev:backend` and `npm run dev:frontend`. Open `http://127.0.0.1:5173`.

`GET http://127.0.0.1:3000/health/live` returns only `status: alive` and an opaque correlation ID in the JSON body and `x-correlation-id` header. It is public and has no domain data. The frontend shows **Checking**, **Available**, or **Unavailable** for that process; if the backend stops, select **Retry check** to observe the unavailable state, then restart the backend and retry to see recovery. It does not poll automatically. A missing/invalid backend port or frontend origin fails startup with a safe configuration message; a missing/invalid `VITE_API_ORIGIN` leaves the frontend in the unavailable state. Only `VITE_API_ORIGIN` is browser-exposed; do not put secrets in any `VITE_` variable.

From the root, `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` run the local checks. `npm run format` formats only Slice 1 implementation files. A built backend can be started with `npm run start --workspace=backend` after setting its two environment variables; the development script loads the ignored `backend/.env` if present. GitHub Actions runs `npm ci` and the same checks. Stop each development process with Ctrl+C.

The [Slice 1 plan](docs/implementation/SLICE_1_PLAN.md) defines the boundary: this is a developer/system bootstrap, **not** a user-facing Event Command Center screen. PostgreSQL and application readiness, role-scoped data, and product API routes begin only in later slices.

## Decision policy

- Product uncertainty is recorded as TBD rather than silently resolved.
- New dependencies require a concrete need and an owner.
- Documentation must be updated when an implemented contract differs from the plan.
- Security-sensitive behavior and operational claims require explicit reasoning and verification.
