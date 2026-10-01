# Product Traceability

**Status:** Phase 1 planning map. Each row follows an existing PRD capability through actual requirement, story, use-case, and screen IDs to a future monorepo area. A future area is a planning boundary, not implemented code. `—` means the behavior is automatic or has no separate user screen.

Sources: [PRD](../PRD.md), [requirements](REQUIREMENTS.md), [stories](USER_STORIES.md), [use cases](USE_CASES.md), and [screen inventory](../design/SCREEN_INVENTORY.md).

| PRD capability / journey | Requirement IDs | Story IDs | Use cases | Screens | Future implementation area |
| --- | --- | --- | --- | --- | --- |
| Event creation and configuration | FR-EVT-001, FR-EVT-004 | US-ORG-01, US-ADM-01 | UC-01 | S-ORG-01, S-ORG-02 | `backend` event domain; `frontend` organizer feature; `database`; assigned Admin narrow Draft details and gate setup |
| Organizer-only lifecycle/Live cancellation | FR-EVT-002, FR-EVT-003, FR-EVT-004 | US-ORG-02 | UC-02 | S-ORG-02, S-ORG-03, S-PAR-01, S-GAT-01 | `backend` event/authorization; configured Event–Gate guard at Publish and Live; `database` retained registration history; `frontend` organizer/participant/gate |
| Published editing/Live policy restriction | FR-EVT-005 | US-ADM-01, US-ADM-03 | UC-01, UC-02, UC-13 | S-ORG-02, S-ORG-07 | `backend` event/audit domains; assigned Admin only named Draft/Published public details; no generic Live policy edit |
| PUBLIC allowlist/PRIVATE non-leakage | FR-DISC-001 | US-PAR-01, US-ORG-10 | UC-15 | S-PUB-01, S-PUB-02, S-ORG-02 | `frontend` public detail and bounded Organizer link controls; `backend` Published-only allowlisted event read and owner-only link issue/revoke/reissue; `database` visibility and one-active protected verifier; no timed MVP expiry |
| Publication opening, timed/manual/capacity/Live closure | FR-REG-001, FR-EVT-004 | US-ORG-09, US-PAR-02 | UC-03 | S-ORG-02, S-PUB-02/03 | `backend` availability guard; `database` times/closure cause/REGISTERED count; `frontend` reason states |
| Account/guest registration and own status | FR-REG-001–004 | US-PAR-02 | UC-03 | S-PUB-03, S-PAR-01 | `frontend` participant/OTP entry; `backend` registration/verification; `database` identity/REGISTERED status |
| Pre-check-in-only cancellation and new registration | FR-REG-005, FR-QR-004, FR-CERT-001/008 | US-PAR-06 | UC-18 | S-PAR-01/02, S-PUB-03, S-ORG-05/06, S-GAT-01 | `backend` registration/credential/certificate; `database` retained history, capacity, audit; reject all post-check-in cancellation |
| Own QR generation/identity/reissue | FR-QR-001, FR-QR-002, FR-QR-003, FR-QR-004 | US-PAR-03 | UC-04 | S-PAR-01 | `backend` credential domain; `frontend` participant feature; `database` |
| Gate configuration, scope, identity allowlist | FR-GATE-001–003 | US-ADM-01, US-GAT-01/02 | UC-02, UC-16, UC-05 | S-ORG-02/03, S-GAT-01 | `backend` gate/role authorization and response allowlist; persistent Event–Gate association is Publish/Live guard, operational scanner readiness later; `frontend` staff features |
| QR scan/validation/duplicate protection/failure | FR-SCAN-001–005 | US-GAT-02, US-GAT-03 | UC-05, UC-06, UC-07 | S-GAT-01 | `backend` attendance domain; `frontend` scanner; `database` scan_id/decision |
| Check-in/check-out and occupancy | FR-ATT-001, FR-ATT-002 | US-GAT-03, US-GAT-04 | UC-06, UC-08 | S-GAT-01, S-ORG-04 | `backend` attendance/live domains; `database` |
| Authorized attendance correction | FR-ATT-003 | US-ADM-05 | UC-08, UC-13 | S-ORG-04/05/07 | `backend` attendance/audit; `database` append-only correction; `frontend` staff action |
| Distinct INSIDE occupancy/REGISTERED count, live freshness | FR-LIVE-001–003 | US-ORG-03 | UC-09 | S-ORG-04 | `backend` live projection; `database` attendance/registration; `frontend` command center |
| Three alert categories, occupancy threshold, lifecycle/actions/recipients | FR-ALERT-001–002 | US-ORG-06 | UC-09 | S-ORG-04, S-GAT-01 | `backend` alert domain; `database` condition/state/evidence; `frontend` Organizer/Admin action and gate read-only views |
| Historical attendance analytics | FR-ANL-001, FR-ANL-002 | US-ORG-05, US-ORG-07 | UC-17 | S-ORG-06 | `backend` reporting domain; `frontend` results |
| Crowd forecasting | FR-FCST-001, FR-FCST-002, FR-FCST-003, FR-FCST-004, FR-FCST-005 | US-ORG-04 | UC-10 | S-ORG-04 | `ai-service`; `backend` forecast contract; `frontend` command center |
| Event-scoped RBAC | FR-RBAC-001, FR-RBAC-002 | US-ADM-02, US-VOL-01 | UC-16 | S-ORG-03, S-VOL-01 | `backend` authorization domain; `database`; all protected clients |
| Volunteer operations | FR-VOL-001 | US-VOL-02 | UC-14 | S-VOL-01, S-ORG-03 | `backend` assigned task/status; `frontend` volunteer/staff; `database` assignment |
| ELIGIBLE from check-in, not automatic issue | FR-CERT-001–002 | US-ADM-04, US-PAR-04 | UC-11, UC-12 | S-ORG-06, S-PAR-02 | `backend` certificate/attendance; `database` source check-in, status/audit |
| Built-in template selection and preview | FR-CERT-003 | US-ADM-04, US-ORG-08 | UC-19 | S-ORG-06 | `backend` preview contract; `frontend` certificate workflow; `database` template reference |
| Explicit single/bulk issue, PDF ID, batch/job/progress | FR-CERT-004–005, FR-CERT-008 | US-ADM-04, US-ORG-08 | UC-12, UC-19 | S-ORG-06, S-ORG-07 | `backend` certificate/batch; `database` artifact, batch, audit; asynchronous worker later |
| Separate email delivery/status/Organizer-Admin retry/idempotency | FR-CERT-006–008 | US-ORG-08 | UC-20 | S-ORG-06, S-PAR-02 | `backend` delivery; `database` delivery status/attempt; provider/queue later |
| Certificate issue/revocation and own access | FR-CERT-002, FR-CERT-008 | US-ADM-04, US-PAR-04 | UC-12, UC-19 | S-ORG-06, S-PAR-02, S-ORG-07 | `backend` certificate authorization; `database` status/audit; `frontend` staff/participant |
| Audit logs and access | FR-AUD-001, FR-AUD-002 | US-ADM-03, US-ORG-05 | UC-13 | S-ORG-07 | `backend` audit domain; `database`; `frontend` restricted audit view |

## Cross-cutting quality requirements

| Requirement IDs | Planned evidence and affected workflows |
| --- | --- |
| NFR-PERF-001, NFR-PERF-002 | Load/end-to-end timing for UC-05–09 and `S-GAT-01`/`S-ORG-04` under an agreed workload. |
| NFR-REL-001, NFR-REL-002 | Transaction, retry, concurrency, and failure tests for UC-06–09. |
| NFR-SEC-001, NFR-PRIV-001 | Authorization, QR, privacy, abuse, secrets, and data handling tests across all protected journeys. |
| NFR-SCALE-001 | Architecture review and measured live/API scaling for UC-09; Kafka remains conditional. |
| NFR-OBS-001, NFR-OBS-002 | Correlation and freshness evidence for UC-05–10 and operational screens. |
| NFR-A11Y-001 | Keyboard, screen-reader, contrast, status, reduced-motion, and device tests across all user journeys. |
| NFR-MAINT-001 | Reviewed contracts, migrations, domain boundaries, and documentation updates. |
| NFR-AUD-001 | Reconstruct scan and privileged decisions through UC-13 without relying on mutable logs. |

## MVP behavior-to-test destinations

| Requirements | Planned evidence in [TEST_STRATEGY.md](../testing/TEST_STRATEGY.md) |
| --- | --- |
| FR-EVT-003–005, FR-DISC-001, FR-REG-001–005, FR-QR-001–004 | Organizer-only Live cancellation; unchanged registrations on event cancel; Published edit/Live policy guard; publication opening and distinct closure causes including Live; REGISTERED cap versus INSIDE occupancy; PUBLIC allowlist/PRIVATE non-leakage, guest OTP, pre-check-in-only cancellation, CANCELLED QR and re-registration. |
| FR-SCAN-001–005, FR-ATT-001–003 | Valid/invalid/CANCELLED scans, same-scan_id replay, new duplicate, optional exit/valid re-entry, failed-entry hold, reasoned append-only correction and projection reconciliation. |
| FR-GATE-003, FR-RBAC-001–002, FR-VOL-001, FR-ALERT-001–002 | Gate identity allowlist/contact exclusion, titled own-task status, three alert categories with 90%/100% INSIDE thresholds, no registration-full alert, deduplication/lifecycle, Organizer/Admin acknowledge/resolve, assigned-gate read-only, Volunteer exclusion. |
| FR-CERT-001–008 | ELIGIBLE without automatic issue; explicit single/bulk issue and unique-ID PDFs; built-in preview, batch progress, ISSUED + FAILED email, Organizer/Admin retry/idempotency, post-check-in registration-cancellation denial, explicit revoke, own-access isolation. |
| FR-FCST-001–005 | 30/60-minute display and metadata, time-ordered baseline and suitable errors (MAE/RMSE), freshness, uncertainty, stale/unavailable behavior, advisory-only controls. |

## Gaps and change rule

- `FR-DISC-001` and `FR-VOL-001` were added to Requirements because the PRD explicitly includes discovery and volunteer management while the Phase 0 requirement list lacked direct behavioral IDs.
- Optional credential delivery (`US-PAR-05`) and richer comparisons (`US-ORG-07`) are post-MVP; their detailed requirements are intentionally deferred rather than fabricated.
- A policy decision can change a journey, screen, or use case. Update the PRD first, then its requirement ID, story, use case, screen/state, and this map in the same documentation change.
