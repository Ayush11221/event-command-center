# Role and Permission Matrix

**Status:** Phase 1 locked boundaries plus explicit remaining action-level decisions; not an implemented policy. The API must enforce approved permissions server-side. Staff roles are event-scoped; a verified authenticated participant or OTP-verified guest owns only their registration/artifact.

Legend: `A` = allowed for the named event and action; `O` = only own record; `G` = only assigned event/gate; `TBD` = product approval required; `—` = denied by default. `Execute` covers lifecycle changes, scans, and other operational commands. “Delete” means destructive removal, not cancellation/revocation; normal MVP flows use explicit state changes.

| Resource / action | Event Organizer | Event Admin | Gate/Security Staff | Volunteer | Participant |
| --- | --- | --- | --- | --- | --- |
| Published event details: Read | A | A | G | A if assigned | PUBLIC catalog or valid PRIVATE controlled-link access |
| PRIVATE access link: Issue / Reissue / Revoke | A / A / A for owned PRIVATE Published event | — / — / — | — | — | — |
| Event: Create draft / Read / Update assigned draft | A / A / A | — / A / A | — / G / — | — / assigned summary / — | — / permitted details / — |
| Event: Delete | — | — | — | — | — |
| Event: Publish / Start / Complete / Cancel | A / A / A / A | — / — / — / — | — | — | — |
| Event configuration/capacity: Read / Update | A / A in Draft/Published; Live policy changes restricted | A for assigned event / only name, description, public venue/location, image/banner, and public category/tags in assigned Draft/Published; no capacity or other policy update | G / — | assigned summary / — | permitted public details / — |
| Registration availability: Configure times / Manually close / Reopen manual closure | A / A / A | — / — / — | — | — | — |
| Registration: Create / Read / Cancel / Delete | — / A summary / A only before accepted check-in / — | — / A operational / A only before accepted check-in / — | — / G limited result/history / — / — | — | O after verification / O / O before cutoff and accepted check-in; guest OTP / — |
| Credential: Create or reissue / Read / Revoke / Delete | — / A metadata / — / — | — / A metadata / — / — | — / G validation result / — / — | — | O via approved own flow / O / O via approved own flow / — |
| Gate: Create / Read / Update / Delete | A / A / A / — | A / A / A / — | — / G / — / — | — | — |
| Event Admin assignment: Grant / Read / Revoke | A / A / A | — / assigned event summary / — | — | — | — |
| Gate/volunteer assignment: Create / Read / Update / Delete | A / A / A / — | A / A / A / — | — / own / — / — | — / own / — / — | — |
| Volunteer task: Create / Read / Edit details / Reassign / Progress / Cancel | A / A including history / ASSIGNED or IN_PROGRESS / ASSIGNED only / — / ASSIGNED or IN_PROGRESS with reason | A / A including history / ASSIGNED or IN_PROGRESS / ASSIGNED only / — / ASSIGNED or IN_PROGRESS with reason | — | — / current own non-CANCELLED / — / — / own ASSIGNED → IN_PROGRESS → COMPLETED / — | — |
| QR scan and attendance: Execute / Read | — / A summary | — / A operational | G / G result, display name, registration/attendance status, event context, assigned-gate history | — / — | — / O status |
| Attendance correction: Execute | A with reason/audit | A with reason/audit | — | — | — |
| Command center and forecast: Read | A | A | — beyond assigned-gate errors | — | — |
| Alert stream: Read / Acknowledge / Resolve | A full / A / A | A full / A / A | G operational errors only / — / — | — / — / — | — |
| Certificate template/preview/batch: Manage | A | A for assigned event | — | — | — |
| Certificate issue: Single / Bulk | A / A | A / A for assigned event | — | — | — |
| Certificate: Read / Revoke / Delete | A event status / A / — | A event operational / A / — | — | — | O issued artifact / — / — |
| Certificate delivery: Read / Retry | A event batch / A failed send | A event batch / A failed send | — | — | O delivery status / — |
| Completed results: Read / Export | A / — without separate policy | A / — without separate policy | — | — | — |
| Audit events: Read / Export / Change | A restricted event scope / — / — | A restricted assigned-event scope / — / — | — | — | — |

## Rules that apply to every cell

- A role never grants access to another event. Account ownership and event assignment must be checked on each protected request.
- A verified Participant or OTP-verified Guest may access only their own registration, credential, attendance status, and certificate. Guest self-cancellation requires fresh OTP verification. No role can cancel a registration after its first accepted check-in; participant cancellation also obeys the cutoff.
- Gate staff may see only display name, registration status, relevant attendance status, event context, and scan result, plus assigned-gate history. Email, phone, OTP information, credentials, and unnecessary personal data are denied.
- Volunteers may update only their own titled assignment with instructions and applicable time/location through ASSIGNED → IN_PROGRESS → COMPLETED. They cannot scan, manage participants, correct occupancy, configure events, access admin functions, or receive the general alert stream.
- Slice 11 staff task management never grants the right to perform volunteer progress. A separately held current Volunteer assignment may authorize only that person's own task. Staff edit only ASSIGNED/IN_PROGRESS, reassign only ASSIGNED, and cancel ASSIGNED/IN_PROGRESS with a nonblank reason up to 500 characters. COMPLETED/CANCELLED are terminal and immutable; cancelled records remain staff-visible and are excluded from volunteer access. Exactly one volunteer remains bound to each task. See the [final Slice 11 contract](../api/API_CONTRACT.md#slice-11--implementation-contract-finalized-implemented).
- Organizer alone controls event lifecycle, including Live cancellation, and manual registration closure/reopening. An assigned Event Admin may configure that event's gates separately from the narrow Draft/Published detail-edit allowlist, but may not edit ownership, lifecycle, capacity, schedule/time zone, visibility, registration opening/closing times, cancellation cutoff, attendance or certificate policy, or other unlisted configuration. Neither role has an unrestricted Live event-detail PATCH; Live registration/attendance policy edits are restricted. Event Admin cancellation authority applies only to pre-check-in individual registrations, never the event. A Cancelled event blocks new registration/check-in without rewriting existing registration rows.
- System-controlled QR creation/replacement/invalidation follows approved own-registration and cancellation flows; no direct staff credential issue/revoke or unrestricted audit/export action is granted. Organizer/Admin may acknowledge/resolve event alerts and retry failed certificate email; gate/volunteer/participant roles may not.
- Create and update commands must be audited where they affect security or operations. Destructive removal is absent from the ordinary MVP workflow; cancellation, revocation, and correction have explicit policies.
- A person holding multiple roles does not bypass resource ownership, event scope, or separation rules. Role combination policy is TBD.
- PUBLIC Published events appear in the catalog; PRIVATE Published details require a valid opaque event-scoped controlled link and are never listed publicly. At most one link is active per event; only the owning Organizer may issue, revoke or reissue it, and reissue invalidates the old proof immediately. There is no automatic time-based link expiry in MVP. Link possession authorizes only allowlisted PRIVATE Published detail viewing without login or guest OTP; it never grants management or registration ownership. A guessed event ID is not proof; invalid/unauthorized link reads safely conceal event existence.

The matrix records locked MVP boundaries. It does not authorize an `A` operation without event-scope checks, negative authorization tests, and audit behavior. See [SECURITY_PLAN.md](../security/SECURITY_PLAN.md) and [OPEN_PRODUCT_DECISIONS.md](OPEN_PRODUCT_DECISIONS.md).
