# Information Architecture

**Status:** Phase 1 navigation and content hierarchy, not visual design or routes. Screen IDs are in [SCREEN_INVENTORY.md](SCREEN_INVENTORY.md).

## Structural principle

The event is the primary context for staff work. The participant's own registration is the primary context for attendee work. In Slice 3, an application-shell context is the selected Event and effective authorized role for that Event. A user with more than one authorized event/role context must always know which is active; the shell provides an Event + Role switcher. This is a UI selection, never an authorization mechanism. Do not place scanner and admin actions in one undifferentiated navigation list.

## Hierarchy

```text
Public
  PUBLIC Published event catalog; valid PRIVATE Published controlled-link entry (S-PUB-01)
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
| Public | PUBLIC Published catalog or valid PRIVATE Published controlled bearer link | Public catalog and allowlisted Published detail; registration is a later-slice action | PRIVATE event never appears in catalog; link possession suffices for allowlisted viewing without login/OTP but not registration ownership. Invalid/invalidated/non-Published links are safely unavailable; public pages exclude participant, credential, internal, live occupancy, alert, admin, and audit data. |
| Participant/verified guest | Own event/registration (`S-PAR-01`) after account or OTP verification | My event/credential, cancellation before cutoff and accepted check-in, certificate, recovery | Guest has no permanent-account requirement; cancelled QR is not active. Cancellation control disappears after first accepted check-in. |
| Organizer/Admin | Event workspace (`S-ORG-01`) | Server-scoped owned/assigned event list and management detail, selected event destinations, account/session | Organizer alone creates and controls lifecycle, event cancellation, capacity, manual registration closure/reopening, and PRIVATE-link issue/revoke/reissue for owned PRIVATE Published events. Admin's ordinary Draft/Published event edits are only name, description, public venue/location, image/banner, and public category/tags; gate setup is separate and Admin cannot mutate link. Gates/staff live in `S-ORG-03`; live investigation in `S-ORG-04`. |
| Gate/Security | Assigned event/gate context then scanner (`S-GAT-01`) | Assigned gate, scanner, assigned-gate history | Confirm context; show only display name, registration/attendance status, event context, scan result—not contact/OTP/credentials. |
| Volunteer | Own assignment (`S-VOL-01`) | Assigned event/task and status | ASSIGNED → IN_PROGRESS → COMPLETED stays with assignment; no admin or general-alert navigation. |

### Slice 3 active context

- One authorized Event + Role context is selected automatically without an extra selection step. When more than one exists, show the Event + Role context switcher, including distinct effective authorized roles on the same Event.
- On login, restore the last locally remembered context only if the server's current owner/assignment data still authorizes it. Otherwise select an available authorized context. If none exists, show the staff-workspace empty state; do not imply the user has event authority. Public discovery remains separate and does not acquire a staff context.
- The selected context controls displayed event data, navigation, available management actions, and UI scope. Recheck/refresh the displayed scope after switching or losing assignment. Every protected backend request independently verifies the authenticated session, Event relationship, current role/assignment, and requested action; a stored or client-selected context grants nothing.
- Contexts may reflect currently authorized Gate/Security or Volunteer assignments as well as Organizer/Admin roles, but selecting one does not create a Slice 3 scanner or volunteer-task screen. A selected role with no Slice 3 management destination shows no management action; later role-specific destinations stay in their owning slices.
- Context memory is a local UI convenience, not an authorization token or new database field. This does not create an organization/workspace hierarchy, cross-event permission, global Admin role, or new role type.

The account and guest-OTP verification/recovery paths are MVP entry responsibilities; exact provider, authentication screen split, and account settings surface remain design/technical follow-ups. Do not make a guest create a permanent account.

## Event-level information grouping

- **Setup:** draft details, one REGISTERED-registration cap, optional registration opening/closing times (publication default opening), manual Organizer closure, schedule, a configured Event–Gate association for Publish and independently for Live, Organizer-only lifecycle including Live cancellation; narrow assigned-Admin Draft/Published public-detail edits and restricted Live policy edits.
- **Operations:** current INSIDE occupancy distinct from REGISTERED count, gate activity, three alert categories with Organizer/Admin acknowledge/resolve, forecast, freshness, and degraded status.
- **People and access:** registrations, gate assignments, staff/volunteer roles; access differs by role.
- **Results and certificates:** completed-event results, accepted-check-in ELIGIBLE state, explicit Organizer/Admin single or bulk issue, built-in certificate preview, batch generation/delivery progress and Organizer/Admin retry, participant artifact, explicit revoke, and restricted event-scoped audit evidence. Post-check-in registration cancellation is forbidden.

Do not duplicate the same live metric as multiple conflicting sources. The command center uses one authoritative snapshot plus reconcilable updates. Participant status is self-owned; staff see aggregates unless a task justifies detail.

## Important entry and failure paths

- A QR may be reached from the participant's own event, but a scanner never opens from a public event page.
- A gate operator landing without an assigned gate sees an authorization/assignment state, not a usable camera.
- Organizer alone sees lifecycle/event-cancel and manual registration close/reopen controls. Live cancellation is available to Organizer. A Cancelled event retains existing registrations/history but offers no new registration or check-in. Live always closes registration. Live-only controls are unavailable outside Live.
- If a live connection fails, retain visible event context and last-known timestamp while offering reconciliation.
- A valid opaque controlled bearer link to a PRIVATE Published event reaches only permitted details without login/guest OTP; malformed/revoked/invalid proof, a non-PRIVATE or non-Published event, and unknown/unauthorized access give the same safe unavailable result without disclosing existence. A guessed ID never grants PRIVATE access. There is no automatic time-based link expiry in MVP; Organizer revoke/reissue, or leaving PRIVATE Published, ends detail authority. The bounded Organizer link control is part of event setup, not a dedicated invitation/rotation dashboard.

## Unresolved navigation decisions

The Slice 3 Event + Role selection rule above is locked; exact authentication route split and account settings surface remain design work outside that decision. The [decision register](../requirements/OPEN_PRODUCT_DECISIONS.md) locks publication-default opening, Live closure/cancellation, Published editing/Live policy restrictions, and alert authority; later technical details do not add new MVP navigation by default.
