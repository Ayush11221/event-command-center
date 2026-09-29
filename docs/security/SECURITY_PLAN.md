# Security and Privacy Plan

**Status:** Phase 0 threat/control baseline; not evidence of implementation  
**Scope:** Web client, API, QR credential lifecycle, database, real-time delivery, forecasting service, operational tooling, and generated artifacts

## Security objectives

- Prevent unauthorized access to event, participant, gate, certificate, and audit data.
- Prevent QR guessing, tampering, replay, duplicate entry, and stale credential acceptance.
- Preserve attendance and audit integrity under retries, concurrency, and dependency failures.
- Minimize personal data in credentials, logs, streams, analytics, and model inputs.
- Detect and investigate abuse without exposing sensitive data through observability.
- Fail safely and visibly when authorization, data, or dependencies are uncertain.

## Data and trust boundaries

Trust boundaries exist between:

- Participant/staff browsers and the public application edge
- Frontend code and the authenticated API
- API modules and PostgreSQL
- Transactional state and asynchronous/live delivery
- Backend and FastAPI forecasting service
- Application services and monitoring/logging systems
- Privileged operators and audit/report exports

Browsers, QR contents, client timestamps, route guards, event-stream messages, and external inputs are untrusted until validated. PostgreSQL is authoritative for protected state; logs and dashboard projections are not.

## Key threats and planned controls

| Threat | Planned controls |
| --- | --- |
| QR enumeration or forgery | High-entropy opaque/signed credential, no sequential IDs or plaintext PII, server validation, rotation/revocation |
| QR sharing/replay or simultaneous scans | Attendance state checks, idempotency, transaction/locking strategy, duplicate reason code, audit and anomaly signals |
| Wrong-event or revoked credential | Bind validation to event and active credential/registration state |
| Privilege escalation/IDOR | Deny-by-default server authorization, event-scoped permissions, ownership checks, negative tests |
| Compromised scanner session | Short/session-bounded auth as designed, gate/operator context, session revocation, minimal displayed PII, device/session audit metadata where justified |
| Injection and malformed input | Schema validation, parameterized data access, output encoding, file/export protections, safe errors |
| Session/token theft | Secure transport; secure cookie/token storage chosen through threat analysis; rotation, expiry, logout/revocation; XSS/CSRF controls appropriate to mechanism |
| Registration or scan abuse | Threat-informed rate controls, monitoring, safe throttling, capacity-aware operational fallback |
| Event publication/role tampering | Strong authorization, concurrency/version checks, explicit confirmation for high-impact actions, audit events |
| Data leakage through logs/streams/forecasts | Data minimization, allowlisted fields, redaction, access control, retention, tests |
| Dependency/supply-chain compromise | Lockfiles, review, automated advisories/scanning, minimal dependencies, secret scanning, trusted build provenance where feasible |
| Availability failure | Timeouts, bounded retries, circuit/degraded behavior, durable core transactions, load/failure testing, backup/restore |
| Forecast manipulation or misleading output | Validated input provenance, model/method version, freshness/uncertainty, baseline evaluation, read-only advisory role |

## Identity, authentication, and sessions

The authentication provider/mechanism is TBD in Phase 4. Selection must address account verification/recovery, session storage, expiry, rotation, revocation, CSRF, XSS exposure, brute-force protection, and operational usability. Do not implement custom cryptography or password storage when a well-maintained platform/library satisfies approved requirements.

Multi-factor authentication for privileged roles is a candidate, not yet a requirement; decide it from threat, demonstration scope, and provider capability.

## Authorization and RBAC

- Permissions are action/resource/event scoped and denied by default.
- Organizer and Event Admin capabilities must be distinguished explicitly.
- Gate/Security Staff access is bounded to assigned event/gate operations.
- Volunteer access starts empty until each task permission is approved.
- Participant access is self-owned unless a separately authorized workflow exists.
- Authorization is enforced in application/service boundaries and tested independently of UI visibility.
- Role assignment/removal, sensitive reads/exports, and denied privileged attempts are auditable.

## QR credential security

- Do not embed name, email, phone, role, attendance state, or other sensitive plaintext in the QR code.
- Use a cryptographically strong opaque value or a carefully designed signed token; final format is TBD.
- If an opaque secret is used, prefer storing a verifier/hash rather than a reusable plaintext value when feasible.
- Define issue, expiry, revoke, replace, and compromised-credential flows.
- Treat screenshot resistance as impossible; enforce server-side state and event policy instead.
- Offline verification is not included until revocation, replay, clock, key distribution, synchronization, and reconciliation risks are approved.
- Avoid logging raw QR values.

## Application and API controls

- Validate all request shapes, sizes, identifiers, state transitions, and content types.
- Use parameterized/ORM queries safely and test authorization at object boundaries.
- Set secure transport and browser headers appropriate to the final deployment.
- Define CORS narrowly; define CSRF protection from the actual session mechanism.
- Use safe error envelopes and correlation IDs without leaking internal state.
- Bound uploads/exports if introduced; no arbitrary file behavior is currently required.
- Apply threat-informed rate limits and alert on meaningful anomalies.

## Secrets and configuration

- Never commit secrets or real `.env` files.
- Provide `.env.example` only when actual configuration keys exist, with non-secret placeholders.
- Use the deployment platform's secret store and least-privilege service credentials.
- Separate environments and databases; do not reuse production/demo credentials locally.
- Rotate compromised credentials and document ownership/expiry.
- Prevent secrets from entering logs, traces, audit details, images, or generated reports.

## Privacy and data governance

Before using real participant data, define:

- Lawful purpose/consent wording and data owner
- Minimum registration fields and optional fields
- Access/export policy by role
- Retention for accounts, registrations, scans, audit, forecasts, certificates, logs, and backups
- Correction, deletion/anonymization, and subject-request behavior
- Whether minors or other sensitive populations are in scope; currently **TBD/outside assumed MVP**
- Data residency or institutional constraints

Model features and analytics must avoid PII unless an approved necessity is documented. Synthetic test data must not resemble real identities.

## Audit and monitoring

Audit records capture who/what/when/target/outcome/correlation for privileged changes and scan decisions, with controlled metadata. Application logs focus on diagnostics. Both need restricted access, retention, integrity protections, time synchronization, and redaction. Alert conditions should cover authentication abuse, repeated invalid/duplicate scans, privilege failures, unusual exports, and system degradation without turning expected operations into noise.

## Dependency, build, and deployment security

- Add dependencies only for a documented purpose and pin/lock them through the selected ecosystem.
- Run dependency, source, secret, container, and infrastructure checks in CI when those assets exist.
- Review high-risk transitive dependencies and build scripts.
- Use minimal runtime images/non-root processes where supported.
- Keep development/debug interfaces unavailable in deployment.
- Generate an SBOM or equivalent inventory if feasible for the final demonstration.

## Security verification and gates

Before the final demonstration:

- Threat model critical journeys and update this plan.
- Test horizontal/vertical authorization and participant ownership.
- Test QR guessing/tampering/replay, duplicate concurrency, revocation, wrong-event use, and timeout/retry behavior.
- Test input validation, common web/API weaknesses, rate behavior, and sensitive-data leakage.
- Scan dependencies, secrets, source, containers, and deployed surface as applicable.
- Verify backup restoration and degraded dependency behavior.
- Triage every finding; no unresolved critical/high issue is accepted in demonstrated scope without explicit documented risk ownership.

See [TEST_STRATEGY.md](../testing/TEST_STRATEGY.md) for evidence layers.

## Incident and disclosure planning

A lightweight plan must identify how to revoke a credential/session, disable affected functionality, preserve audit evidence, notify the project owner, rotate secrets, and communicate participant impact. External disclosure/contact details are TBD before public deployment.

## TBD decisions

- Authentication/session provider, MFA requirement, and recovery process
- Permission matrix and separation between Organizer and Event Admin
- Credential format, cryptographic/key management, expiry, and replacement policy
- Offline/degraded scanning policy
- Minimal identity shown to gate staff
- Rate thresholds and abuse escalation
- Retention/deletion/export policy and privacy notice
- Audit immutability/retention implementation
- Deployment platform, network controls, secret store, RPO/RTO, and incident contacts

