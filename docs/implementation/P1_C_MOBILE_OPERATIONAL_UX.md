# P1-C mobile and operational UX

Implemented on 2026-10-08. Scope is responsive structure, scanner feedback and recovery, operational information priority, and touch/keyboard usability. P1-D remains separate. Existing visual tokens, API contracts, authorization, sessions, business rules, QR format, and realtime transport remain unchanged.

## Navigation and context

Below 1024px, a labeled Sections button expands the existing workspace navigation. The button names the current section; selecting a section closes the menu and returns focus to the button. Escape also closes it. Every existing management section and secondary route remains reachable. At 320px the menu uses one column; wider phones/tablets use two. Desktop retains the existing navigation.

Gate/Security staff see their role and server-confirmed event/gate names in the workspace before opening the scanner. Failed scope reads show an unconfirmed context and retry instead of fabricated names or IDs. Scanner context names still come from the authorized scope endpoint. Live Operations labels the role from the current account only after its scoped operations read succeeds; Event Admin assignments are matched to the specific event.

## Scanner and camera

Start/stop/retry controls precede a responsive camera viewport. A single gate assignment needs no redundant selector; multiple assignments retain the existing selector. Camera states distinguish inactive, requesting permission, ready, denied, unavailable, failed, and stopped/interrupted states with plain text. Browser exceptions are never displayed. Hidden pages release camera tracks; ended/muted tracks and a suspended preview on foreground return stop capture and offer an explicit restart. Track handlers, timers, late permission grants, and unmount cleanup are covered.

Results use backend reasons and status fields: Entry allowed, Already checked in, QR code not recognized, QR code expired, Registration cancelled, QR code cancelled, and Entry is not currently open. A revoked QR does not falsely imply that its still-registered participant cancelled. Unknown and wrong-event credentials intentionally share INVALID_CREDENTIAL; the UI cannot distinguish them. No participant name is provided by this scan response, so none is invented. Unauthorized gate access clears the scanner through existing scope-loss handling.

The result remains prominent and announces politely. Scan next person clears the confirmed result, focuses capture, and keeps the same camera mounted. Automatic scanning of a different QR remains supported. Neither path resets stationary-frame suppression. Manual entry is secondary and uses the same scan API. Camera failure has a direct Use manual entry action that opens and focuses the fallback.

Unknown network outcomes hold entry and retain the original in-memory command. Retry same scan uses the identical scan ID and credential. A new-person action is unavailable while the outcome is unknown. Visibility return never submits a scan. Existing pagehide clearing and scope revalidation remain intact. No offline acceptance, credential storage, queue, or override was added.

## Operations, staff, gates, and Activity

Currently inside and utilization appear first, followed by registration capacity/count context. Freshness is displayed before the values. Updating/disconnected states explain whether last-confirmed information is shown. Capacity arithmetic, negative remaining values, and utilization above 100% are preserved. Forecasts keep separate 30/60-minute predictions, empirical intervals, timestamps, advisory limitations, and stale/unavailable states. Phone forecast points stack; occupancy values reflow without clipping.

Workspace background revalidation coalesces overlapping reads while keeping forms mounted. Operations foreground/cadence bursts coalesce; hidden-page polling pauses. Socket notifications still use the existing revision/gap/REST reconciliation path, including its follow-up read when a notification arrives during a read. Forecast refresh logic is unchanged.

Staff role and gate labels have separate lines; long permitted email addresses wrap, assignment actions reflow, and add-member/confirmation flows fit phones. Gates retain the existing deterministic numbering and Configured status; each assignment gets a readable line. The service provides neither staff display names nor a stored gate active flag, so these are not fabricated. Activity records reflow into labeled cells below 1024px while retaining table/header semantics. Small registration/navigation links and disclosure controls have usable touch/focus targets.

The current frontend/API have no general operational-alert feed or acknowledgement/resolution surface. P1-C improves the existing capacity, scanner-failure, and freshness presentations; it does not create alert records or change alert lifecycle rules.

## Validation

- `node ../node_modules/vitest/vitest.mjs run --maxWorkers 4` from `frontend`: **520 tests passed across 44 files**. Includes camera state/cleanup/permission cancellation and startup-track interruption, QR suppression, scan reasons and recovery, negative role/scope boundaries, mounted drafts, and realtime revision/visibility reconciliation. Initial unrestricted parallel runs hit an existing edit-form test's five-second timeout under contention; the final complete run limits workers without changing assertions or timeouts.
- `npm run typecheck`: backend and frontend passed.
- `npm run build`: backend TypeScript and frontend Vite passed; Vite transformed 331 modules.
- `npm run lint` and `npm run format:check`: passed. The added browser test and this document also pass focused Prettier checks.
- `node tests/p1-c-mobile.mjs`: **98 Chromium groups passed**, using a disposable Vite server at `http://127.0.0.1:5193`, synthetic scoped API responses, a synthetic Socket.IO connection, and actual locally decoded QR pixels in a canvas video stream. It exercises the rendered scanner state machine, not a mocked scanner component.
- Widths **320, 375, 390, 414, 768, 1024, 1280px** at 900px height: no page overflow or clipped content. Workspace sections, all navigation destinations, Team & Staff/add-member/confirmation, Gates, Live Operations, Results, Activity, and Gate/Security context/scanning were checked. Camera viewports remained at least 200px tall.
- Light/Dark/System presentation, keyboard menu activation/Escape/focus return, visible focus, approximately 44px controls, meaningful names, and scan announcements checked. **0 automated accessibility violations**, **0 application runtime errors**, **0 application console errors**. One deliberately aborted scan request produced the expected network failure and recovered with the same command.
- Browser plugin was not available; the installed Playwright/axe stack was used. Screenshots remain outside the repository in the system temporary directory under `ecc-p1-c-browser`; representative workspace, scanner, and operations screenshots were visually inspected.
- Backend tests were not rerun because no backend behavior or API contracts changed. No physical-device, live-camera hardware, production, or deployed-integration claims are made.
- Git whitespace checks passed, the index stayed empty, and all four protected document hashes remained unchanged. No staging, commit, push, or deployment occurred.
- Existing Graphify output was updated with the pinned project Python environment because the local executable launcher exited without output. The final AST update completed with 2367 nodes/6826 edges. Its warning about the absent SQL parser applies to SQL coverage; no package was installed and no semantic/API extraction was performed.

## Entry QR regression with the local API

Run `node tests/demo/qr-entry.mjs` against an existing isolated forecast-demo stack. If that stack belongs to another worktree, use `node tests/demo/qr-entry.mjs --demo-root <demo-worktree>`. The harness verifies both worktrees belong to the same Git repository, validates the existing loopback-only stack and local database, and builds the current frontend into a temporary directory.

The entry images come from the real participant page and credential endpoint. Canvas-camera emulation feeds those images to the actual scanner decoder and scan API. Fresh synthetic fixtures cover PUBLISHED rejection, wrong-event entry QR, non-entry URL, malformed credential, an entry QR that expires after viewing, the normal Organizer Start live event action, LIVE acceptance, and duplicate rejection. The harness checks CSRF and scan IDs, exactly one attendance transition, and zero attendance for the other event. Existing forecast attendees remain untouched.

Evidence contains payload categories, lengths and per-run keyed fingerprints, never raw credentials or sessions. Result-panel screenshots and evidence stay outside the repository. This proves the isolated workflow; it does not prove physical-camera decoding or identify the payload used in an inaccessible production request.

## Files added

- `frontend/src/app/AssignedGateContext.tsx`
- `frontend/src/app/AssignedGateContext.test.tsx`
- `tests/p1-c-mobile.mjs`
- `tests/demo/qr-entry.mjs`
- `docs/implementation/P1_C_MOBILE_OPERATIONAL_UX.md`

## Files modified in P1-C

- `frontend/src/app/AuditPage.tsx`
- `frontend/src/app/CameraCapture.tsx`
- `frontend/src/app/CameraCapture.test.tsx`
- `frontend/src/app/ForecastPanel.tsx`
- `frontend/src/app/GatePanel.tsx`
- `frontend/src/app/GateScanner.tsx`
- `frontend/src/app/GateScanner.test.tsx`
- `frontend/src/app/OccupancyPage.tsx`
- `frontend/src/app/OccupancyPage.test.tsx`
- `frontend/src/app/TeamPanel.tsx`
- `frontend/src/app/useOperations.ts`
- `frontend/src/app/useOperations.test.tsx`
- `frontend/src/app/Workspace.tsx`
- `frontend/src/app/Workspace.test.tsx`
- `frontend/src/app/WorkspaceUX.test.tsx`
- `frontend/src/styles.css`

Generated Graphify artifacts were refreshed separately. Existing P0/P1-A/P1-B working-tree changes and the four protected documents were preserved.
