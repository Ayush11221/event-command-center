# P1-B organizer and event workspace UX

Scope: information architecture, event context, setup forms, event-time presentation, staff/gate integration, and draft reliability. P1-C mobile/operational redesign and P1-D visual design remain separate. No backend, database, API, authorization, session, lifecycle, registration, certificate, forecasting, or volunteer policy changes.

## Workspace

The current event name and Organizer/Event Admin role are explicit. Context options still come only from the server-scoped event lists; remembered selections never grant access. My events, Overview, Setup, Registrations, Team & Staff, and Gates use existing management components. Live Operations, Certificates, Volunteer tasks, Results, and Activity keep their existing routes. A newly created event continues into Setup.

Setup groups existing fields into Basic details, Schedule, Registration, Access, and Operations. Event Admin retains only the six public-detail editing fields. Gates retain deterministic numbered labels, expose last confirmed staff assignments by permitted email/role, and keep technical references in Advanced details. Gate records have no persistent name or active-status field, so their status is presented as Configured.

## Time and terminology

Event schedule inputs use separate native date/time controls. Location labels retain the actual time-zone value. Serialization/deserialization and patch comparison live in the frontend model/service boundary. Times never silently use the browser or server zone. Changing the selected zone retains the displayed clock times and reinterprets them in the new zone, as explained beside the controls. Unchanged instants retain their exact precision. Empty optional dates clear with null; incomplete/invalid dates and daylight-saving gaps/overlaps require correction before any PATCH.

One event-time formatter handles schedule, date, and time presentation. Management details, registration windows, task schedules, activity, results, certificate/batch dates, operations, and forecast times use the event zone. Secondary management routes read authorized event metadata; an unavailable zone is explained rather than substituted with browser-local time.

Lifecycle and registration labels use human terms. Publish/start explanations come from server readiness blockers. The obsolete registration-unavailable message is removed. Registration presentation combines server lifecycle/window information with the existing operations count; full is shown only with a confirmed compatible count. A failed count read explains that availability is unconfirmed and offers refresh.

## Draft reliability

Workspace visibility/session revalidation remains enabled. Background reads keep the ready subtree and edit forms mounted, including when moving between event sections. Initial loading and background updating have distinct messages. Temporary read failures retain entered values and offer retry. Genuine access loss continues through the existing authoritative expiry/scope-loss handling.

Clean forms accept refreshed server data. Dirty forms retain their baseline and draft, show a review state when a newer version arrives, and block saving until an explicit current-detail read. Review preserves edited fields and incorporates untouched current fields. Saves retain the existing If-Match check. Unknown save outcomes reconcile through GET, without blindly replaying PATCH. A confirmed terminal lifecycle change disables a retained edit draft. Late reads cannot overwrite a newer accepted detail, and background team refreshes do not abort pending staff mutations.

Secondary event metadata clears on session expiry/sign-out or explicit scope loss, including pending responses. These reads do not grant any permission; existing server-scoped operation endpoints still authorize every read and mutation. Negative tests cover unauthorized context values, cross-event registration lookup, metadata access loss, absent organizer edit fields for Event Admin, and the existing staff/lifecycle permission and replay boundaries.

## Contract limitations

The existing API provides scoped registration-reference lookup, not a participant directory. Certificate recipient names are private to their owners; staff receive only the name-set flag. Certificate selection and batch recovery therefore remain reference-based controls under Advanced details. No directory, recipient-name disclosure, batch-history endpoint, or fake navigation destination was added. Technical provenance remains available through secondary disclosure.

CSS changes cover form grouping, wrapping, native input fit, minimum touch targets, and narrow-screen reflow only. Existing theme tokens, colors, typography, button styling, and visual branding remain in place.

## Verification

Frontend validation uses Vitest/testing-library, TypeScript, Vite, ESLint, Prettier, and local Playwright Chromium with synthetic API responses. The browser uses a Los Angeles browser zone while testing India event times, and checks desktop/320px layout, themes, keyboard operation, mounted-input identity, conflict review, validation retention, and automated accessibility. This does not establish physical-device behavior, deployed behavior, or live-database integration. Backend tests are not required because backend behavior and contracts are unchanged.

Validation completed: **506 tests passed in 43 files**; frontend typecheck, production build, ESLint, Prettier and Git whitespace checks passed. **9 Chromium check groups passed** at 1280px and 320px, including Light/Dark/System, keyboard use and five workspace sections with **0 automated accessibility violations**. There were **0 application runtime errors**; the browser recorded one expected HTTP 400 from the deliberately rejected validation save. Screenshots and temporary browser scripts remain outside the repository.

## Files added

- `frontend/src/app/event-presentation.ts`
- `frontend/src/app/EventDateTimeControls.tsx`
- `frontend/src/app/EventInformation.tsx`
- `frontend/src/app/EventRegistrations.tsx`
- `frontend/src/app/useEventInformation.test.tsx`
- `frontend/src/app/useEventInformation.ts`
- `frontend/src/app/WorkspaceUX.test.tsx`
- `frontend/src/services/event-form.ts`
- `frontend/src/services/event-time.test.ts`
- `frontend/src/services/event-time.ts`
- `docs/implementation/P1_B_ORGANIZER_WORKSPACE_UX.md`

## Files modified in P1-B

- `frontend/src/app/App.test.tsx`
- `frontend/src/app/App.tsx`
- `frontend/src/app/AuditPage.tsx`
- `frontend/src/app/CertificateBatchPanel.tsx`
- `frontend/src/app/CertificateDelivery.test.tsx`
- `frontend/src/app/CertificateDeliveryPanel.tsx`
- `frontend/src/app/Certificates.test.tsx`
- `frontend/src/app/CertificatesPage.tsx`
- `frontend/src/app/CreateDraftForm.test.tsx`
- `frontend/src/app/CreateDraftForm.tsx`
- `frontend/src/app/EditEventForm.test.tsx`
- `frontend/src/app/EditEventForm.tsx`
- `frontend/src/app/EventDetail.test.tsx`
- `frontend/src/app/EventDetail.tsx`
- `frontend/src/app/EventReview.test.tsx`
- `frontend/src/app/ForecastPanel.tsx`
- `frontend/src/app/GatePanel.test.tsx`
- `frontend/src/app/GatePanel.tsx`
- `frontend/src/app/LifecyclePanel.test.tsx`
- `frontend/src/app/LifecyclePanel.tsx`
- `frontend/src/app/OccupancyPage.test.tsx`
- `frontend/src/app/OccupancyPage.tsx`
- `frontend/src/app/PrivateLinkMutations.test.tsx`
- `frontend/src/app/PrivateLinkPanel.tsx`
- `frontend/src/app/ResultsPage.tsx`
- `frontend/src/app/TaskDetails.tsx`
- `frontend/src/app/TasksPage.tsx`
- `frontend/src/app/TeamPanel.test.tsx`
- `frontend/src/app/TeamPanel.tsx`
- `frontend/src/app/useOperations.test.tsx`
- `frontend/src/app/Workspace.test.tsx`
- `frontend/src/app/Workspace.tsx`
- `frontend/src/styles.css`
