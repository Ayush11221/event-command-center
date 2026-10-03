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
