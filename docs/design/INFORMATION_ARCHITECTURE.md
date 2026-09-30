# Information Architecture

**Status:** Phase 1 navigation and content hierarchy, not visual design or routes. Screen IDs are in [SCREEN_INVENTORY.md](SCREEN_INVENTORY.md).

## Structural principle

The event is the primary context for staff work. The participant's own registration is the primary context for attendee work. A user with more than one event or role must always know which event and role context is active; role-switch behavior is TBD. Do not place scanner and admin actions in one undifferentiated navigation list.

## Hierarchy

```text
Public
  PUBLIC Published event catalog; PRIVATE controlled-link entry (S-PUB-01)
    Event details/availability (S-PUB-02)
      Verified authenticated or guest-OTP registration (S-PUB-03)
Verified participant or guest
  My event and credential (S-PAR-01)
    Certificate status/artifact (S-PAR-02)
Authenticated organizer/admin
  Event workspace (S-ORG-01)
    Event setup and lifecycle (S-ORG-02)
    Gates and staff assignments (S-ORG-03)
    Live command center (S-ORG-04)
    Registrations/participants (S-ORG-05)
    Results and certificates (S-ORG-06; explicit single/bulk issue)
      Built-in template/font preview; bulk batch/job progress
      Independent PDF issue and email delivery/retry states
    Audit evidence (S-ORG-07)
Authenticated gate staff
  Assigned event/gate scanner and inline result (S-GAT-01)
Authenticated volunteer
  Own assignment and bounded task status (S-VOL-01)
```

## Navigation and landing

| Experience | Entry/landing after authentication | Primary navigation | Event-level context and critical action |
| --- | --- | --- | --- |
| Public | PUBLIC catalog or PRIVATE controlled link/invitation | Public catalog, allowlisted event details, registration | PRIVATE event never appears in catalog or leaks details through discovery; public pages exclude participant, credential, internal, live occupancy, alert, admin, and audit data. |
| Participant/verified guest | Own event/registration (`S-PAR-01`) after account or OTP verification | My event/credential, cancellation before cutoff and accepted check-in, certificate, recovery | Guest has no permanent-account requirement; cancelled QR is not active. Cancellation control disappears after first accepted check-in. |
| Organizer/Admin | Event workspace (`S-ORG-01`) | Owned/assigned events, selected event destinations, account/session | Organizer alone creates and controls lifecycle, event cancellation, and manual registration closure/reopening. Admin operates assigned event without those controls. Gates/staff live in `S-ORG-03`; live investigation in `S-ORG-04`. |
| Gate/Security | Assigned event/gate context then scanner (`S-GAT-01`) | Assigned gate, scanner, assigned-gate history | Confirm context; show only display name, registration/attendance status, event context, scan result—not contact/OTP/credentials. |
| Volunteer | Own assignment (`S-VOL-01`) | Assigned event/task and status | ASSIGNED → IN_PROGRESS → COMPLETED stays with assignment; no admin or general-alert navigation. |

The account and guest-OTP verification/recovery paths are MVP entry responsibilities; exact provider, screen split, multi-event/role switching, and account settings surface remain design/technical follow-ups. Do not make a guest create a permanent account.

## Event-level information grouping

- **Setup:** draft details, one REGISTERED-registration cap, optional registration opening/closing times (publication default opening), manual Organizer closure, schedule, publication readiness, Organizer-only lifecycle including Live cancellation; Published detail edits and restricted Live policy edits.
- **Operations:** current INSIDE occupancy distinct from REGISTERED count, gate activity, three alert categories with Organizer/Admin acknowledge/resolve, forecast, freshness, and degraded status.
- **People and access:** registrations, gate assignments, staff/volunteer roles; access differs by role.
- **Results and certificates:** completed-event results, accepted-check-in ELIGIBLE state, explicit Organizer/Admin single or bulk issue, built-in certificate preview, batch generation/delivery progress and Organizer/Admin retry, participant artifact, explicit revoke, and restricted event-scoped audit evidence. Post-check-in registration cancellation is forbidden.

Do not duplicate the same live metric as multiple conflicting sources. The command center uses one authoritative snapshot plus reconcilable updates. Participant status is self-owned; staff see aggregates unless a task justifies detail.

## Important entry and failure paths

- A QR may be reached from the participant's own event, but a scanner never opens from a public event page.
- A gate operator landing without an assigned gate sees an authorization/assignment state, not a usable camera.
- Organizer alone sees lifecycle/event-cancel and manual registration close/reopen controls. Live cancellation is available to Organizer. A Cancelled event retains existing registrations/history but offers no new registration or check-in. Live always closes registration. Live-only controls are unavailable outside Live.
- If a live connection fails, retain visible event context and last-known timestamp while offering reconciliation.
- A controlled link to a PRIVATE Published event may reach permitted details; a draft, cancelled, or forbidden event never becomes public merely because a link is known.

## Unresolved navigation decisions

Multi-event/role switching and exact authentication route split remain design work. The [decision register](../requirements/OPEN_PRODUCT_DECISIONS.md) locks publication-default opening, Live closure/cancellation, Published editing/Live policy restrictions, and alert authority; later technical details do not add new MVP navigation by default.
