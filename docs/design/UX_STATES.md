# UX State Inventory

**Status:** Phase 1 behavior inventory. These are semantic states and recovery expectations, not styling, copy, or component specifications. The server's authoritative state wins over optimistic client assumptions.

## Shared states

| State | Meaning and minimum behavior |
| --- | --- |
| Loading | Identify what is pending; keep stable context and avoid implying success. |
| Empty | Explain why there is no event, registration, assignment, history, or forecast and give the allowed next action. |
| Success | Confirm the authoritative operation, its object/status, and next step. |
| Validation error | Identify affected input and how to correct it without losing valid input. |
| Error | State that an operation failed; preserve context and correlation/reference when useful. |
| Unauthenticated | Offer the approved sign-in/recovery entry without exposing protected data. |
| Forbidden | Explain lack of event/role permission without revealing another person's details. |
| Stale data | Show last confirmed time and affected data; do not label it live. |
| Network failure | Distinguish unsent, pending, and unknown-result requests; make retries safe. |
| Service unavailable | Name the affected capability and show what remains usable. |
| Degraded real-time connection | Preserve timestamped snapshot, indicate reconnection, then reconcile from authoritative state. |

Slice 3 applies the locally persisted Light, Dark or System preference before rendering every shared state, including unauthenticated public entry. System reacts to OS color-scheme changes while open. Theme changes presentation only and cannot alter status meaning, Event + Role context, or access.

## Workflow-specific state and recovery

| Surface / workflow | Important states | Required distinction or recovery |
| --- | --- | --- |
| Event discovery/details (`S-PUB-01/02`) | PUBLIC Published catalog; valid PRIVATE Published controlled link; malformed/revoked/mismatched link or non-PRIVATE/non-Published/unknown event shares safe unavailable state; Published policy NOT_OPEN_YET, OPEN, SCHEDULED_CLOSE_REACHED, MANUALLY_CLOSED; load failure. | Opaque link possession suffices for allowlisted PRIVATE detail without login/OTP, not for registration ownership. A guessed ID is not access. No time TTL in MVP; revoke/reissue or leaving PRIVATE Published ends authority. Public detail is Published-only and excludes participant/contact/QR/internal/live occupancy/alert/admin/audit data. Slice 3 cannot assert REGISTERED-cap full, remaining count, or a functioning registration action; Live/Completed/Cancelled explanations belong to scoped management views. |
| Registration (`S-PUB-03`) | Account verified, guest OTP pending/verified/failed, editing, duplicate REGISTERED identity, scheduled/capacity/manual/Live closure, Cancelled event, confirmed, technical unknown. | Never claim registration from timeout. Capacity-only closure may lift after pre-check-in cancellation while Published; manual/scheduled/Live closure does not. |
| Own QR/cancellation (`S-PAR-01`) | REGISTERED, CANCELLED, cancellation pending/cutoff passed/first accepted check-in, active/missing/expired/revoked QR, INSIDE/LEFT, Cancelled event. | Guest cancellation needs OTP; old QR rejects as CANCELLED and re-registration uses new token. Hide/disable cancellation after accepted check-in even if later LEFT; no CANCELLED + INSIDE state. Event cancellation retains registration row unchanged; no new check-in. |
| Event setup (`S-ORG-02`) | Draft incomplete including no configured Gate, ready/publishing, Published, Live, Completed, Cancelled; default/future opening, optional close, scheduled/manual/Live registration closure, concurrent edit/forbidden; PRIVATE link absent/active/revoked/reissued and unknown mutation result. | Organizer alone sees lifecycle, manual close/reopen and bounded PRIVATE-link issue/revoke/reissue controls; old proof fails immediately and raw URL is shown only in protected issue/replay response. Publish requires a configured Event–Gate association; Live independently rechecks it. Admin edits only named assigned Draft/Published public details and cannot mutate link, capacity, visibility, schedule or policy. Scope, revision and permitted actions come from management detail; capacity-based closure is explained only after Slice 4 has registration facts. |
| Event + Role context (`S-ORG-01/02/03` in Slice 3) | One authorized context auto-selected; multiple contexts show switcher; remembered context pending authorization, restored, replaced, or unavailable; no authorized context empty state; context changed or assignment revoked. | Display current Event and effective authorized Role. Selection scopes navigation/data/actions but never grants permission. Restore local memory only after current server-scope validation; otherwise select an authorized context or show empty state. Clear stale scoped content and re-fetch when context changes or access is lost. |
| Gate/staff setup (`S-ORG-03`) | No associated Gate, configured Gate, unassigned role, valid assignment, conflicting/forbidden grant, revoked assignment. | Authorized persistent Event–Gate association suffices for Publish/Live configuration. Staff assignment and operational scanner readiness are separate; show effective event/gate scope and do not imply a volunteer can scan. |
| Gate scanner (`S-GAT-01`) | Ready, validating, accepted, duplicate/same-scan_id replay, invalid/expired/revoked/CANCELLED registration, Cancelled event, timeout/unknown, unavailable. | Show only display name, registration/attendance status, event context, result. No email/phone/OTP/credentials. Failed/unknown holds entry; registration cap fullness is not a separate gate block. |
| Attendance/occupancy (`S-ORG-04`) | INSIDE current, delayed projection, discrepancy, reasoned correction pending/applied, source unavailable; REGISTERED count separately. | Compare live occupancy against one event capacity without equating it to registration count. Only accepted attendance transitions, including authorized correction events, change projection. |
| Live command center/alerts (`S-ORG-04`) | Snapshot loading/current/partial; capacity WARNING near 90% and CRITICAL at 100% INSIDE occupancy; gate/scanner failure; data/forecast staleness; ACTIVE/ACKNOWLEDGED/RESOLVED; reconnecting/unauthorized. | REGISTERED full is not an alert. Persistent condition creates no duplicate active alert; Organizer/Admin full stream and acknowledge/resolve; gate assigned-gate errors read-only; volunteer none. |
| Forecast (`S-ORG-04`) | 30/60-minute available, pending, insufficient history, stale input/forecast, unavailable, invalid result. | Show current occupancy versus predicted occupancy and capacity, both horizons, generation time, freshness, uncertainty; never fabricate a value or trigger autonomous policy. |
| Certificate (`S-PAR-02`, `S-ORG-06`) | NOT_ELIGIBLE, ELIGIBLE awaiting explicit issue, ISSUED, REVOKED; single/bulk preview, batch pending/running/partial/complete/failure; delivery PENDING/SENT/FAILED/RETRY. | First accepted check-in grants ELIGIBLE only. Explicit Organizer/Admin issue generates unique-ID PDF; Organizer/Admin may retry failed email. Post-check-in registration cancellation is forbidden; email failure does not invalidate ISSUED. Show batch progress/retry/audit separately. |
| Audit/results (`S-ORG-06/07`) | Empty, loading, partial/incomplete, reconciled, forbidden, export unavailable. | Label data quality and access limits; no false final summary. |
| Volunteer task (`S-VOL-01`) | No assignment, ASSIGNED, IN_PROGRESS, COMPLETED, blocked, revoked/stale assignment, save failure. | Own title/instructions/applicable time/location and status only; never claim completion from unsaved update. |

## Accessibility and communication rules

- Status meaning must have text and accessible semantics, not color or animation alone.
- Scan outcomes and live changes need controlled screen-reader announcement without constant interruption.
- Focus remains predictable after validation, modal confirmation, reconnect, and repeated scan.
- Reduced-motion preference must not remove essential feedback.
- Gate and command-center interfaces must keep critical data legible under time pressure and degraded network conditions.
