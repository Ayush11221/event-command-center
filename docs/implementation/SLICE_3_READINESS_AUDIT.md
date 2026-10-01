# Final Slice 3 implementation-readiness audit

**Audit type:** read-only review of the current authoritative contracts, Slice 3 UI plan, and Slice 2 foundation. This record does not approve a new product/API/security rule, alter the implementation, or authorize a commit. **Verdict: NOT READY FOR IMPLEMENTATION.** The product, API, security, and persistence boundaries are sufficiently defined; two explicitly open Slice 3 UX decisions remain.

## 1. Scope readiness

**PASS.** [The vertical-slice roadmap](../ROADMAP_PHASE_2.md) assigns event lifecycle and discovery to Slice 3. [The UI plan](SLICE_3_UI_PLAN.md) limits the build to Organizer event setup/create/edit/list/detail, assigned Event Admin management within its allowlist, minimum Gate configuration, Publish/Live and other approved Organizer transitions, PUBLIC Published catalog/detail, PRIVATE controlled-link detail, and registration-policy availability. The bounded Organizer link controls support PRIVATE entry. Registration, QR generation/scanning, check-in/out, occupancy, forecasting, alerts, certificate issuance/delivery, and volunteer tasks remain later-slice work. Existing Slice 2 staff grants may be reused, but a new staff-management or volunteer-task workflow is not a Slice 3 deliverable. No later-slice product endpoint appears in the final Slice 3 endpoint inventory.

## 2. Product/requirements readiness

**PASS.** [PRD](../PRD.md), [requirements](../requirements/REQUIREMENTS.md), [use cases](../requirements/USE_CASES.md), [stories](../requirements/USER_STORIES.md), and [traceability](../requirements/TRACEABILITY.md) agree on Organizer ownership, assigned Admin limits, PUBLIC/PRIVATE discovery, configured-Gate guards, and later registration ownership. The Phase 1 PUBLIC field allowlist includes remaining/available registration indication **when evidenced**; Slice 3 has no Registration rows and must not invent that indication. `US-ORG-10` traces the approved Organizer link control to `FR-DISC-001`/`UC-15`/`S-ORG-02`. No additional product choice was found.

## 3. Authorization readiness

**PASS.** The [role matrix](../requirements/ROLE_PERMISSION_MATRIX.md), [auth/RBAC architecture](../security/AUTH_RBAC_ARCHITECTURE.md), and [API contract](../api/API_CONTRACT.md) require server-derived ownership and current event assignment on every management request. Organizer creates/owns, edits permitted Draft/Published configuration, controls lifecycle/manual registration closure, and alone issues/reissues/revokes its PRIVATE link. Assigned Event Admin can read its assigned management detail, edit only `name`, `description`, `public_location`, `image_url`, `category`, `tags[]` in Draft/Published, and separately create a Gate for that assigned event. It cannot transfer ownership, transition/cancel an event, change capacity, visibility, schedule or registration policy, or mutate a link. Gate/Security, Volunteer, Participant, Guest and anonymous users gain no event-management authority. PUBLIC reads are restricted to Published PUBLIC events; the PRIVATE proof grants only the public-detail serializer, never management or registration ownership. Wrong-event and wrong-gate checks remain server-side.

## 4. PRIVATE-link security readiness

**PASS.** [FR-DISC-001](../requirements/REQUIREMENTS.md), [API contract](../api/API_CONTRACT.md), [auth/RBAC architecture](../security/AUTH_RBAC_ARCHITECTURE.md), [security plan](../security/SECURITY_PLAN.md), and [database architecture](../architecture/DATABASE_ARCHITECTURE.md) agree: opaque event-scoped bearer proof, **at most one active link** (zero after revoke/before issue), no automatic time TTL, Organizer-only issue/revoke/reissue, atomic replacement with immediate old-proof denial, and validity only while the event is PRIVATE and Published. Event ID or account/guest OTP alone does not authorize this detail. The fragment-based URL and in-memory `PrivateLink` header transport, protected non-reversible verifier, no-store/referrer/log redaction, and identical `404 PRIVATE_UNAVAILABLE` for invalid or unauthorized reads are specified. The encrypted 24-hour same-key issuance replay window is response retention, not link expiry. No current authoritative TTL contradiction was found.

## 5. Lifecycle readiness

**PASS.** [EVENT_LIFECYCLE.md](../requirements/EVENT_LIFECYCLE.md) and [UC-02](../requirements/USE_CASES.md) require an authorized persistent Gate before Draft to Published, and an independent Gate recheck before Published to Live. Organizer alone performs transitions, including Live cancellation. The [API contract](../api/API_CONTRACT.md) requires a nonblank cancellation reason, `If-Match`, idempotency, and required audit. Ordinary detail PATCH is Draft/Published only in Slice 3; neither role gains unrestricted Live policy editing. Completed/Cancelled remain terminal in MVP. Cancelled events block later registration/check-in without rewriting existing registration or attendance history; Slice 3 implements the event state, not those later flows or participant notification.

## 6. Gate readiness

**PASS.** [FR-EVT-004/FR-GATE-001](../requirements/REQUIREMENTS.md), [lifecycle](../requirements/EVENT_LIFECYCLE.md), and [database architecture](../architecture/DATABASE_ARCHITECTURE.md) define a configured Gate as a persistent Event–Gate association created by the owner Organizer or currently assigned Event Admin. Staff assignment, scanner hardware/device registration, connectivity, scanner health, and operational readiness are **not** guards. The final contract supplies Gate create plus embedded management Gate/readiness data; it does not require a scanner, Gate field-update, or deletion endpoint.

## 7. Availability readiness

**PASS.** Event lifecycle `state`, registration **policy** availability, and the single REGISTERED registration cap remain separate ([lifecycle](../requirements/EVENT_LIFECYCLE.md), [API contract](../api/API_CONTRACT.md)). Published public detail may report `OPEN` or `CLOSED` with evidenced `NOT_OPEN_YET`, `SCHEDULED_CLOSE_REACHED`, and/or `MANUALLY_CLOSED`; configured closing time or event start supplies `closes_at`. Draft/Live/Completed/Cancelled are not public detail resources, while authorized management can explain their lifecycle closure. `OPEN` is informational, not a working registration action or a promise of a free slot. There is no Slice 3 registered count, remaining count, capacity usage, or `CAPACITY_REACHED` claim; those depend on Slice 4 records.

## 8. API readiness

**PASS for the approved contract; none of these routes is implemented yet.** The [API contract](../api/API_CONTRACT.md) specifies purpose, caller/session or bearer proof, event/field authorization, request parameters/body, response/status, stable errors, lifecycle guard, and retry/version behavior for every route below. `PLANNED` means an earlier representative operation now has a `NEW` exact signature; `NEW` denotes a new PRIVATE-link command. Existing Slice 2 auth, assignment, and assigned-gate-scope routes are supporting `EXISTING` capabilities, not Slice 3 endpoints.

| Method and exact route | Class | Contract check |
| --- | --- | --- |
| `GET /api/v1/events?view=owned&cursor=&limit=` or `GET /api/v1/events?view=assigned&cursor=&limit=` | PLANNED, NEW signature | Server-scoped list, cursor and safe errors; read-only. |
| `POST /api/v1/events` | PLANNED, NEW signature | Organizer-only partial Draft create; required idempotency. |
| `GET /api/v1/events/{eventId}` | PLANNED, NEW signature | Owner/assigned detail and revision; safe out-of-scope result. |
| `PATCH /api/v1/events/{eventId}` | PLANNED, NEW signature | Field/state allowlists, CSRF, `If-Match`; GET/reconcile after timeout. |
| `POST /api/v1/events/{eventId}/gates` | PLANNED, NEW signature | Owner/assigned Admin, Draft/Published, CSRF, revision and idempotency. |
| `POST /api/v1/events/{eventId}/transitions` | PLANNED, NEW signature | Organizer-only edges and Gate checks; reason, CSRF, revision, idempotency. |
| `GET /api/v1/discovery/events?cursor=&limit=` | PLANNED, NEW signature | Anonymous PUBLIC Published catalog; cursor and allowlist. |
| `GET /api/v1/discovery/events/{eventId}` | PLANNED, NEW signature | Anonymous PUBLIC Published detail; safe 404 otherwise. |
| `GET /api/v1/discovery/private` | PLANNED, NEW proof signature | `PrivateLink` header, identical public-detail schema, uniform safe failure. |
| `POST /api/v1/events/{eventId}/private-link` | NEW | Owner-only initial issue; protected response, revision, idempotency/audit. |
| `POST /api/v1/events/{eventId}/private-link/reissue` | NEW | Owner-only atomic replacement; old proof invalid, same-key replay. |
| `POST /api/v1/events/{eventId}/private-link/revoke` | NEW | Owner-only immediate revocation; revision, replay and audit. |

The current [Express app](../../backend/src/app.ts) has Slice 2 CORS methods/headers only: implementation must add `PATCH`, `If-Match`, `Idempotency-Key`, and the PRIVATE `Authorization` carrier as appropriate. This is an implementation task under the approved contract, not an undocumented API choice. Exact non-link replay retention and abuse thresholds remain technical configuration/testing details; the contract already fixes the observable same-key/reconcile behavior and the 24-hour protected link-issuance replay.

## 9. UI readiness

**BLOCKED on two existing UX decisions.** [SCREEN_INVENTORY.md](../design/SCREEN_INVENTORY.md), [UX_STATES.md](../design/UX_STATES.md), [USER_JOURNEYS.md](../design/USER_JOURNEYS.md), and the [UI plan](SLICE_3_UI_PLAN.md) map `S-ORG-01/02`, the Gate-setup portion of `S-ORG-03`, and `S-PUB-01/02` to roles, purposes, approved data/endpoints, server authorization, and loading/empty/error/success or transition recovery. They keep registration, scanner, command center, alerts, certificates and volunteer-task UI out of Slice 3. Shared states cover unknown mutation result and safe PRIVATE unavailable without inventing data.

However, [INFORMATION_ARCHITECTURE.md](../design/INFORMATION_ARCHITECTURE.md) explicitly leaves multi-event/role switching TBD, while the UI plan calls active event/role context a **NEW UI decision required** for the owned/assigned workspace. The current [frontend](../../frontend/src/app/App.tsx) is a Slice 2 proof/bootstrap screen, so it supplies no established event-context pattern to reuse. Separately, [DESIGN_SYSTEM.md](../design/DESIGN_SYSTEM.md) fixes light/dark semantic-token and accessibility goals but defers user/system theme behavior, switch/persistence, final evaluated palette/font and component treatment. The UI plan calls these **NEW UI decisions before implementation**; Light/Dark/System is a direction, not an approved interaction contract. Neither decision may be silently invented during this audit. Exact component packages and responsive token refinements can be evaluated during UI implementation under the design-system rules; they are not a new product/security/API rule.

## 10. Database boundary readiness

**PASS at the contract level.** Existing [Slice 2 Prisma models](../../database/prisma/schema.prisma) provide `User`, `VerifiedContact`, `Session`, `OtpChallenge`, a minimal owned `Event` in Draft, `Gate` with Event foreign key, `EventRoleAssignment`, and `AuditEvent`. They establish owner, assignment, Gate scope and durable audit, but do not yet implement event configuration/discovery. [DATABASE_ARCHITECTURE.md](../architecture/DATABASE_ARCHITECTURE.md) and the [API contract](../api/API_CONTRACT.md) document the new Slice 3 persistence concepts: event policy/visibility/schedule, revision and publish ordering, protected PRIVATE proof with active uniqueness, protected issuance replay, and transactional event/Gate/link mutation plus required audit. Concrete Prisma fields, migration SQL and reviewed concurrency constraints are implementation design/test work, not an open product/architecture choice. No Registration, QR, attendance, occupancy, forecast, alert, certificate or volunteer-task table is justified for Slice 3.

## 11. Test readiness

**PASS for planned evidence.** [TEST_ARCHITECTURE.md](../testing/TEST_ARCHITECTURE.md) and [TEST_STRATEGY.md](../testing/TEST_STRATEGY.md) require real-PostgreSQL migrations/constraints, owner/assigned/wrong-event and Admin field denials, Organizer-only transitions/link commands, missing-Gate Publish and Live denials, publication/availability validation, public serializer non-leakage, uniform invalid PRIVATE failure, protected verifier and old-proof denial, one-active issue/reissue concurrency, revision/idempotency conflicts, audit rollback, CSRF, and UI state/accessibility tests. Preserve and rerun Slice 1/2 health, OTP/session-revocation, CSRF and assignment tests as regression evidence. These are documented expectations, not tests executed by this read-only audit.

## 12. Remaining blockers

1. **Active event/role context UX:** approve the owned/assigned workspace selection and switching behavior, including how the current event/role is shown when an account has more than one scope. This is explicitly TBD in the information architecture and flagged as a new UI decision in the UI plan. It must remain a presentation choice; server authorization always derives current relationships independently.
2. **Light/Dark/System UX behavior:** approve whether/how System follows the OS preference and how a user selection is switched and persisted for Slice 3, with representative light/dark token evaluation. The design system defers user/system theme and switch/persistence behavior, and the UI plan says final theme treatment requires a UI decision. Do not install a candidate component/theme package merely to settle it implicitly.

No further Slice 3 product, API, PRIVATE-link security, RBAC, lifecycle, Gate, availability, or database-contract decision was found. Later-slice provider/model/worker questions are not Slice 3 blockers. These two UX items do not prevent isolated backend/schema work in principle, but they prevent claiming the **whole Slice 3 implementation**, including its required frontend, is ready under the stated final gate.

## 13. Final verdict

**NOT READY FOR IMPLEMENTATION.** The authoritative product/security/API contracts are coherent, and the Slice 2 foundation can be extended without a new product or backend architecture round. The existing UX sources explicitly reserve two choices needed for the required Slice 3 screens and Light/Dark/System direction. Resolve those bounded UX choices, align the UI/design source of truth, then repeat the final readiness check before committing the documentation checkpoint or starting the full Slice 3 build. No new product requirement or later-slice scope is proposed here.

Closing validation: 44 Markdown files, 423 local links, 767 explicit ID references, and 87 Markdown tables (755 body rows) checked with no errors. The targeted current-authority scan found no positive PRIVATE-link TTL mandate or broad Event Admin grant; both configured-Gate guards are present. `git diff --check` passed; the new untracked audit file also passed its own whitespace check. No existing authoritative document, application code, schema, migration, or dependency was changed by this audit; nothing was staged, committed, or pushed.
