# Security and Privacy Plan

**Status:** Phase 0 threat/control baseline; not evidence of implementation  
**Scope:** Web client, API, verified account/guest OTP ownership, QR credential lifecycle, database, real-time delivery, forecasting service, certificate PDF/batch/email delivery, operational tooling, and generated artifacts

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
- API/job boundary, certificate artifact store, platform email sender/provider, and recipient inbox

Browsers, QR contents, client timestamps, route guards, event-stream messages, and external inputs are untrusted until validated. PostgreSQL is authoritative for protected state; logs and dashboard projections are not.

## Key threats and planned controls

| Threat | Planned controls |
| --- | --- |
| QR enumeration or forgery | High-entropy opaque/signed credential, no sequential IDs or plaintext PII, server validation, rotation/revocation |
| QR sharing/replay or simultaneous scans | Unique logical scan_id, original-result retry, attendance state checks, transaction/locking strategy, duplicate reason code, audit and anomaly signals |
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
| Guest OTP abuse or takeover | Verification before ownership/recovery/cancellation, throttling and expiry by threat model, privacy-safe responses, no permanent guest account requirement |
| Certificate or email data exposure | Event-scoped Organizer/Admin action checks, own-artifact participant access, recipient verification, protected PDF links/storage, minimum email content, no participant contact data in gate views |
| Duplicate or misdirected certificate email | Idempotent delivery operation and bounded retry, independent issue/delivery state, auditable recipient/status, provider secrets outside source control |

## Identity, authentication, and sessions

The authentication/OTP provider and mechanism are TBD in Phase 4. MVP must support authenticated users with verified email/phone and guests with email/phone OTP ownership/recovery without permanent accounts. Selection must address OTP expiry, replay, abuse, account/guest recovery, session storage, expiry, rotation, revocation, CSRF, XSS exposure, brute-force protection, and operational usability. Do not implement custom cryptography or password storage when a well-maintained platform/library satisfies approved requirements.

Multi-factor authentication for privileged roles is a candidate, not yet a requirement; decide it from threat, demonstration scope, and provider capability.

## Authorization and RBAC

- Permissions are action/resource/event scoped and denied by default.
- Organizer creates/owns event and alone controls lifecycle, including Live cancellation, manual registration close/reopen, and Event Admin assignments. Event Admin operates assigned events but cannot promote admins, transfer ownership, or cancel the event. Both may cancel individual registrations only before first accepted check-in, make reasoned corrections, acknowledge/resolve alerts, issue/revoke certificates, and retry failed certificate email. Audit read is restricted/event-scoped; unrestricted export and direct staff credential issue/revoke are not granted.
- Gate/Security Staff access is bounded to assigned-gate scan/result/history, display name, registration status, relevant attendance status, and event context. Email, phone, OTP data, account credentials, unnecessary PII, and corrections are denied.
- Volunteer access is own titled assignment/instructions/applicable time/location/status only; no scans, participant management, correction, event configuration, admin functions, or general alert stream.
- Participant/verified guest access is self-owned after account/contact verification; guest self-cancellation requires OTP and is disabled after first accepted check-in.
- Authorization is enforced in application/service boundaries and tested independently of UI visibility.
- Role assignment/removal, sensitive reads/exports, and denied privileged attempts are auditable.

## QR credential security

- Do not embed name, email, phone, role, attendance state, or other sensitive plaintext in the QR code.
- MVP QR contains an opaque/random token, never contact data or plaintext PII; generation/verifier design remains a technical choice.
- If an opaque secret is used, prefer storing a verifier/hash rather than a reusable plaintext value when feasible.
- Define issue, expiry, revoke, replace, and compromised-credential flows.
- Treat screenshot resistance as impossible; enforce server-side state and event policy instead.
- Offline verification and manual gate override are post-MVP. Failed scans hold/reject entry and never authorize a transition.
- Avoid logging raw QR values.

## Application and API controls

- Validate all request shapes, sizes, identifiers, state transitions, and content types.
- Use parameterized/ORM queries safely and test authorization at object boundaries.
- Set secure transport and browser headers appropriate to the final deployment.
- Define CORS narrowly; define CSRF protection from the actual session mechanism.
- Use safe error envelopes and correlation IDs without leaking internal state.
- Bound uploads/exports if introduced; no arbitrary file behavior is currently required.
- Apply threat-informed rate limits and alert on meaningful anomalies.
- Enforce PUBLIC catalog versus PRIVATE controlled-link access server-side; a known event identifier is not permission to disclose private details. Public event responses may contain only name, description, date, start/end time, public venue/location, organizer-provided image/banner, registration availability, remaining/available indication, and public category/tags; no participant, credential, internal operations, live occupancy, alert, admin, or audit data.
- Verify current REGISTERED registration and non-Cancelled event status on each QR scan; a CANCELLED registration produces a CANCELLED rejection and its old token cannot be reactivated by re-registration. Organizer may cancel from Live; event cancellation blocks all check-ins while leaving existing registrations/history unchanged. Registration creation also requires Published state; Live always blocks new registration.
- Before cancelling an individual registration, enforce absence of any accepted check-in transactionally for every actor. Denial holds even after check-out; no CANCELLED + INSIDE state may arise. Post-check-in occupancy changes only by valid check-out or authorized reasoned correction, preserving append-only evidence.

## Certificate PDF and email delivery

- Derive single/bulk eligibility from accepted check-in on current non-CANCELLED registrations, not manual CSV input in MVP. ELIGIBLE is not an automatic issue/send authorization. Organizer/Admin explicitly issue or revoke and alone retry FAILED email; restrict preview, batch creation, and delivery-status read by event/action permission; participants access only their own issued PDF. Registration cancellation after accepted check-in is forbidden.
- Use built-in templates and font styles in MVP. Protect generated PDFs and preview data against cross-participant access, injection, unsafe rendering, and unbounded retention.
- Treat certificate NOT_ELIGIBLE/ELIGIBLE/ISSUED/REVOKED separately from email PENDING/SENT/FAILED. Email failure cannot silently revoke an issued certificate, and resend cannot silently reissue one.
- Send from a platform sender with optional Organizer Reply-To; Organizer Gmail OAuth is post-MVP. Minimize recipient/body data and prevent cross-recipient attachments or addresses. Provider credentials and signing secrets belong in managed configuration, never source, logs, audit metadata, or PDFs.
- Make explicit single/bulk issue, batch creation, PDF generation, send, revoke, and FAILED retry auditable/correlation-friendly. The same certificate/delivery operation must be idempotent without duplicate sends; partial failure and recovery must be visible.
- Capacity is a REGISTERED-registration cap; INSIDE occupancy is a separate operational count. Alerts at near-90% WARNING and 100% CRITICAL use live INSIDE occupancy, never registration-list fullness. No second physical gate-capacity rejection rule is implied.

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
- Recipient-email, PDF-artifact, batch, delivery-attempt, and provider-log retention/erasure rules
- Data residency or institutional constraints

Model features and analytics must avoid PII unless an approved necessity is documented. Synthetic test data must not resemble real identities.

## Audit and monitoring

Audit records capture who/what/when/target/outcome/correlation for privileged changes and scan decisions, with controlled metadata. Application logs focus on diagnostics. Both need restricted access, retention, integrity protections, time synchronization, and redaction. Security monitoring may track authentication abuse, repeated invalid scans, and privilege failures, but these are not extra MVP product-alert categories beyond occupancy capacity, gate/scanner operational failure, and data/forecast staleness.

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
- Test QR guessing/tampering/replay, duplicate concurrency, CANCELLED registration, wrong-event use, and timeout/same-scan_id retry behavior.
- Test Organizer-only lifecycle including Live cancellation and manual registration closure/reopen; Live blocks registration, and a Cancelled event denies new registration/check-in without rewriting historical registration/audit/attendance rows.
- Test PUBLIC/PRIVATE access and exact public allowlist/no private-detail leakage, account and guest OTP ownership/cancellation before check-in, post-check-in denial for every role, and strict Gate/Security identity allowlist with contact/OTP/credential exclusion.
- Test certificate ELIGIBLE without automatic issue/send, explicit Organizer/Admin single/bulk issue/revoke/retry, preview/batch/artifact authorization, recipient isolation, secret redaction, delivery failure/retry idempotency, and ISSUED-with-FAILED-email state.
- Test input validation, common web/API weaknesses, rate behavior, and sensitive-data leakage.
- Scan dependencies, secrets, source, containers, and deployed surface as applicable.
- Verify backup restoration and degraded dependency behavior.
- Triage every finding; no unresolved critical/high issue is accepted in demonstrated scope without explicit documented risk ownership.

See [TEST_STRATEGY.md](../testing/TEST_STRATEGY.md) for evidence layers.

## Incident and disclosure planning

A lightweight plan must identify how to revoke a credential/session, disable affected functionality, preserve audit evidence, notify the project owner, rotate secrets, and communicate participant impact. External disclosure/contact details are TBD before public deployment.

## TBD decisions

- Authentication/session provider, MFA requirement, and recovery process
- MVP alert acknowledge/resolve, certificate retry, restricted audit read, and least-privilege credential action grants are locked; implementation controls and retention remain technical work
- Opaque-token verifier/key management, expiry, and replacement mechanics
- Gate identity allowlist is locked: display name, registration/attendance status, event context, scan result; no contact/OTP/credentials
- Controlled PRIVATE link/OTP provider and abuse mechanism
- Certificate artifact protection/retention, delivery-provider secret and sender-domain configuration
- Rate thresholds and abuse escalation
- Retention/deletion/export policy and privacy notice
- Audit immutability/retention implementation
- Deployment platform, network controls, secret store, RPO/RTO, and incident contacts
