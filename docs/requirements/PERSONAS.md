# Product Personas

**Status:** Phase 1 working specification. These are roles and needs, not permission grants. See [ROLE_PERMISSION_MATRIX.md](ROLE_PERMISSION_MATRIX.md).

## Event Organizer

| Aspect | Definition |
| --- | --- |
| Responsibilities | Create/own event, control all lifecycle transitions including Live cancellation, configure registration timing/manual closure, delegate operations, and review outcomes. |
| Goals | Launch a correctly configured event; understand attendance, capacity, gate activity, and forecast limitations; respond to exceptions. |
| Key tasks | Create/configure/publish event; open command center; review alerts, results, and audit evidence. |
| Pain points | Fragmented registration and gate counts; stale figures; uncertain forecast meaning; unclear accountability. |
| Information needed | Event state, distinct REGISTERED count and live INSIDE occupancy against one capacity, closure cause, freshness, gate status, alert/forecast evidence. |
| Required permissions | Event ownership/lifecycle and Event Admin assignments; reasoned correction, alert acknowledge/resolve, certificate issue/revoke/failed-email retry, and restricted event-scoped audit read. No post-check-in registration cancellation or unrestricted export/direct staff credential control. |
| Likely device/context | Desktop or tablet before/during event; frequent interruptions and time pressure during live operation. |
| Critical failures | Incomplete publication, stale occupancy presented as live, unacknowledged operational condition, unauthorized event access. |

## Event Admin

| Aspect | Definition |
| --- | --- |
| Responsibilities | Operate assigned events: individual registrations, gates, volunteers, command center, certificates/alerts, and reasoned corrections; cannot promote admins, transfer ownership, control lifecycle, or cancel the event. |
| Goals | Make configuration valid and staff access least-privileged; resolve operational exceptions without losing an audit trail. |
| Key tasks | Edit event settings, set capacity/gates, assign event roles, inspect registration/scan problems, manage allowed policy actions. |
| Pain points | Unclear permission boundaries, configuration changes after publication, ambiguous scan outcomes, missing correction history. |
| Information needed | Configuration state, registration/credential status, gate assignments, permission matrix, audit/correlation data. |
| Required permissions | Assigned-event operations including pre-check-in registration cancellation, alert acknowledge/resolve, explicit certificate issue/revoke and failed-email retry, and restricted event-scoped audit read. No event lifecycle/ownership, direct staff credential issue/revoke, or unrestricted export grant. |
| Likely device/context | Desktop for setup; tablet during event support. |
| Critical failures | Cross-event privilege leak, unintended gate access, untraceable configuration change, invalid capacity policy. |

## Participant / Attendee

| Aspect | Definition |
| --- | --- |
| Responsibilities | Review event information, register accurately, present own QR credential, follow entry policy, access certificate if eligible. |
| Goals | Know whether the event is available, complete registration quickly, find a valid credential, understand entry and certificate status. |
| Key tasks | Find PUBLIC event or use PRIVATE controlled link, verify authenticated contact or guest OTP, register/cancel before cutoff and first accepted check-in, access QR, present at gate, check status, obtain own certificate. |
| Pain points | Unclear eligibility/capacity, duplicate registration, missing or revoked QR, confusing rejection, poor mobile access. |
| Information needed | Event details and availability, registration status, QR validity, safe next steps after failure, certificate eligibility/result. |
| Required permissions | Approved PUBLIC/PRIVATE event details; own registration, cancellation, credential, attendance status, and certificate only after account/contact verification. |
| Likely device/context | Mobile browser, possibly weak connectivity or bright/crowded gate conditions. |
| Critical failures | Wrong-person data exposure, unusable QR, duplicate registration, unclear rejected scan, inaccessible recovery path. |

## Gate / Security Staff

| Aspect | Definition |
| --- | --- |
| Responsibilities | Validate credentials at an assigned event/gate and act on the authoritative scan decision. |
| Goals | Keep entry moving while preventing invalid or duplicate entry and preserving accurate occupancy. |
| Key tasks | Confirm event/gate/session, scan, distinguish accept/reject/technical error, handle duplicate result, check out where policy allows. |
| Pain points | Slow or unreliable camera/network, ambiguous success, accidental repeated scans, insufficient context for escalation. |
| Information needed | Current event/gate/operator, readiness/connectivity, scan result, display name, registration status, relevant attendance status, assigned-gate history and operational alerts; no contact/OTP/credentials. |
| Required permissions | Scan and view result/history/operational alerts at assigned gate; no alert acknowledgement/resolution, contact data, event administration, or occupancy correction. |
| Likely device/context | Mobile/tablet camera at a noisy, bright, time-critical entry point. |
| Critical failures | False acceptance, stale credential, duplicate transition, timeout interpreted as rejection, unauthorized gate use. |

## Volunteer

| Aspect | Definition |
| --- | --- |
| Responsibilities | Carry out an Organizer/Admin-assigned bounded titled task with instructions and applicable time/location. |
| Goals | Know what is assigned, where to go, what status to report, and whom to contact when blocked. |
| Key tasks | Open own assignment/instructions and progress ASSIGNED → IN_PROGRESS → COMPLETED. |
| Pain points | Unclear assignment, excessive access, stale instructions, no escalation path. |
| Information needed | Own title, instructions, applicable time/location, status, and escalation contact; no broad participant data. |
| Required permissions | Own assignment read/status only; no participant management, gate scan, correction, event configuration, admin functions, or general alerts. |
| Likely device/context | Mobile/tablet while moving around the venue, with interruptions and variable connectivity. |
| Critical failures | Assignment missing or outdated, unauthorized participant data exposure, task action mistaken for gate authorization. |

No additional persona is implied by a technical service or system administrator. If one becomes necessary, trace it to a product task first.
