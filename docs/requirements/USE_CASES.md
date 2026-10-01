# Major Use Cases

**Status:** Phase 1 MVP product flows; exact endpoints and database fields remain later implementation work. `System` is an actor only for derived/automatic work. Every protected step requires the event-scoped checks in [ROLE_PERMISSION_MATRIX.md](ROLE_PERMISSION_MATRIX.md).

## UC-01 — Create event

- **Actor / goal:** Event Organizer creates an owned event draft; assigned Event Admin may edit that Draft's name, description, public venue/location, image/banner, and public category/tags, and configure its gates separately.
- **Preconditions:** Authenticated Organizer for creation; assigned-event permission for Admin editing.
- **Main flow:** Open event workspace → enter required draft details → validate → save Draft → show event identity and missing publication requirements.
- **Alternates:** Save partial Draft; return to edit.
- **Failures:** Validation, duplicate request, or save failure leaves no falsely published event.
- **Postconditions:** One auditable Draft exists; no participant registration or gate entry is enabled.
- **Security:** Server-side create authorization; protect draft and contact data; audit creation.

## UC-02 — Control event lifecycle

- **Actor / goal:** Organizer controls publication and other lifecycle transitions; Event Admin cannot cancel the event or transfer ownership.
- **Preconditions:** Draft with required capacity, schedule/time zone, registration policy, and at least one configured Gate associated with the Event for publication; the server independently rechecks for a configured Gate before the later Published → Live transition.
- **Main flow:** Review readiness → request publish → server validates and authorizes transition → move to Published → expose approved public details. Organizer alone controls subsequent start, completion, and event cancellation.
- **Alternates:** Return to Draft editing when readiness fails. Registration opens on publication unless a future opening is configured; Live transition closes it even if a later close was configured. Organizer may cancel from Live; cancellation blocks further registrations/check-ins, retains existing rows/history, and is audited. Participant notification is post-MVP.
- **Failures:** Concurrent edit, missing configuration (including no configured Gate at Publish or Live), or forbidden actor prevents transition and reports why.
- **Postconditions:** The authorized transition is audited. Publication exposes approved details; cancellation blocks registration/check-in and retains existing registrations unchanged.
- **Security:** Event-scoped permission, version/concurrency check, public field allowlist.

## UC-03 — Register participant

- **Actor / goal:** Participant obtains a valid event registration.
- **Preconditions:** PUBLIC catalog or PRIVATE controlled-link access to a Published event; registration is open under time, capacity, and manual rules. No registration is allowed in Live, even if a later close was configured. Authenticated verified contact or guest email/phone OTP verification is required.
- **Main flow:** Review non-Cancelled event → verify ownership → enforce opening time, configured close or default event-start close, manual Organizer closure, and one REGISTERED registration per user or guest verified email OR phone/event → count REGISTERED rows against the single registration cap → create REGISTERED registration → show status.
- **Alternates:** Existing own registration can be recovered. Scheduled/event-based, capacity-based, and manual closure have distinct reasons; only capacity-only closure lifts when cancellation frees a spot.
- **Failures:** Invalid input, duplicate identity ambiguity, concurrent capacity condition, or unavailable service gives no false confirmation.
- **Postconditions:** One REGISTERED registration under the locked duplicate rule; Cancelled event never accepts new registration.
- **Security:** Ownership verification, data minimization, abuse controls, no cross-participant access.

## UC-04 — Generate or reissue QR credential

- **Actor / goal:** Participant obtains the active credential for their valid registration through the approved own-record flow.
- **Preconditions:** Registration state permits credential issue; requester owns the registration. Organizer/Admin may inspect metadata but have no direct staff credential issue/revoke action in MVP.
- **Main flow:** Validate authority and registration → issue unique non-guessable credential → render QR for owner → record issue/reissue.
- **Alternates:** Return existing active credential according to approved policy; reissue revokes predecessor atomically. A new registration after cancellation receives a new token; the old token stays invalid.
- **Failures:** Revoked/cancelled registration, conflicting issue, or service error never leaves two active credentials.
- **Postconditions:** At most one active credential per registration; action auditable.
- **Security:** No plaintext PII in QR, server-side validity, controlled exposure, no raw token in logs.

## UC-05 — Scan QR

- **Actor / goal:** Gate/Security Staff captures a credential in the correct gate context.
- **Preconditions:** Authenticated, authorized scanner session with selected event/gate and network readiness.
- **Main flow:** Confirm context → camera captures QR → client sends opaque value and unique client-generated scan_id → show pending state → display authoritative result with only display name, registration/attendance status, event context, and scan result.
- **Alternates:** Camera permission denial needs an accessible capture/recovery design, but does not authorize manual admission; unreadable QR can be rescanned without claiming a decision.
- **Failures:** Network timeout is technical/unknown, never acceptance; entry is held/rejected until a valid decision. Retry uses the same scan_id and returns its original result. Manual override is post-MVP.
- **Postconditions:** A decision is shown or an explicit unresolved state remains; physical entry follows policy.
- **Security:** Gate/operator scope, no email/phone/OTP/account credentials or unnecessary PII, no raw QR retention in UI/logs.

## UC-06 — Accept valid check-in

- **Actor / goal:** Gate/Security Staff admits a valid participant once.
- **Preconditions:** UC-05 request; REGISTERED credential/registration, non-Cancelled Live event, correct event/gate, authorized operator, allowed attendance state. Registration-cap fullness does not itself reject at the gate.
- **Main flow:** Validate all guards transactionally → record scan decision and accepted transition → derive occupancy change → return clear acceptance with correlation ID.
- **Alternates:** When check-out is enabled, accepted exit moves INSIDE → LEFT and permits later LEFT → INSIDE. Without check-out, accepted entry remains INSIDE and no exit/re-entry is inferred.
- **Failures:** Revoked/wrong-event/unauthorized/technical errors are not accepted and do not change occupancy.
- **Postconditions:** One accepted transition exists; authoritative attendance reflects it; live publication can follow asynchronously.
- **Security:** Idempotency, concurrency control, minimal participant detail, audit evidence.

## UC-07 — Reject duplicate or replay scan

- **Actor / goal:** Gate/Security Staff receives an unambiguous duplicate/policy decision.
- **Preconditions:** UC-05 request for a credential whose attendance state already conflicts with policy, or replay of a prior request.
- **Main flow:** Detect existing attendance state/scan_id → return original decision for same-scan_id transport retry or duplicate/policy rejection for a new conflicting scan → preserve occupancy.
- **Alternates:** A new scan after valid check-out may accept re-entry when check-out is enabled.
- **Failures:** Concurrency cannot create two accepted entries; unclear state yields technical/deferred result.
- **Postconditions:** No extra accepted transition; scan evidence/replay semantics recorded under the approved audit rule.
- **Security:** Atomic checks, replay handling, reason code without exposing unnecessary identity.

## UC-08 — Update occupancy

- **Actor / goal:** System presents a count derived from accepted attendance transitions.
- **Preconditions:** UC-06 accepted check-in/check-out or authorized reasoned correction transition/event.
- **Main flow:** Persist transition → update/rebuild projection → attach revision/freshness → make snapshot available to UC-09.
- **Alternates:** Delayed projection shows stale/degraded state while authoritative transitions remain durable.
- **Failures:** Rejected/duplicate scans and failed projection delivery do not alter authoritative count.
- **Postconditions:** Occupancy reconciles with approved transition policy.
- **Security:** Organizer/Admin corrections require actor, mandatory reason, and audit; history remains append-only and public clients cannot mutate counts.

## UC-09 — Update live command center

- **Actor / goal:** Organizer/Admin sees current event operations.
- **Preconditions:** Authorized event access; authoritative snapshot and scoped live channel available.
- **Main flow:** Load snapshot → subscribe to event updates → show currently INSIDE occupancy separately from REGISTERED registrations, one event capacity, gate activity, and exactly three alert categories: occupancy-capacity (near-90% WARNING, 100% CRITICAL), gate/scanner failure, data/forecast staleness. Show ACTIVE/ACKNOWLEDGED/RESOLVED and freshness; Organizer/Admin may acknowledge/resolve. Deduplicate persistent conditions and reconcile after reconnect. Registration-full is not an alert.
- **Alternates:** Live channel unavailable shows last-known time and degraded state; refresh authoritative snapshot.
- **Failures:** Missed/out-of-order updates cannot silently masquerade as current data.
- **Postconditions:** User sees current or explicitly stale operational state.
- **Security:** Authenticate/authorize subscription and each event scope; minimize participant data.

## UC-10 — Retrieve crowd forecast

- **Actor / goal:** Organizer/Admin inspects advisory near-term occupancy/arrival information.
- **Preconditions:** Event access; forecast service has sufficient recent input or can report why not.
- **Main flow:** Read 30- and 60-minute forecasts → show current occupancy, predicted occupancy, capacity, generation time, input window/freshness, method/version, uncertainty and observed-versus-predicted distinction.
- **Alternates:** Sparse/stale data shows unavailable/degraded reason and observed values remain usable.
- **Failures:** Forecast timeout/error never changes attendance or gate policy and never invents values.
- **Postconditions:** Forecast is available with limitations or explicitly unavailable.
- **Security:** Scoped access, validated input provenance, no unnecessary PII to model service.

## UC-11 — Evaluate certificate eligibility

- **Actor / goal:** System determines whether a participant meets an event's approved certificate rule.
- **Preconditions:** Rule/version exists and the event/attendance state permits evaluation.
- **Main flow:** Read first accepted check-in and current registration state → return ELIGIBLE only for a non-CANCELLED registration; store rule/version and reason. Duration/check-out are not MVP criteria. Eligibility alone does not generate or send.
- **Alternates:** Missing evidence gives pending/unavailable rather than false eligibility.
- **Failures:** Conflicting/unapproved rule blocks issue; decision remains auditable.
- **Postconditions:** Reproducible eligibility decision, without necessarily issuing an artifact.
- **Security:** Own/authorized access; avoid exposing another participant's attendance.

## UC-12 — Generate or access certificate

- **Actor / goal:** Eligible Participant accesses own certificate; Organizer/Event Admin explicitly issues or revokes.
- **Preconditions:** UC-11 ELIGIBLE and authorized Organizer/Event Admin issue action.
- **Main flow:** Explicit single or bulk issue moves ELIGIBLE → ISSUED and generates a traceable unique-ID PDF → participant opens/downloads own artifact → show NOT_ELIGIBLE/ELIGIBLE/ISSUED/REVOKED.
- **Alternates:** Previously ISSUED certificate is reused; explicit revocation is auditable. Registration cannot be cancelled after accepted check-in. Email delivery is separate (UC-20), so FAILED email does not un-issue.
- **Failures:** Ineligible, pending, revoked, or failed generation shows a distinct state.
- **Postconditions:** Artifact/status and source decision can be reconstructed.
- **Security:** Ownership, controlled artifact access, auditable issue/reissue/revoke.

## UC-13 — Record and inspect audit event

- **Actor / goal:** System records critical actions; authorized Organizer/Admin investigates them.
- **Preconditions:** A relevant scan, lifecycle, role, credential, correction, certificate, or sensitive access event occurs.
- **Main flow:** Capture actor/action/target/time/outcome/correlation → persist append-oriented evidence → permit scoped authorized search.
- **Alternates:** Async presentation may lag; critical transactional evidence cannot be silently lost.
- **Failures:** Audit write failure on a critical protected action follows a fail-safe policy TBD; raw secrets/QR values never enter records.
- **Postconditions:** Decision can be reconstructed; audit access is itself auditable.
- **Security:** Restricted access, integrity, retention, redaction, least privilege.

## UC-14 — Perform volunteer operation

- **Actor / goal:** Volunteer progresses only their own bounded titled assignment.
- **Preconditions:** Authenticated Volunteer with current event assignment and approved task permission.
- **Main flow:** Open own assignment → read title, instructions, applicable time/location → progress ASSIGNED → IN_PROGRESS → COMPLETED.
- **Alternates:** Unassigned/no task shows empty state and escalation contact; blocked task follows escalation path TBD.
- **Failures:** Volunteer cannot manage participants, scan gates, correct occupancy, configure events, access admin functions, or receive general alerts.
- **Postconditions:** Task status is visible to permitted staff and auditable if operationally significant.
- **Security:** Event/task-scoped permission; no inherited admin privilege.

## UC-15 — Discover published event

- **Actor / goal:** Participant finds and evaluates an event before registration.
- **Preconditions:** Event is Published and visible under approved discovery policy.
- **Main flow:** Find PUBLIC Published event in catalog or open PRIVATE Published event by valid opaque event-scoped controlled link → read permitted details and registration availability → continue to UC-03 when registration is available. Organizer alone issues, revokes or reissues at most one active PRIVATE link per event; reissue immediately invalidates the old proof. There is no automatic time-based link expiry in MVP; access ends on revoke/replace or leaving PRIVATE Published. Link possession suffices for allowlisted detail viewing without login or guest OTP. Public details are limited to name, description, date, start/end time, public venue/location, organizer-provided image/banner, registration availability, remaining/available indication, and public category/tags.
- **Alternates:** Closed/full event remains viewable only as approved; cancelled/unpublished event shows safe unavailable state.
- **Failures:** Private/draft details, participant lists/contact, QR credentials, internal operations, live occupancy, alerts, admin data, and audit logs are not disclosed through public discovery.
- **Postconditions:** Participant understands availability and next action.
- **Security:** PRIVATE events never enter the PUBLIC catalog; enforce server validation of the event-bound controlled link, active state, PRIVATE visibility, Published state and public field allowlist. Malformed, revoked, mismatched, non-PRIVATE/non-Published and unknown/unauthorized attempts share one privacy-safe unavailable response; the old proof fails on the next read after revoke/reissue. A guessed event ID is not access. Account/guest verification is reserved for registration ownership, not PRIVATE detail viewing.

## UC-16 — Assign event role

- **Actor / goal:** Organizer alone grants Event Admin access; Organizer/Event Admin assign gate staff or volunteer access within their permitted event scope.
- **Preconditions:** Event exists; actor has assignment authority; target account/identity is verified.
- **Main flow:** Select event and approved role/task/gate scope → validate separation and duplicate assignment → save → show effective access and audit event.
- **Alternates:** Revoke/change assignment through an equally controlled action.
- **Failures:** Cross-event, self-escalation, Event Admin promotion of another admin, or unsupported task action is denied.
- **Postconditions:** Only approved event-scoped permission applies.
- **Security:** Deny by default, authorization and audit of grant/revoke, session invalidation as needed.

## UC-17 — Review completed-event results

- **Actor / goal:** Organizer/Admin reviews attendance, gate patterns, certificate state, and limitations after completion.
- **Preconditions:** Completed event and authorized event access.
- **Main flow:** Open results → see reconciled counts and data quality → inspect permitted breakdowns/audit evidence. Export requires a later explicit policy and is not an MVP grant.
- **Alternates:** Missing exit/history data is labeled; comparison to another event only when comparable.
- **Failures:** Incomplete projection is not presented as final; unauthorized export denied.
- **Postconditions:** A traceable, privacy-safe operational summary is available.
- **Security:** Event-scoped access, minimized PII, controlled exports.

## UC-18 — Cancel and re-register

- **Actor / goal:** Verified participant/guest cancels before cutoff and first accepted check-in, or Organizer/Event Admin cancels before first accepted check-in regardless of cutoff; the participant may later make a new registration.
- **Preconditions:** Existing REGISTERED registration with no accepted check-in; guest proves ownership with OTP for self-service cancellation.
- **Main flow:** Verify no accepted check-in → enforce event-defined cutoff (event start if absent) for participant action → retain row/history but mark CANCELLED with cancelled_at/by → free REGISTERED capacity spot → invalidate old QR → reopen registration only if capacity was the sole closure cause and the Published event is otherwise open. A new registration receives a new token.
- **Alternates:** After accepted check-in, deny cancellation to every role; occupancy changes only through valid check-out or authorized reasoned correction. Certificate problems use explicit issue/revoke, not registration cancellation.
- **Failures:** Unauthorized/late/post-check-in cancellation or concurrent capacity changes cannot silently succeed. A CANCELLED + INSIDE state is never created; historical attendance/audit is never deleted.
- **Security:** Ownership and event-scoped authority, no resurrection of the old token, audit evidence.

## UC-19 — Preview and bulk-issue certificates

- **Actor / goal:** Organizer/Event Admin previews a built-in template/font style and explicitly issues one eligible certificate or starts a database-derived eligible bulk batch.
- **Preconditions:** First accepted check-in on non-CANCELLED registration has produced ELIGIBLE; mere eligibility has generated/sent nothing.
- **Main flow:** Preview → explicit single issue or create event/template Certificate Batch/Job → move eligible records to ISSUED while generating unique-ID PDFs → show eligible/generated counts, timestamps, status, and progress.
- **Failures:** Partial generation remains visible and retryable without duplicating an already issued certificate.
- **Security:** Event scope, controlled template data/artifact access, no CSV import or custom designer in MVP.

## UC-20 — Deliver and retry certificate email

- **Actor / goal:** System sends issued PDFs using a platform sender, optionally with Organizer Reply-To; Organizer/Event Admin monitor and retry failures.
- **Preconditions:** Issued certificate and batch delivery operation.
- **Main flow:** Queue asynchronous delivery → track PENDING → SENT or FAILED per certificate → show batch delivery counts → retry FAILED delivery safely.
- **Failures:** An ISSUED certificate can have FAILED delivery; retry must not create duplicate sends for the same certificate/delivery operation.
- **Security:** Recipient isolation, privacy-safe email, provider secrets, idempotent retry, and auditable status. Organizer Gmail OAuth is post-MVP.
