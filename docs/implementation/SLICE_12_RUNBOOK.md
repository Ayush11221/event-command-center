# Slice 12 deployment and demonstration runbook

For the separate Railway deployment mode and its outstanding platform verification, see [Railway deployment adaptations](RAILWAY_DEPLOYMENT.md). The Compose procedures below retain their existing defaults.

Baseline: `54102e2` (Slices 1–11). This release uses synthetic data, one API/realtime instance, PostgreSQL 16, internal FastAPI and platform SMTP. Public behavior is governed by `docs/api/API_CONTRACT.md`. The browser reaches only the HTTPS Caddy edge; Node owns authorization, database access and Socket.IO. FastAPI shares the API network namespace and binds loopback. No Kafka, new microservice, checkout/re-entry, correction or product-alert implementation is included.

## Prerequisites and secrets

Use Node 22, npm, Docker Compose v2 and PowerShell. Run `npm ci`, `npm run db:generate`, `npm run build`, then `node scripts/demo-secrets.mjs`. This creates ignored `.secrets/` files exclusively and never replaces an existing secret. Do not print them or put them in Vite variables, Git, logs or command-line URLs. Windows: restrict this directory to the current operator with `icacls .secrets /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F"`. Linux: permit the container UID/GID 1000 to read mounted files (`sudo chgrp 1000 .secrets/*; chmod 640 .secrets/*`); directory ownership must permit operator access only. CI creates fresh synthetic secrets; operators retain stable keys across restarts and recoveries.

The default SMTP URL file is empty: delivery is disabled and issuance can still succeed. Put the existing authenticated `SMTP_URL` value in `.secrets/smtp_url` and configure `SMTP_FROM` for a controlled test SMTP server only. Platform From is used; no organizer Reply-To. Phone OTP needs the existing operator adapter, not a new gateway. No real participant data is approved by this demo.

## Deploy, trust and stop

```powershell
docker compose -p slice12-demo up --build -d
docker compose -p slice12-demo ps
docker compose -p slice12-demo cp frontend:/data/caddy/pki/authorities/local/root.crt .artifacts/release/demo-ca.crt
$env:NODE_EXTRA_CA_CERTS=(Resolve-Path .artifacts/release/demo-ca.crt).Path
```

Create `.artifacts/release` before copying the certificate. Open `https://127.0.0.1:8443`. Caddy uses a persistent local CA; explicitly trust this CA in the demo browser/OS after checking its fingerprint, then remove that trust when the demonstration ends. Never disable TLS verification in application configuration. Browser verification uses an isolated Playwright context with local-certificate exceptions; Node verification explicitly trusts the CA. For another deployment host, set `PUBLIC_ORIGIN` and `PUBLIC_HOST` consistently and rebuild the frontend. A publicly trusted certificate and real deployment domain are separate operational prerequisites, not demonstrated here.

Only loopback port 8443 is published in the baseline. `/internal/*` is denied at the edge. PostgreSQL has no host port; the test-only `docker/verification.yml` adds loopback 55432 for synthetic fixture/integrity checks. Do not deploy that overlay with real data. Migration is a one-shot service using the migration role; the runtime role cannot create schema objects or read Prisma migration metadata. Existing nine migrations are preserved. API readiness depends on PostgreSQL; forecasting and email degradation do not remove core API availability. Frontend depends on API readiness, and PostgreSQL has its own healthcheck.

Stop with `docker compose -p slice12-demo down` **without `--volumes`**. This preserves database, certificates and local CA. API gets 35 seconds to stop; its shutdown deadline is 30 seconds. Never globally prune Docker or remove unrelated containers/volumes.

## Verification

```powershell
docker compose -p slice12-demo -f docker-compose.yml -f docker/verification.yml up --build -d
node tests/release/load.mjs
node tests/release/security.mjs
node tests/release/browser.mjs
node tests/release/failure.mjs
node tests/release/observability.mjs
node scripts/validate-openapi.mjs
```

The release harness intentionally creates synthetic fixtures and interrupts only the named demo stack. Run against disposable demo data, never a production database. Browser Chromium must be installed for Playwright. Results/screenshots are ignored under `.artifacts/release`. The regression workflow runs backend tests against migrated disposable PostgreSQL, frontend tests and Python tests. The manual release workflow additionally builds the stack, runs the harnesses and isolated restore, and retains evidence for seven days. Remote workflow execution has not been demonstrated locally.

## Backup, restore and rollback

```powershell
$backup = & ./scripts/backup.ps1 -Project slice12-demo
& ./scripts/restore.ps1 -Project slice12-demo -Backup ($backup | Select-Object -Last 1) -Database eoc_restore_verified
$env:SLICE12_RESTORE_DATABASE='eoc_restore_verified'
node tests/release/restore-integrity.mjs
```

Archives and checksum/timestamp sidecars stay in owner-protected `.artifacts/backups`. PostgreSQL custom-format dumps contain sensitive data; copy to an encrypted, access-controlled off-host destination for a real release. `scripts/backup-loop.ps1` produces a backup every ten minutes and stops on failure. It must be supervised by an operator; this implementation does not claim a tested unattended backup service or sustained RPO guarantee. Targets: RPO ≤15 minutes, RTO ≤30 minutes. Evidence distinguishes observed backup age and isolated restore time from whole-application recovery.

Restore refuses existing targets and only accepts new `eoc_restore_*` databases, verifies archive checksum, uses a single transaction, and never points API/workers at the restored database. First compare users, bindings, registrations, QR rows, accepted attendance, derived occupancy, forecast runs, work/batches, delivery/replay/audit rows and PDF byte hashes. Keep outbound SMTP and workers quarantined. A backup cannot reveal SMTP submissions made after its snapshot: reconcile every potentially affected delivery/attempt with provider evidence, preserve UNKNOWN holds, and do not blindly resume PENDING/FAILED or expired SENDING work. There is no new administrative resolution API in Slice 12. Whole-application resumption requires an explicitly reviewed reconciliation procedure; it is NOT MEASURED here.

Before an upgrade retain the current image IDs/tags, key files and a verified backup. Roll back application images only against a compatible existing schema; no automatic down-migration, PostgreSQL major downgrade or data overwrite. Restore into isolation and validate before any approved cutover. Never automatically re-run external email effects after rollback.

## Sixteen-step capstone demonstration

1. Explain HTTPS edge → Node/Socket.IO → PostgreSQL/internal FastAPI/optional SMTP and the advisory forecast boundary.
2. Start the stack, trust its local CA, show liveness/readiness and private service ports.
3. Use a synthetic verified Organizer; create/configure a Draft, gate and publication. Existing controlled bootstrap provisions identities; release fixtures create synthetic sessions for automated evidence.
4. Discover a public Published event and register a synthetic participant; distinguish registration cap from admission.
5. Reveal that participant's opaque QR and show ownership isolation.
6. Start Live and scan through assigned gate staff; repeat the same scan key to show replay.
7. Show occupancy and attendance revision from accepted transitions, plus socket notification/REST confirmation.
8. Show 30/60-minute advisory forecast with confidence/freshness or explicit unavailable state; insufficient synthetic history is not a model accuracy claim.
9. Preview and issue one eligible certificate; download its authorized PDF.
10. Select explicit registrations for a durable batch; show progress and separate delivery states. Disabled/unavailable mail does not invalidate ISSUED. UNKNOWN is never blindly resent.
11. Create a one-volunteer task; progress as that volunteer and show terminal/cancellation restrictions.
12. Complete the event and open factual results with their limitations.
13. Search scoped audit records as authorized staff and demonstrate that audit access is itself audited.
14. Run the failure harness: restart, database interruption, socket gap, AI failure and durable batch recovery.
15. Show measured load percentiles/errors and the tested workload, not horizontal or production scaling claims.
16. Show security/a11y evidence, outstanding dependency risk and isolated backup/restore limits.

Operational owner: the demo/release operator; application owner reviews contract regressions and recovery decisions. See the evidence matrix and security review before claiming acceptance.

References: [Caddy internal TLS](https://caddyserver.com/docs/caddyfile/directives/tls), [WebSocket reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [default SNI](https://caddyserver.com/docs/caddyfile/options).

## Isolated crowd forecasting demonstration (local only)

This separate demonstration uses the event name **Crowd Forecast Demo — synthetic attendance**. Its attendance and identities are fictitious, and every forecast is explicitly labelled as computed from synthetic attendance. Never point this harness at Railway, use copied production data or credentials, or use its forecasts for operational decisions. It does not change the 270-minute policy or add an application simulation endpoint.

### Setup and safety gates

Use Node 22, installed repository dependencies, built backend modules (`npm run build --workspace=backend`), Docker Desktop with Linux containers, and the repository's installed Playwright Chromium. Run commands from the repository root in a clean shell, without Docker/Compose target overrides, database URLs, PostgreSQL overrides, Railway variables, application secrets or `NODE_OPTIONS`. Do not dump your environment to diagnose a rejection. The harness ignores dotenv files and rejects target/credential overrides rather than accepting them.

```powershell
node --test tests/demo/isolation.test.mjs
node tests/demo/forecast-demo.mjs init
node tests/demo/forecast-demo.mjs start
node tests/demo/forecast-demo.mjs isolation
```

Do not run `seed` unless `isolation` reports `eoc_forecast_demo`, enabled protection triggers, and zero application records. The harness also enforces this inside the seed transaction. Use the harness instead of invoking this Compose file directly: it pins the project `eoc-forecast-demo`, local socket context, configuration, resource ownership and credentials. It rejects arbitrary URLs/event IDs, remote/TCP/SSH Docker endpoints, foreign resource name collisions, substituted credential files, symlinks, disabled attendance triggers and existing application data.

The standalone `docker/forecast-demo.yml` uses an internal data network, project-scoped volumes, and new credentials exclusively under `.secrets/forecast-demo/`. It does not use the existing `.secrets/forecast_key` or other application secret files. Only HTTPS is published, at `https://127.0.0.1:9443`; API, Python and PostgreSQL have no published ports. The edge bridge must be host-reachable for Docker's loopback port publishing; the data network remains internal. Both bridges are dedicated to this project. All profiles, including the tools profile, are validated before startup. The test worker is bind-mounted only into that profile; `tests/` remains excluded from Docker build contexts and production runtime images.

Credential files are generated exclusively, never overwritten. SHA-256 fingerprints bind subsequent commands to those generated files. Owner-only directory permissions are applied on Windows and Unix. On Unix, the container UID 1000 must be able to read these owner-protected mounted files; use an operator account with matching UID rather than broadening file permissions. Never print credential files, `sessions.json`, environment dumps, or unrestricted container inspections. No credentials belong in a `VITE_` variable. The optional browser launcher provisions short-lived fixture sessions privately; it never prints tokens or adds an authentication bypass endpoint. These sessions demonstrate the existing session/RBAC/CSRF mechanisms, not OTP delivery. Email/SMS submission is unconfigured. The local API's explicit `direct` OTP source policy counts its socket peer and trusts no forwarded identity headers; production authentication configuration is unchanged.

### Dataset and real pipeline verification

```powershell
node tests/demo/forecast-demo.mjs seed
node tests/demo/forecast-demo.mjs verify
node tests/demo/forecast-demo.mjs browser
```

Seeding is permitted once, into a verified empty database. It creates a new event, dedicated fictitious accounts/registrations/QR credentials, and 16 deterministic accepted arrivals across approximately five hours. Timestamps are whole UTC minutes. Every historical scan decision and attendance transition is inserted together in one transaction with matching event, gate, operator, registration, credential and accepted timestamp. Existing constraints and append-only triggers remain enabled; no accepted timestamp is updated, and no trigger is disabled. `COMMITTED` describes records committed to this synthetic local ledger, not evidence of real human attendance. A database provenance marker and owner-protected manifest bind the dataset to this demo instance.

`verify` uses the real Node HTTP API and the real authenticated Python service, without fabricated successful responses or service mocks. It registers two additional fictitious attendees while the event is PUBLISHED, retrieves a QR credential, performs the existing authorized transition to LIVE, checks in one attendee, and verifies a distinct duplicate attempt is rejected. It also checks CSRF, anonymous and participant forecast denials. Repeated verification uses the same idempotency keys for these commands; it does not create another attendance transition for that attendee.

Two additional, clearly named synthetic threshold-test events are created locally for each verification. Their first accepted check-ins are based on the current database clock. The harness proves that 269 regular minute observations plus an off-minute endpoint remain INSUFFICIENT_DATA, and that 270 regular observations produce AVAILABLE. It never advances the system clock or lowers the threshold. A minute-rollover guard keeps these exact-count checks reliable; a very slow run may fail rather than claiming success with a different count.

Every successful result is checked against its persisted `ForecastRun`, run ID, event, input context, occupied count and attendance revision. Matching correlation IDs must appear with HTTP 200 in both API and Python application logs. Evidence is saved to `.artifacts/forecast-demo/evidence.json`; the raw private sessions are separate and are never part of reported evidence. Public HTTP 200 alone is insufficient proof.

The headless `browser` check validates the local Caddy certificate using Node's explicit copied public CA, then checks the actual application forecast, persistent synthetic provenance in all three role contexts, the scanner's prepared manual entry and the attendee's real QR display. It leaves the reserved arrival unchecked for the presentation. Its certificate exception is confined to fresh Playwright contexts restricted to the fixed loopback origin; it does not disable verification in application clients or install a global CA. It saves `.artifacts/forecast-demo/forecast-demo.png`.

### Presentation and lifecycle

```powershell
node tests/demo/forecast-demo.mjs present
```

This opens isolated Organizer, Gate Scanner and fictitious Attendee browser contexts, using fresh 15-minute fixture access tokens without displaying them. The organizer shows the forecast. The attendee shows the reserved registration's QR. The launcher opens the scanner's existing manual-entry form and pre-fills that local QR credential; submit through the normal scanner UI. Actual camera hardware/permissions need separate verification. There is no role picker or server-side authority override. Registration remains closed after LIVE; reserved presentation attendees are registered during verification, preserving the existing lifecycle policy. A second presentation scan is correctly rejected if that attendee has already checked in. After new attendance, refresh the forecast normally; retained incompatible points are labelled stale by the existing UI.

The frontend demo build rejects any page or API origin other than the fixed `https://127.0.0.1:9443`. Its persistent banner remains on all routes, and available, insufficient, stale and failed forecast displays retain synthetic provenance. Trend and Venue views also show their own provenance notices and include synthetic attendance in accessible summaries. Big Screen keeps notices inside both its forecast panel and Venue display, including when fullscreen hides the main-page banner. Ordinary builds do not enable this label mode.

```powershell
# Preserve the disposable dataset for a later presentation:
node tests/demo/forecast-demo.mjs stop
node tests/demo/forecast-demo.mjs start

# Delete only this instance's verified disposable volumes and generated files:
node tests/demo/forecast-demo.mjs cleanup
```

`stop` does not remove volumes. `cleanup` verifies resource ownership before removing only the named demo stack, its volumes, `.secrets/forecast-demo/`, and `.artifacts/forecast-demo/`. It does not prune Docker, touch the older `slice12-demo` stack, or delete other secrets/artifacts. After cleanup, initialize a fresh instance; never adopt existing unrelated data. To reuse a retained dataset, skip `init` and `seed`; run `start`, `verify`, then `present`. Verification creates fresh threshold-test fixtures, so this disposable database intentionally accumulates test evidence until cleanup.

### Troubleshooting and limits

- A guard rejection is fail-closed. Check the documented command, selected local socket context and presence of forbidden variable **names**; do not supply an alternative target. Do not edit manifests, credential files or resource labels to bypass ownership checks.
- Port 9443 must be free. An unhealthy dependency or build failure must be resolved locally before isolation/seeding. Inspect only the fixed project's service logs through the guarded configuration; never dump credentials or container environments.
- If a command fails after seeding, do not delete ledger rows or backdate existing records. Re-run `verify` with its stable keys, or use guarded cleanup to build a new disposable instance. If `seed` committed but its manifest could not be saved, the empty-data gate intentionally prevents a second seed; reset with guarded cleanup.
- Missing correlated application logs, a non-AVAILABLE primary result, mismatched persistence/context, or a failed browser check means verification failed. Do not replace failures with fixture responses.
- A fresh event with only normal current-time check-ins still needs approximately 4 hours 29–30 minutes from its first accepted check-in. Five hours of prepared synthetic history makes a short presentation possible; it does not accelerate production readiness. No observations are fabricated in production.
- The current method is a check-in-only **persistence baseline**: both horizon point estimates equal the latest occupancy. Intervals and chronological retrospective metrics explain this baseline; they are not proof of production accuracy, usefulness, departures, future crowd growth, live OTP delivery or physical-camera behavior.
