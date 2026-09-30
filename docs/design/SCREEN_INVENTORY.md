# Screen Inventory

**Status:** Phase 1 information and responsibility inventory. A screen is a distinct task surface, not necessarily a route or implementation component. Related details, scan results, and states can live within one screen. `P0` supports the core demonstration; `P1` supports the complete MVP. See [MVP_SCOPE.md](../requirements/MVP_SCOPE.md).

## Public and participant

| ID | Screen / persona | Purpose and entry | Primary actions | Important information and states | Use cases | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| S-PUB-01 | Event discovery/entry / Participant | PUBLIC Published catalog or PRIVATE controlled link/invitation. | Select/access event. | PUBLIC allowlisted listing, PRIVATE omitted without detail leakage, unavailable/forbidden. | UC-15 | P0 |
| S-PUB-02 | Event details / Participant | Decide whether to register; from discovery/link. | Continue only when Published registration is available. | Approved public fields only; default publication opening/future opening, scheduled/event-start close, REGISTERED-cap close, manual close, Live/Cancelled closure. No public live INSIDE occupancy. | UC-15, UC-03 | P0 |
| S-PUB-03 | Registration / Participant or verified guest | Verify account contact or guest OTP; submit minimum data. | Register or recover own registration. | OTP failure, duplicate REGISTERED identity, scheduled/capacity/manual/Live closure, Cancelled event, technical unknown. | UC-03 | P0 |
| S-PAR-01 | My event and QR / Participant or verified guest | View own registration, credential, attendance; cancel before cutoff and first accepted check-in. | Show QR, cancel after ownership verification only before accepted check-in, re-register with new token if allowed. | REGISTERED/CANCELLED, valid/revoked QR, INSIDE/LEFT, Cancelled event with retained registration; cancellation disabled after accepted check-in. | UC-04, UC-18 | P0 |
| S-PAR-02 | Certificate / Participant or verified guest | View own ELIGIBLE state, issued artifact, and separate delivery status. | Open/download own issued PDF. | ELIGIBLE awaiting explicit issue; ISSUED/REVOKED; email PENDING/SENT/FAILED; post-check-in registration cannot be cancelled. | UC-11, UC-12, UC-20 | P1 |

## Organizer and Event Admin

| ID | Screen / persona | Purpose and entry | Primary actions | Important information and states | Use cases | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| S-ORG-01 | Event workspace / Organizer, Event Admin | Select an owned/assigned event; staff landing. | Open event; Organizer creates Draft. | Event state, ownership/scope, empty list, forbidden, load error. | UC-01 | P0 |
| S-ORG-02 | Event setup and lifecycle / Organizer; assigned Event Admin edit scope | Configure event and readiness; Organizer owns lifecycle and registration availability. | Organizer saves/publishes/starts/completes/cancels even from Live and configures times/manual close/reopen; Admin edits assigned settings only. | Publication-default/future opening, one REGISTERED cap, scheduled/event/Live/capacity/manual close, Published detail edits, restricted Live policy edits; Cancelled event retains registrations. | UC-01, UC-02, UC-03 | P0 |
| S-ORG-03 | Gates and assignments / Organizer, Event Admin | Configure gates and bounded staff/volunteer access; Organizer alone manages Event Admin grants. | Add/update gate, assign/revoke permitted role/task. | Gate context, effective scope, task status, forbidden admin promotion. | UC-16, UC-14 | P0 |
| S-ORG-04 | Live command center / Organizer, Event Admin | Monitor Live event. | Inspect INSIDE occupancy versus one capacity, separate REGISTERED count, gate activity, three alert categories, acknowledge/resolve, 30/60-minute forecast. | 90%-near WARNING/100% CRITICAL from live occupancy, gate/scanner failure, data/forecast staleness, no registration-full alert; deduplication/lifecycle/freshness. | UC-08, UC-09, UC-10 | P0 |
| S-ORG-05 | Registrations / Organizer, Event Admin | Investigate registration status without broad export. | Cancel individual registration only before first accepted check-in; inspect permitted status; make reasoned attendance correction. | After check-in cancel is disabled/denied; REGISTERED/CANCELLED, actor/time, returned capacity, retained attendance/audit, correction evidence; no CANCELLED + INSIDE state. | UC-03, UC-18, UC-13 | P1 |
| S-ORG-06 | Results and certificates / Organizer, Event Admin | Review outcomes and explicitly issue/revoke certificates. | Select built-in template/font, preview, issue one or create bulk batch, inspect batch/email progress, retry FAILED delivery, revoke explicitly. | ELIGIBLE does not imply issued PDF; unique-ID PDFs, generated/eligible/delivery counts, independent certificate/email states, audit/history. | UC-11, UC-12, UC-17, UC-19, UC-20 | P1 |
| S-ORG-07 | Audit evidence / Restricted Organizer, Event Admin | Investigate privileged and scan decisions; from event workspace/operations. | Search permitted event-scoped records; no unrestricted export. | Actor/action/time/outcome/correlation, redaction, retention, denied access. | UC-13 | P1 |

## Gate and volunteer

| ID | Screen / persona | Purpose and entry | Primary actions | Important information and states | Use cases | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| S-GAT-01 | Gate scanner and inline result / Gate/Security Staff | Validate opaque QR in assigned event/gate context; view assigned-gate history/operational alerts read-only. | Scan with unique scan_id, retry same scan_id, check out if enabled. | Display name, registration/attendance status, event/scan result only; Cancelled event/registration blocks check-in; no contact/OTP/credentials, alert acknowledgement, physical-cap gate block, or manual override. | UC-05, UC-06, UC-07, UC-08 | P0 |
| S-VOL-01 | Assignment and task status / Volunteer | Understand own bounded assignment. | Read title/instructions/applicable time/location; progress ASSIGNED → IN_PROGRESS → COMPLETED. | No task, stale/revoked assignment, blocked/save failure; no general alerts or admin navigation. | UC-14 | P1 |

**Count:** 14 task surfaces. `S-ORG-06` includes certificate preview, batch generation/progress, delivery failure/retry, and history as distinct states/panels; implementation may split it only after UX review, not by assumption. `S-ORG-04` owns dashboard/forecast; scan results stay inline in `S-GAT-01`. Account and guest-OTP verification are required entry flows, but their route/screen split awaits interaction design. A future requirement may justify splitting a dense surface, not a duplicate screen merely to match a folder name.
