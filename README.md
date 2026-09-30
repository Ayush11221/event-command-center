# Real-Time Event Operations Command Center

A capstone project for operating live events with participant registration, QR-based identity, gate check-in/check-out, real-time occupancy, crowd forecasting, and auditable operational workflows.

The project exists to give event teams one trustworthy operational view instead of disconnected registration lists, manual gate counts, and delayed post-event reports. Forecasts are advisory: staff remain responsible for operational decisions.

## Current status

**Phase 1: product definition and UX architecture, in progress.** Phase 0 foundation is committed. The Phase 1 specifications are working documents for review; no application features, services, database schema, or user interface have been implemented. Technology choices remain planned or provisional until validated in the relevant roadmap phase.

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
- **Real-time delivery:** WebSocket or Server-Sent Events, to be selected from concrete command-center needs
- **Event streaming:** Kafka when the real-time phase demonstrates a justified need; not part of initial foundation work
- **Forecasting:** a bounded Python/FastAPI service using explainable baseline methods and scikit-learn where justified
- **Operations:** containerized local environments, structured logs, metrics, and traces; exact deployment platform is TBD

The authoritative technical boundaries are in [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md).

## Repository structure

```text
.
|-- .codex/                    # Project-scoped Codex/Graphify configuration
|-- .github/workflows/         # CI/CD workflows, added when justified
|-- frontend/                  # Planned React + TypeScript application
|-- backend/                   # Planned Node.js + TypeScript + Express API
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
|-- package.json               # Private monorepo metadata; no packages or scripts yet
`-- README.md                  # Project entry point
```

Only the top-level architectural boundaries exist today. Deeper source trees are created when they gain real code; the intended layout is documented in [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md).

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

Phase 1 product specifications: [personas](docs/requirements/PERSONAS.md), [user stories](docs/requirements/USER_STORIES.md), [use cases](docs/requirements/USE_CASES.md), [event lifecycle](docs/requirements/EVENT_LIFECYCLE.md), [role permissions](docs/requirements/ROLE_PERMISSION_MATRIX.md), [MVP scope](docs/requirements/MVP_SCOPE.md), [traceability](docs/requirements/TRACEABILITY.md), and [open product decisions](docs/requirements/OPEN_PRODUCT_DECISIONS.md).

Phase 1 UX architecture: [user journeys](docs/design/USER_JOURNEYS.md), [information architecture](docs/design/INFORMATION_ARCHITECTURE.md), [screen inventory](docs/design/SCREEN_INVENTORY.md), [UX states](docs/design/UX_STATES.md), and [decision dependencies](docs/design/UX_DECISION_DEPENDENCIES.md).

Traceability flows from **PRD -> Requirements -> Architecture/API/Database -> Testing**, with security and design concerns applied across the chain.

## Planned delivery phases

0. Project foundation and documentation
1. Product definition and UX architecture
2. Design system and UI direction
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

There is no application runtime to start yet. Setup commands will be added only after the stack is initialized and verified. Do not infer implementation readiness from the planning documents.

## Decision policy

- Product uncertainty is recorded as TBD rather than silently resolved.
- New dependencies require a concrete need and an owner.
- Documentation must be updated when an implemented contract differs from the plan.
- Security-sensitive behavior and operational claims require explicit reasoning and verification.
