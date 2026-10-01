# Slice 3 authoritative contract update

**Status:** approved product, PRIVATE-link security and Slice 3 API contracts have been incorporated into authoritative documentation. This is documentation-only. No Slice 3 application code, Prisma schema, migration, dependency, commit or push is part of this update. Implementation still awaits the final Slice 3 readiness audit.

**Contract source:** [SLICE_3_FINAL_APPROVAL.md](SLICE_3_FINAL_APPROVAL.md); earlier five product approvals are recorded in [SLICE_3_CONTRACT_UPDATE.md](SLICE_3_CONTRACT_UPDATE.md). [SLICE_3_FINAL_CONTRACT_REVIEW.md](SLICE_3_FINAL_CONTRACT_REVIEW.md) is explicitly historical pre-approval option analysis, not a current TTL requirement.

## 1. Authoritative files changed

| Area | Files | Alignment |
| --- | --- | --- |
| Product and requirements | [PRD](../PRD.md), [decision register](../requirements/OPEN_PRODUCT_DECISIONS.md), [requirements](../requirements/REQUIREMENTS.md), [role matrix](../requirements/ROLE_PERMISSION_MATRIX.md), [lifecycle](../requirements/EVENT_LIFECYCLE.md), [MVP scope](../requirements/MVP_SCOPE.md), [personas](../requirements/PERSONAS.md), [use cases](../requirements/USE_CASES.md), [stories](../requirements/USER_STORIES.md), [traceability](../requirements/TRACEABILITY.md) | PRIVATE-link validity/owner actions and no TTL; narrow Admin authority; cancellation reason; preserved IDs and traceability. |
| API, security and architecture | [API contract](../api/API_CONTRACT.md), [API plan](../api/API_PLAN.md), [authentication/RBAC architecture](../security/AUTH_RBAC_ARCHITECTURE.md), [security plan](../security/SECURITY_PLAN.md), [technical architecture](../architecture/TECHNICAL_ARCHITECTURE.md), [database architecture](../architecture/DATABASE_ARCHITECTURE.md) | Exact Slice 3 routes, payloads, errors, pagination, replay/version rules; protected PRIVATE proof and one-active conceptual constraint; no schema. |
| UX and test contracts | [screen inventory](../design/SCREEN_INVENTORY.md), [UX states](../design/UX_STATES.md), [information architecture](../design/INFORMATION_ARCHITECTURE.md), [user journeys](../design/USER_JOURNEYS.md), [UX dependencies](../design/UX_DECISION_DEPENDENCIES.md), [test strategy](../testing/TEST_STRATEGY.md), [test architecture](../testing/TEST_ARCHITECTURE.md) | Bounded Organizer link controls, public safe-unavailable state, Gate guard, no fabricated registration facts, negative and concurrency/audit evidence. |
| Planning alignment, not new authority | [contract update](SLICE_3_CONTRACT_UPDATE.md), [final contract review](SLICE_3_FINAL_CONTRACT_REVIEW.md), [UI plan](SLICE_3_UI_PLAN.md) | Prior open-option language marked superseded; exact approved API now referenced. Historical review rationale remains visible. |

This file is the sole newly created file in this pass. The other named files were edited in place; unrelated existing worktree changes were preserved.

## 2. Approved contracts applied

- PRIVATE controlled entry is an opaque event-scoped bearer proof for allowlisted PRIVATE Published detail only. It is not a management, registration-ownership, account/guest-identity, QR or operations credential. A guessed event ID is never proof; public and management serializers are separate.
- There is **no automatic time-based PRIVATE-link expiry in MVP**. At most one proof may be active per event (zero after revocation). Owning Organizer alone issues, revokes or reissues; atomic replacement invalidates the old proof immediately. Leaving PRIVATE Published ends detail authority; PRIVATE-to-PUBLIC visibility edit revokes the old proof to prevent resurrection. Invalid/malformed/revoked/mismatched/non-PRIVATE/non-Published/unknown reads share `404 PRIVATE_UNAVAILABLE` without an existence oracle.
- The approved URL uses `/private#access=<opaque-proof>` under a configured origin; the browser presents the in-memory proof as `Authorization: PrivateLink <opaque-proof>` to `GET /api/v1/discovery/private`. The verifier is protected/non-reversible and no raw proof is stored or logged. The 24-hour encrypted same-key issuance replay window is **response retention, not link TTL**.
- The [API contract](../api/API_CONTRACT.md) now defines the exact management, Gate-create, transition, PUBLIC catalog/detail, PRIVATE detail and Organizer link issue/reissue/revoke endpoints, including caller/auth/scope, parameters, bodies, success shapes/status, stable errors, lifecycle, cursor pagination (20 default/100 maximum), idempotency and `If-Match` revision rules. Existing Slice 2 auth/staff routes remain EXISTING; Slice 3 representative event/discovery/gate operations are PLANNED with NEW final signatures; link mutation operations are NEW. None is implemented.
- A persistent authorized Event–Gate association is required both before Publish and independently before Live; no scanner, staff, device or health gate is added. Event Admin's assigned Draft/Published detail PATCH is confined to name, description, public venue/location, image/banner and public category/tags; assigned Gate creation is separate. No Event Admin lifecycle, capacity, visibility, schedule, registration or link-mutation authority is inferred.
- Lifecycle state, registration-policy availability and the single REGISTERED capacity cap remain separate. Slice 3 reports only evidenced `NOT_OPEN_YET`, `OPEN`, `SCHEDULED_CLOSE_REACHED` and `MANUALLY_CLOSED` policy reasons, possibly multiple blockers, without registered/remaining counts, capacity usage, `CAPACITY_REACHED` or a working registration action. Later slices retain their original boundaries.

## 3. Two previously discovered conflicts resolved

1. **PRIVATE-link expiry:** [authentication/RBAC architecture](../security/AUTH_RBAC_ARCHITECTURE.md), [security plan](../security/SECURITY_PLAN.md), [technical architecture](../architecture/TECHNICAL_ARCHITECTURE.md), [API plan](../api/API_PLAN.md) and [decision register](../requirements/OPEN_PRODUCT_DECISIONS.md) no longer imply a required independent TTL or unresolved link-expiry choice. They now state the approved no-time-expiry rule and explicit revocation/replacement/lifecycle boundary. The older bounded-TTL option is labeled historical in the [pre-approval review](SLICE_3_FINAL_CONTRACT_REVIEW.md).
2. **Event Admin authority:** the overbroad general persona sentence in the [PRD](../PRD.md) and the similar [persona task row](../requirements/PERSONAS.md) now match the locked [role matrix](../requirements/ROLE_PERMISSION_MATRIX.md). Admin Gate setup remains allowed within assignment, but capacity, visibility, schedule, registration/cancellation policy, ownership, lifecycle and standalone link mutation do not.

## 4. Cross-document consistency results

Targeted searches of current authoritative sources found no remaining positive requirement for automatic PRIVATE-link TTL or independent timed expiry, no Event Admin capacity/lifecycle/link grant, and no Publish-only Gate guard that omits the independent Live check. The historical pre-approval review retains its rejected alternatives behind an explicit superseded banner; these are not current requirements. The public detail allowlist and safe PRIVATE failure are consistent across product, API, security and UX sources. `REGISTERED`-cap facts remain deferred until registration records exist in Slice 4. No later-slice endpoint was added to the Slice 3 contract.

## 5. Validation results

- Markdown/local-link validation: **PASS** across 43 Markdown files and 386 local links.
- Explicit-ID validation: **PASS** across 722 requirement/decision/story/use-case/screen references, including new `US-ORG-10` and its traceability row.
- Table validation: **PASS** across 86 Markdown tables / 915 rows.
- Terminology/contradiction scan: **PASS** for current authoritative Slice 3 rules, with only clearly marked historical alternatives in earlier review documents.
- `git diff --check`: **PASS** in the closing validation pass; no files are staged or committed. Existing two-space Markdown hard breaks are valid Markdown and were not changed for this contract update.

## 6. Remaining implementation blockers

There are **no remaining Slice 3 product/security/API contract choices** to select. The final Slice 3 readiness audit must verify these documents against current Slice 2 code, any separate UI design choices (such as active role/event context and theme treatment), negative security/test coverage, and implementation scope before authorizing code. OpenAPI generation, Prisma/schema changes, migrations, dependencies and application endpoints belong to a later approved implementation turn, not this documentation update.

**All approved Slice 3 product/security/API contracts are now represented in the authoritative documentation. No product decisions remain. Slice 3 implementation remains blocked only pending the final readiness audit.**
