# Phase 2 Development Environment

**Status:** planned setup, not runnable. Current root [package.json](../../package.json) has no workspace/dependencies and [docker-compose.yml](../../docker-compose.yml) intentionally has no services. Do not infer startup commands from this document.

| Component | Local role and conceptual binding | Dependency/readiness |
| --- | --- | --- |
| Vite frontend | Developer browser endpoint, e.g. localhost `5173`; API/live base URL from non-secret config. | Can start alone with explicit unavailable API states. |
| Express backend | Developer API/live endpoint, e.g. localhost `3000`; validates config before serving. | PostgreSQL required for write readiness; forecast/email optional features report degraded. |
| PostgreSQL | Local isolated database, e.g. localhost `5432` only when direct host access needed. | Migrations/seed later; no real data or shared production credentials. |
| FastAPI AI service | Internal/dev endpoint, e.g. localhost `8000`; optional for core registration/scan development. | Own health; backend times out/degrades forecast only. |
| Supporting worker/artifact/mail/monitoring | Add only with certificate/observability slices; local fake/sink adapters are preferable for tests. | Never mandatory merely because listed in architecture. |

These ports are examples, not reserved or configured. Future Compose adds only real runnable services, named networks, explicit health checks and startup dependency on **readiness**, not container creation order. Suggested sequence once implemented: database healthy → migrations applied → backend ready → frontend; AI service may start independently; certificate worker only after durable job schema exists. Liveness reports process status; readiness checks required dependencies without exposing secrets and distinguishes optional degraded capabilities. CI uses isolated disposable database and synthetic fixtures.

Configuration categories: `DATABASE_URL`, public frontend API/live origin, backend listen port and allowed origins, session/OTP provider credentials, QR verifier secret/key material, internal forecast URL/auth/timeout, artifact store, mail sender/provider/Reply-To policy, logging/telemetry endpoints. These are **conceptual keys**, not a committed `.env.example` contract. Final names and validation appear with the owning service. Use local ignored env/secret facilities, CI/deployment secret stores, least-privilege credentials and environment-specific databases; never commit real secrets or expose them in Vite-public variables, logs or browser bundles. Production requires TLS, managed secrets, backup/restore, retention and RPO/RTO choices before deployment; exact platform is deferred.
