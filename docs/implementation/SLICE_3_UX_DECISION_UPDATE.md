# Slice 3 locked UX decision update

**Status:** documentation-only incorporation of the two human-approved UX decisions from the [earlier readiness audit](SLICE_3_READINESS_AUDIT.md). That audit's NOT READY verdict describes the repository **before** this approval; it is not a new readiness verdict. Slice 3 implementation and the documentation checkpoint commit still await a new final readiness audit. No product, API, RBAC, PRIVATE-link, lifecycle, or persistence contract is changed here.

## Active Event + Role context

- The Slice 3 application shell presents an active context consisting of an Event and an effective role currently authorized for that Event. It scopes displayed event data, navigation, available management actions, and UI state. Exactly one authorized context auto-selects without a selection step; multiple contexts show an Event + Role switcher, including separate role choices on one Event.
- On login, the last locally remembered context is restored only if it is **still authorized**. Otherwise an available authorized context is selected. If none exists, show the appropriate empty state. A changed/revoked assignment clears stale scoped UI and requires a refreshed context. Public discovery and PRIVATE bearer detail do not acquire staff-management authority from this selector.
- Local context memory is a convenience, not an authorization token or database preference. Every protected backend request independently checks the authenticated session, Event scope, current role/assignment and requested permission. A client-chosen Event or Role never grants authority. This adds no organization/workspace hierarchy, cross-event permission, global Admin power, new role type, scanner or volunteer-task workflow.

## Light / Dark / System theme

- Slice 3 supports Light, Dark and System. Explicit Light or Dark overrides OS preference; System follows the OS color scheme and reacts to OS changes while the application is open. The selected mode is persisted locally in the browser for authenticated and unauthenticated users and applied before application rendering, so a wrong-theme flash does not precede the chosen appearance.
- The mode is presentation only. It changes no Event + Role context, backend authorization, account record or API contract. There is no Slice 3 database theme field or fourth/custom theme system. All Slice 3 loading, empty, validation, success, forbidden, error and safe-unavailable states must remain legible and accessible in Light, Dark and System-derived appearance. Final token values, palette/font/component choices remain representative-screen implementation evaluation, not a new theme-behavior decision or dependency authorization.

## Affected documents

| Document | Alignment |
| --- | --- |
| [Design system](../design/DESIGN_SYSTEM.md) | Locks the three modes, local persistence, live OS following, pre-render application and presentation-only boundary; removes theme selection/persistence from the TBD list. |
| [Information architecture](../design/INFORMATION_ARCHITECTURE.md) | Defines shell context, single/multiple-role selection, authorized-only restoration, empty/fallback state, navigation scope and independent backend checks; removes multi-event/role switching TBD. |
| [User journeys](../design/USER_JOURNEYS.md) | Adds context selection/fallback to the management journey and cross-journey theme behavior. |
| [Screen inventory](../design/SCREEN_INVENTORY.md) | Places the context switcher in `S-ORG-01`, inherits it into Slice 3 setup/Gate screens, and distinguishes public screens without staff context. |
| [UX states](../design/UX_STATES.md) | Covers remembered-context validation, switch/revocation recovery and theme handling across semantic states. |
| [UX decision dependencies](../design/UX_DECISION_DEPENDENCIES.md) | Records the two approvals separately from Phase 1 product-decision IDs. |
| [Slice 3 UI plan](SLICE_3_UI_PLAN.md) | Closes the two prior UX decision rows; maps context and theme to Slice 3 screens/build order without later-slice work. |
| [Authentication/RBAC architecture](../security/AUTH_RBAC_ARCHITECTURE.md) | States context memory/role selection is non-authoritative and every protected request still checks server-side scope and permission. |
| [Technical architecture](../architecture/TECHNICAL_ARCHITECTURE.md) | Assigns shell context and pre-render local theme preference to the existing conceptual frontend boundary, without schema/API changes. |
| [Test strategy](../testing/TEST_STRATEGY.md) | Records context/assignment negative cases and Light/Dark/System rendering/persistence checks for the implementation slice. |

The earlier [readiness audit](SLICE_3_READINESS_AUDIT.md) and [authoritative contract update](SLICE_3_AUTHORITATIVE_UPDATE.md) remain historical records; their dated readiness statements are not silently rewritten. No existing Phase 1 requirement/role-matrix, Slice 3 API contract, Prisma schema or application code was modified by this UX pass.

## Focused cross-document check

| Check | Result |
| --- | --- |
| `S-ORG-01/02/03` share one active Event + effective Role behavior; `S-PUB-01/02` need no staff context | PASS — screen inventory, information architecture, UX states and UI plan agree. |
| Context restore/switch versus backend authority | PASS — locally remembered selection is validated against current server scope; backend session/Event/assignment/action checks remain independent in UX, auth and architecture documents. |
| Light/Dark/System, local persistence, OS-change response and pre-render application | PASS — design system, journeys, states and UI plan agree; anonymous entry is covered. |
| New schema, API, role, provider, or later-slice feature required by either decision | NONE — browser presentation/context only; no scanner, registration, volunteer-task, theme-account field or new endpoint. |
| Previous Slice 3 UX decision gaps | CLOSED — the two rows are resolved without reopening approved product/security/API rules. |

Documentation validation: 45 Markdown files, 440 local links, 782 explicit ID references, and 90 Markdown tables (774 body rows) checked without errors. The targeted current-source search found no remaining assertion that Slice 3 role switching or theme selection/persistence is undecided. `git diff --check` passed; the new note passed its own whitespace check. The worktree's previously uncommitted documentation remains preserved.

## Remaining UX decisions and handoff

No **Slice 3 UX product/behavior decision** remains from the earlier audit. Exact authentication route split, final palette/font/component variants, breakpoints and later-slice scanner/chart designs remain implementation evaluation or later-slice work; none changes the locked context or theme behavior. This document does **not** declare implementation readiness. The repository is prepared for a **new final Slice 3 readiness audit**; only after that audit may the documentation checkpoint commit and implementation be considered.
