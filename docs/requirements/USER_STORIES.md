# User Stories

**Status:** Phase 1 working specification. `P0` is the core demonstration, `P1` is supporting MVP work, and `P2` is post-MVP. Priority does not replace the [MVP scope](MVP_SCOPE.md) or remove any Must requirement from [REQUIREMENTS.md](REQUIREMENTS.md).

| ID | Priority | Story | Requirements |
| --- | --- | --- | --- |
| US-ORG-01 | P0 | As an Event Organizer, I want to create and configure a draft event, so that the event has a reliable operational starting point. | FR-EVT-001, FR-EVT-004 |
| US-ORG-02 | P0 | As an Event Organizer, I want to see what blocks publication, control lifecycle, and alone cancel even a Live event, so that invalid transitions and new registration/check-in after cancellation are prevented. | FR-EVT-002–003 |
| US-ORG-03 | P0 | As an Event Organizer, I want to see live INSIDE occupancy separately from REGISTERED registrations and compare it with event capacity, gate activity, and freshness, so that I can recognize conditions needing attention. | FR-LIVE-001, FR-LIVE-003 |
| US-ORG-04 | P1 | As an Event Organizer, I want to inspect a forecast with horizon, uncertainty, and data quality, so that I can use it as advice without confusing it with observed occupancy. | FR-FCST-001–005 |
| US-ORG-05 | P1 | As an Event Organizer, I want to review completed-event results and controlled audit evidence, so that I can investigate outcomes and decisions. | FR-ANL-001, FR-AUD-002 |
| US-ORG-06 | P1 | As an Event Organizer, I want the full stream of occupancy-capacity, gate failure, and staleness alerts and to acknowledge/resolve them, so that I can act without treating registration-full as an alert. | FR-ALERT-001–002 |
| US-ORG-09 | P0 | As an Event Organizer, I want to configure registration times and manually close/reopen registration, so that scheduled, capacity-based, and manual closure have distinct effects. | FR-REG-001, FR-EVT-004 |
| US-ORG-10 | P0 | As the owning Event Organizer, I want to issue, revoke or replace the one active PRIVATE access link, so that only the current proof opens allowlisted PRIVATE Published details without expanding Event Admin or registration authority. | FR-DISC-001 |
| US-ADM-01 | P0 | As an Event Admin, I want to configure assigned-event gates and edit only approved Draft/Published public details, so that event setup remains scoped without taking Organizer-only lifecycle, capacity, visibility, or registration-policy authority. | FR-EVT-001, FR-EVT-004, FR-EVT-005, FR-GATE-001 |
| US-ADM-02 | P0 | As an Event Admin, I want to assign event-scoped staff roles, so that each person receives only the access needed for the event. | FR-RBAC-001–002 |
| US-ADM-03 | P1 | As an Event Admin, I want to review audits of material configuration and credential changes, so that I can reconstruct their cause and outcome. | FR-EVT-005, FR-AUD-001 |
| US-ADM-04 | P1 | As an Event Admin, I want to preview and explicitly issue one or a bulk batch of eligible certificates, monitor delivery, and explicitly revoke when needed, so that eligibility alone never generates or sends an artifact. | FR-CERT-001–008 |
| US-ADM-05 | P1 | As an Event Admin, I want to make an authorized reasoned attendance correction, so that discrepancies can be resolved without overwriting history. | FR-ATT-003 |
| US-PAR-01 | P0 | As a Participant, I want to find approved PUBLIC event details or access a PRIVATE event by controlled link without private-detail leakage, so that I can decide whether to register. | FR-DISC-001, FR-EVT-003 |
| US-PAR-02 | P0 | As a verified authenticated participant or OTP-verified guest, I want to register once only while the Published event is open and below its REGISTERED cap, so that I know whether I may attend. | FR-REG-001–004 |
| US-PAR-06 | P0 | As a verified participant or guest, I want to cancel before both the cutoff and my first accepted check-in and re-register with a new QR if permitted, so that my place and credential state remain correct. | FR-REG-005, FR-QR-004 |
| US-PAR-03 | P0 | As a Participant, I want to access my active QR credential, so that gate staff can validate my registration without exposing my private details in the code. | FR-QR-001–004 |
| US-PAR-04 | P1 | As a Participant, I want to see ELIGIBLE after accepted check-in without assuming a PDF exists, then access only my own explicitly ISSUED PDF, so that I know what is available next. | FR-ATT-002, FR-CERT-001, FR-CERT-008 |
| US-GAT-01 | P0 | As a Gate/Security Staff member, I want to confirm my assigned event and gate before scanning, so that I do not validate against the wrong context. | FR-GATE-002, FR-RBAC-001 |
| US-GAT-02 | P0 | As a Gate/Security Staff member, I want a clear server decision and limited display name/status/context without contact details, so that failed scans hold entry and I never mistake a timeout for acceptance. | FR-GATE-003, FR-SCAN-001–003, FR-SCAN-005 |
| US-GAT-03 | P0 | As a Gate/Security Staff member, I want to see repeated or replayed scans leave occupancy unchanged, so that entry counts remain trustworthy. | FR-SCAN-004, FR-ATT-001 |
| US-GAT-04 | P1 | As a Gate/Security Staff member, I want check-out when enabled and re-entry only after valid exit, so that inside occupancy follows accepted transitions. | FR-ATT-002 |
| US-VOL-01 | P1 | As a Volunteer, I want to see only my assigned event and task, so that I can help without access to unrelated operations. | FR-RBAC-001–002 |
| US-VOL-02 | P1 | As a Volunteer, I want to see my titled instructions and applicable time/location and progress only my assignment from ASSIGNED to IN_PROGRESS to COMPLETED, so that staff know its status without granting me broader access. | FR-VOL-001, FR-RBAC-002 |
| US-ORG-08 | P1 | As an Event Organizer, I want to explicitly issue one or a batch of eligible certificates, see generation/email progress, and retry failed delivery, so that an ISSUED PDF with FAILED email can be sent without reissuing or duplicate sending. | FR-CERT-003–008 |
| US-PAR-05 | P2 | As a Participant, I want to use an optional approved delivery channel for my credential, so that I can access it outside the web session when the event supports it. | Post-MVP product option |
| US-ORG-07 | P2 | As an Event Organizer, I want to compare compatible completed events in more detail, so that I can improve later planning. | FR-ANL-002 |

The foundational security, audit, availability, and accessibility requirements apply to every relevant story. P1 stories remain MVP commitments where [REQUIREMENTS.md](REQUIREMENTS.md) says Must; the priority order controls sequencing, not removal.
