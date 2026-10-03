# Slice 12 release evidence

Baseline `54102e2`; synthetic Docker Desktop single-instance verification, 2026-10-04. Sources: `docs/ROADMAP_PHASE_2.md` Slice 12, PRD, requirements, testing/security strategies and the finalized Slice 1–11 API contract, constrained by the approved Slice 12 implementation request. Broader requirements are not authority to add explicitly excluded features.

Statuses are **PASS**, **DEFERRED / OUT OF SCOPE**, **NOT MET**, **NOT MEASURED**. PASS always refers to the evidence's stated scope. Ignored machine artifacts are reproducible through `tests/release/` and the runbook; no credentials/backups are committed.

## Requirement → implementation → verification → evidence → status

| Requirement                                                             | Implementation / verification                                                                                                                                                                        | Evidence artifact                                           | Status                              |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------- |
| Reproducible deployment, HTTPS/origin/secrets                           | Pinned Dockerfiles, one-shot migrator, separate runtime role, private AI/DB, edge TLS, secret files; real build/start/restart and negative config checks                                             | Docker startup; `security.json`; config tests; runbook      | PASS                                |
| Health/readiness and optional-service isolation                         | Existing public health schemas unchanged; PostgreSQL down produces not-ready, AI timeout/outage leaves core API usable                                                                               | `failure.json`                                              | PASS                                |
| NFR-PERF-001 QR p95 ≤2s                                                 | 100 users, 20 concurrent accepted scans; real HTTPS API, ledger/replay integrity                                                                                                                     | `load.json`                                                 | PASS for measured run               |
| NFR-PERF-002 propagation p95 ≤5s                                        | 20 socket clients, server decision time through client REST-confirmed revision; 400 conservative observations                                                                                        | `load.json`                                                 | PASS for measured run               |
| NFR-REL-001/002 attendance durability/retry                             | API/DB/socket/AI interruptions, accepted ledger and same-key replay; full PostgreSQL concurrency tests                                                                                               | `failure.json`; backend tests                               | PASS                                |
| Certificates/batches/delivery recovery                                  | Kill API after durable batch acceptance; resume six items; unique certificates/PDF hashes; existing real TCP SMTP definite/ambiguous, fencing, UNKNOWN hold, bounded retry, revocation/SENDING tests | `failure.json`; certificate/delivery PostgreSQL suites      | PASS                                |
| Backup/restore integrity and no blind external effects                  | Custom archive checksum, new isolated target, full-row table hashes and PDF SHA256; no workers started                                                                                               | `restore.json`; `restore-integrity.json`                    | PASS for isolated restore           |
| RPO ≤15min / RTO ≤30min                                                 | Measured snapshot age and isolated database restore/integrity duration; ten-minute backup loop provided                                                                                              | `restore.json`; final measured table below                  | PASS for isolated measured recovery |
| Whole-application SMTP-safe restore/cutover; sustained backup schedule  | Quarantine/reconciliation procedure documented; no automatic worker resumption                                                                                                                       | Runbook                                                     | NOT MEASURED                        |
| NFR-SEC-001 negative auth/RBAC/CSRF/origin/secret/DB/telemetry controls | Existing domain tests plus release security/config/Python negative tests; npm audit                                                                                                                  | `security.json`; test output; security review               | PASS for tested controls            |
| Dependency release gate                                                 | Runtime image scans; removed vulnerable development/package-manager tools; PostgreSQL library advisory remains unresolved                                                                            | `*-security.sarif`; security review                         | NOT MET                             |
| NFR-OBS-001 correlation/logs/metrics/traces                             | Bounded Pino telemetry, protected metrics, OTel HTTP/PG/forecast/recovery spans, correlated internal AI logs; failure-independent tests                                                              | telemetry tests; runtime logs; monitoring README            | PASS for local telemetry            |
| NFR-OBS-002 / FR-LIVE-003 stale/degraded UI                             | Existing freshness/forecast unavailable states and browser/domain tests                                                                                                                              | browser screenshots; frontend/backend suites                | PASS                                |
| NFR-A11Y-001 implemented major surfaces                                 | Axe WCAG 2.2 AA checks, desktop/mobile, both themes; skip link/focus/reflow/browser errors; existing flow/error tests                                                                                | `browser.json`; screenshots                                 | PASS for tested scope               |
| Universal WCAG conformance / screen-reader speech                       | No universal claim; semantic checks do not prove assistive-technology speech                                                                                                                         | Scope limitation                                            | NOT MEASURED                        |
| NFR-MAINT-001 contracts/migrations/dependencies                         | Public contract/Prisma/migrations unchanged; nine existing migrations and migration tests; eight OpenAPI files parse/ref validation; build/lint/typecheck                                            | Regression output; `validate-openapi.mjs`; final Git review | PASS                                |
| NFR-AUD-001 / FR-AUD-001/002                                            | Existing append-oriented privileged/scan audit and restricted/audited search                                                                                                                         | PostgreSQL audit/search tests; restore full-row comparison  | PASS                                |
| NFR-SCALE-001 multi-instance scaling                                    | Only single-instance and 100-user workload measured; no cross-instance socket/worker claims                                                                                                          | Explicit limitation                                         | DEFERRED / OUT OF SCOPE             |
| NFR-PRIV-001 real-data retention/export/deletion                        | Synthetic fixtures; protected secrets/backups/telemetry, real-data policy not reopened                                                                                                               | Runbook/security review                                     | DEFERRED / OUT OF SCOPE             |

## Railway adaptation verification — 2026-10-04

This is **local synthetic simulation**, not a Railway deployment. Earlier measurements below remain historical local Compose evidence. The [Railway runbook](../implementation/RAILWAY_DEPLOYMENT.md) defines the separate deployment mode and variables. No API/schema/migration SQL or Slice 1–11 domain semantics changed during the Railway adaptation task; the earlier Slice 12 candidate was retained.

| Check | Result / evidence |
| --- | --- |
| Focused migration configuration/failure/rollback tests | **PASS**, 4 Node tests in `tests/deployment/migration.test.mjs` |
| Python / forecast entry constraints | **PASS**, 37 tests, including 10 new deployment-entry cases; disposable Python 3.13 container; one upstream Starlette/httpx deprecation warning |
| Full PostgreSQL backend regression | **PASS**, 681 tests / 54 files, serial run against isolated migrated `eoc_railway_test`; `.artifacts/railway/backend-tests.log` |
| Frontend regression | **PASS**, 384 tests / 35 files; `.artifacts/railway/frontend-tests.log` |
| Builds / static checks | **PASS**, backend/frontend builds, lint, typecheck, root formatting plus focused deployment-file formatting, Prisma validation, 8 OpenAPI reference validations |
| Nine unchanged migrations | **PASS**, fresh disposable database and dedicated migration image; repeat deployment retained attendance records and restricted runtime permissions; migration tooling includes system OpenSSL |
| Local development | **PASS**, actual TS backend readiness and Vite HTTP browser sign-in surface; no page errors |
| Existing local Compose | **PASS**, all services healthy, original loopback forecast and Caddy TLS; existing security harness and new `tests/deployment/proxy.mjs` |
| Railway-compatible Docker mode | **PASS**, independent private forecast HTTPS, bearer health, HTTP frontend PORT, separate synthetic TLS edge; no host API/forecast ports; test-only loopback DB overlay |
| API / Socket.IO proxy | **PASS** in both Docker modes: exact security headers, SPA fallback, health, internal denial, anonymous/scope/CSRF/Origin negatives, websocket subscription, accepted scan notification with REST-confirmed revision and replay |
| Private service TLS | **PASS**, `tests/deployment/private-tls.mjs`: valid CA + DNS + bearer, missing/wrong bearer 401, missing trust and wrong hostname rejected, actual forecast client succeeds and retains MODEL_UNAVAILABLE for transport/auth failure |
| Frontend build origin | **PASS**, alternate Docker build with synthetic HTTPS origin; runtime VITE_API_ORIGIN did not change the already-built bundle |
| Browser / accessibility in simulated Railway mode | **PASS**, 44 surface/viewport/theme checks, zero axe violations and page errors; `.artifacts/railway/browser-tests.log`, screenshots under ignored `.artifacts/release/browser/`; existing test-only local-CA browser exception, Node separately verifies trust |
| Git / protected files | **PASS**, four protected docs hash-identical and untracked; no staged changes; no credentials or PKI added to candidate; no dependencies added to package manifests/lockfile by this task |
| Actual Railway environment | **NOT MEASURED**, private DNS/dual-stack, domain routing, volume upload/ownership, service restarts/draining, SMTP egress/provider, managed backup/restore and remote CI |

Initial concurrent backend/build verification had 675 passes and 6 failures (five five-second timeouts and one authority assertion). The identical serial backend suite then passed all 681, without changing tests, timeout limits or application code. Initial synthetic test CA lacked a signing key-usage extension required by Python 3.13 strict verification; the fixture was corrected and the stack and negative TLS checks passed. Certificate verification was not weakened.

Railway's managed PostgreSQL image is not the locally scanned PostgreSQL image: neither vulnerability inheritance nor remediation is claimed. The existing public/real-data security release gate remains **NOT MET**, pending review of the actual deployment candidate/provider and the already recorded risk disposition. SMTP requires the documented plan/provider prerequisite; UNKNOWN/revocation/retry behavior is unchanged and covered by the full backend suite. Railway RPO/RTO and SMTP-safe cutover are not certified by earlier local results.

The task adds 11 files and updates 10 existing candidate files (21 files total); deployment fixtures and the Railway runbook are additions to the original Slice 12 list. Protected documents are excluded. AST Graphify update passed; migration SQL was verified directly because its optional SQL parser is unavailable.

## Existing functional coverage (original Slice 12 verification)

| Requirements                                               | Finalized implementation and verification                                                                                                                              | Status                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| FR-EVT-001–005, FR-DISC-001                                | Event/lifecycle/gates/private proof, allowlists and scoped staff; existing PostgreSQL/frontend/legacy browser tests                                                    | PASS                                 |
| FR-REG-001–005, FR-QR-001/002/004                          | Verified account/guest ownership, cap/cancellation, opaque/revoked/expired credentials; domain negative/concurrency tests                                              | PASS                                 |
| FR-QR-003 standalone credential reissue                    | Cancellation/new registration invalidates the old credential; no finalized same-registration reissue endpoint is introduced                                            | DEFERRED / OUT OF SCOPE              |
| FR-SCAN-001–005, FR-ATT-001                                | Accepted check-in, immutable scan/replay ledger, hold on technical failure; scan/API load and failure tests                                                            | PASS                                 |
| FR-ATT-002/003                                             | Checkout/re-entry and attendance corrections explicitly excluded by Slice 12; no new states or reset                                                                   | DEFERRED / OUT OF SCOPE              |
| FR-LIVE-001–003                                            | Occupancy distinct from registration cap, attendance revision, authenticated socket and REST gap reconciliation                                                        | PASS                                 |
| FR-ALERT-001/002                                           | Product alerts explicitly excluded; telemetry is not a fourth product alert category                                                                                   | DEFERRED / OUT OF SCOPE              |
| FR-ANL-001, FR-VOL-001, FR-RBAC-001/002                    | Completed factual results, one-volunteer terminal lifecycle/current binding, least privilege; Slice 11 suites and browser flows                                        | PASS                                 |
| FR-ANL-002                                                 | Cross-event comparisons are not Slice 11 factual results and are not added here                                                                                        | DEFERRED / OUT OF SCOPE              |
| FR-FCST-001–005                                            | Accepted attendance, only 30/60 minutes, explicit fresh/stale/unavailable persisted attempts, uncertainty and chronological baseline evaluation; Python/backend tests  | PASS for finalized baseline contract |
| Forecast usefulness on representative held-out real events | Synthetic demo history is not production forecast accuracy evidence                                                                                                    | NOT MEASURED                         |
| FR-CERT-001–008                                            | Final Slice 9/10 issue/revoke/preview/PDF/batch/delivery/retry/UNKNOWN/ownership contracts and tests; final contract supersedes broad earlier reissue/Reply-To wording | PASS for finalized contract          |
| Certificate reissue / organizer Reply-To                   | One certificate per registration; platform From, no organizer Reply-To; not reopened                                                                                   | DEFERRED / OUT OF SCOPE              |

## Measured environment and results

Docker Desktop Linux containers on a Windows host; workload generator on the same host, loopback HTTPS, one Node API, one PostgreSQL, internal FastAPI. DB pool max 25, API OTel sampling 10%. Docker Desktop memory allowance approximately 5.79 GiB. This is a short empirical run, not soak testing, a production capacity guarantee or horizontal scaling evidence. The initial pool-10 run exceeded QR p95 (2190.97 ms) and had two normal API errors; bounded pool configuration was adjusted to 25 and the identical workload was repeated. See final measured artifacts; do not replace failed-run history with an unqualified claim.

Final percentile/resource/restore values are recorded below after the last verification run. Throughput is calculated over each workload window, not extrapolated. Propagation uses the final confirmed revision as a conservative upper bound for coalesced transitions; it includes REST confirmation, not only socket arrival. Same-host wall-clock timing and twenty scan samples limit statistical generalization.

## Final measurements and check results

Final load duration: **17.22 seconds**, 100 simultaneous distinct synthetic users (20 dashboard clients + 80 paced API users), 100 concurrent registration requests, 20 concurrent accepted scans, 800 normal API requests, 40 forecast requests and 400 client-confirmed propagation observations. All workload errors and propagation misses: **0**.

| Workload             |  p50 ms |      p95 ms |  p99 ms | Requests/s over workload window |
| -------------------- | ------: | ----------: | ------: | ------------------------------: |
| Registration burst   | 1272.74 |     1912.05 | 1974.93 |                           49.80 |
| Normal API           |  470.89 |      953.91 | 1261.62 |                           65.94 |
| Forecast             |  313.52 |     1572.02 | 2034.61 |                            3.31 |
| QR/check-in          | 1162.08 | **1370.37** | 1387.54 |                           14.39 |
| Realtime propagation | 1314.12 | **1624.92** | 2352.81 | Not a request-throughput metric |

Docker resource samples: API maximum CPU 100.95% (approximately one core, not percentage of the entire host), memory 106.1–213.3 MiB; PostgreSQL maximum CPU 52.65%, memory 113.2–131.8 MiB. These are sampled process/container resource observations, not proof of database query saturation or a sustained utilization ceiling.

Final backup `eoc-20261003T191214Z.dump`: observed recovery point age **1.003 seconds**; isolated database restore **1.786 seconds**; integrity comparison **0.513 seconds** (approximately **2.30 seconds combined**). All 22 table comparisons matched, 24 certificate PDF hashes verified and 124 accepted INSIDE transitions reconciled. Workers were never started against `eoc_restore_release`. The ≤15-minute/≤30-minute targets pass for this isolated exercise; application/SMTP cutover and sustained scheduled recovery objectives remain NOT MEASURED.

Checks: **681 backend tests / 54 files**, **384 frontend tests / 35 files**, **27 Python tests** passed. All nine unchanged migrations applied to a fresh disposable test database; eight OpenAPI documents passed parse/local-reference checks and domain contract tests passed. Format, lint, typecheck, production builds and real Docker build/start/health/restart passed. Seven live failure-injection scenarios passed; existing PostgreSQL/TCP SMTP tests additionally passed definite/ambiguous submission, UNKNOWN holds, fencing, retry limits and revocation/SENDING behavior. Release browser **44 checks** passed with zero axe violations or runtime errors; prior Slice 9–11 browser suites passed. Python emits one upstream TestClient deprecation warning, not a failure.

Observability inspection found HTTP/PostgreSQL/forecast/certificate/batch/delivery spans, five internal AI log entries linked to sampled Node trace IDs, authenticated private metrics, healthy database gauge and durable-state counts. Final API, frontend and forecast runtime scans report no critical/high package findings; PostgreSQL has the unresolved advisory/disposition documented in the security review. No public penetration test or external trace dashboard was performed.

## Verification scope and remaining limits

Backend includes all database-dependent tests on a freshly migrated disposable database; frontend and Python suites, migration checks, format/lint/typecheck/build and OpenAPI checks are executed. Existing Slice 9–11 browser harnesses and release browser checks exercise the established journeys. Release browser coverage is 11 surfaces × desktop/mobile × light/dark = 44 checks, including actual QR reveal, semantic/contrast axe checks, skip-link navigation and focus/reflow. Existing suites cover loading/empty/error and authority failures. Targeted screenshots are visually inspected; screen-reader speech and arbitrary devices are NOT MEASURED.

Backup comparison includes users/contacts/sessions/roles, events/gates, registrations/QR, scan/attendance, forecast runs, certificates/PDF bytes/work, batches/items, delivery/attempts, command replays and audits. It proves equality for captured synthetic rows, not every possible populated state; guest/task tables may be empty in that snapshot. The complete domain suites cover their behavior separately. RTO below means isolated database restore plus integrity validation, not resumed application/SMTP service. No automatic cutover or external-effect replay is performed.

Remote GitHub execution, real SMTP provider acceptance/delivery, public TLS/domain deployment, off-host backup availability, universal WCAG, full-application restore and production forecast accuracy are NOT MEASURED. The libxml2 advisory remains a real-data/public-release dependency gate. See the scoped security review for exact reported package and disposition. Final cleanup stopped the demo stack without deleting its volumes, removed the named disposable test database container, and stopped the validated backend/preview processes; no verification listeners remain on 3311, 5181, 8443, 55432 or 55433. Protected documents are hash-identical to their initial SHA256 values and remain untracked. HEAD remains `54102e2`, index is empty, and `git diff --check` passes; no staging/commit occurs.

## Slice 12 file inventory

19 modified and 35 new files; the four protected untracked documents are excluded. No public API contract, Prisma schema or migration is changed.

- .dockerignore
- .github/workflows/checks.yml
- .github/workflows/release.yml
- .gitignore
- ai-service/app/main.py
- ai-service/requirements.lock
- ai-service/tests/test_operations.py
- backend/.env.example
- backend/package.json
- backend/src/app.ts
- backend/src/config/database.test.ts
- backend/src/config/database.ts
- backend/src/config/env.test.ts
- backend/src/config/env.ts
- backend/src/config/secrets.test.ts
- backend/src/config/secrets.ts
- backend/src/modules/certificate-delivery/recovery.ts
- backend/src/modules/certificates/service.ts
- backend/src/modules/forecasting/client.ts
- backend/src/modules/forecasting/service.ts
- backend/src/modules/scanning/http.ts
- backend/src/observability/http.ts
- backend/src/observability/startup.ts
- backend/src/observability/telemetry.test.ts
- backend/src/observability/telemetry.ts
- backend/src/server.ts
- docker/backend.Dockerfile
- docker/Caddyfile
- docker/forecast.Dockerfile
- docker/forecast-entry.py
- docker/frontend.Dockerfile
- docker/migrate.mjs
- docker/postgres.Dockerfile
- docker/verification.yml
- docker-compose.yml
- docs/implementation/SLICE_12_RUNBOOK.md
- docs/security/SLICE_12_SECURITY_REVIEW.md
- docs/testing/SLICE_12_RELEASE_EVIDENCE.md
- monitoring/README.md
- package.json
- package-lock.json
- README.md
- scripts/backup.ps1
- scripts/backup-loop.ps1
- scripts/demo-secrets.mjs
- scripts/restore.ps1
- scripts/validate-openapi.mjs
- tests/release/browser.mjs
- tests/release/failure.mjs
- tests/release/fixture.mjs
- tests/release/load.mjs
- tests/release/observability.mjs
- tests/release/restore-integrity.mjs
- tests/release/security.mjs
