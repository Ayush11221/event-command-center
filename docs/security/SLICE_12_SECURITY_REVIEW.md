# Slice 12 scoped release security review

Baseline `54102e2`, synthetic loopback deployment, inspected and tested 2026-10-04. This is a scoped release review, not a public penetration test or universal production-security certification.

## Authorization and data reasoning

Node remains the public authentication/RBAC boundary. HTTPS-origin production validation is stricter than development and exact-origin CSRF/CORS/session rules are preserved. Binding 0.0.0.0 is explicitly configured only inside the private container network; the public edge is loopback HTTPS. FastAPI remains bearer-authenticated and loopback-internal. Current session/event/gate authority and artifact ownership stay in domain code; no new worker authorization shortcut is introduced. Batch durable authorization and single issuance/session authority retain their distinct finalized contracts.

Runtime secrets are file-mounted, not baked into images or browser variables. Conflicting environment/file sources fail closed with generic errors. Migration and runtime database roles are separate; runtime cannot create schema objects or inspect migration metadata. API/forecast/edge run nonroot with read-only filesystems, bounded tmpfs, dropped capabilities and no-new-privileges. PostgreSQL's initialization needs its standard privilege drop; its helper is replaced with Alpine su-exec while preserving the official image entrypoint and data format. No schema/migration/public API changes.

Owner-protected backups contain sensitive database data and need encrypted off-host handling for real deployment. Restore remains isolated with workers stopped: neither an old PENDING row nor expired SENDING row proves no external SMTP effect happened. UNKNOWN is retained; automatic retry/reissuance is prohibited until explicit evidence-based reconciliation. Retained keys are necessary for QR/identity/artifact recovery. Local CA trust is demo-only and must be explicitly installed/removed by the operator.

## Verification

PASS: full PostgreSQL backend negative/concurrency tests; foreign event 404; unauthenticated 401; mutation without CSRF 403; foreign-origin CORS denial; secure deployment headers; edge /internal denial; private runtime database permissions; path/query/auth telemetry redaction canary; secret/config negative tests; service authentication/Python redaction; QR/artifact/replay/audit isolation in existing domain suites. `npm audit` reports zero vulnerabilities. These tests do not validate real SMTP provider transport or an internet-facing penetration test.

Docker Scout critical/high reports are retained under ignored `.artifacts/release/*.sarif`. API and frontend runtime scans report zero critical/high findings after production-only dependency pruning and removal of global package-manager tools. Forecast runtime reports zero after removing runtime pip/setuptools and their bundled tools. Original Debian API and pip runtime findings were fixed, not silently accepted. Build and migration tooling is confined to one-shot/non-public images; it is not equivalent to the hardened application runtime and needs separate dependency review before real deployment.

The hardened PostgreSQL image scan still reports 24 HIGH findings: 23 refer to Go stdlib in the original base-image `/usr/local/bin/gosu`; runtime inspection verifies that path is now a symlink to native `/sbin/su-exec`, with no Go gosu executable at that path. Keep the unsuppressed report and runtime-file evidence; do not describe these scanner entries as validated application exploit paths. The remaining reported advisory is **CVE-2026-86140, libxml2 2.13.9-r2, HIGH, no fixed package version reported**. PostgreSQL is private and application SQL is parameterized; no application feature accepts SQL/XML. Reachability/exploitability of that library advisory has not been established by this review.

**NOT MET: the real-data/public-release dependency gate remains open pending an upstream patch or a documented, approved reachability/risk disposition.** Owner: deployment/release operator with application security reviewer. Keep this release synthetic and loopback-only; do not infer safety from private networking alone. No invented CVE fix, unrelated PostgreSQL replacement or automatic risk acceptance is included. Rebuild pinned images deliberately, repeat scans and integrity/failure tests, then update this evidence.

## Explicit limits

NOT MEASURED: public penetration testing; real SMTP/TLS provider behavior; remote CI execution; whole-application cutover/SMTP reconciliation after restore; long-running secret rotation/off-host backup operations. Real participant privacy/retention/export/deletion policy remains DEFERRED / OUT OF SCOPE. No plaintext guest email is invented, no certificate reissue or UNKNOWN blind resend is added, and no telemetry correctness dependency is introduced.
