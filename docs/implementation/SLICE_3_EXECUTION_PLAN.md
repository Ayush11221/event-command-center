# Slice 3 Execution Plan — Event Lifecycle and Discovery

**Status:** implementation plan only. This document translates the approved Slice 3 contract into executable work. It does not implement application code, change the Prisma schema, create a migration, add a dependency, change an API contract, reopen a product/UX decision, or authorize a commit or push.

**Baseline:** `b45ab2262eda97a73a45c92639a65f76e8382cf2` (`docs: establish architecture and slice 3 documentation baseline`).

**Readiness:** [SLICE_3_FINAL_READINESS_AUDIT.md](SLICE_3_FINAL_READINESS_AUDIT.md) says **READY FOR IMPLEMENTATION**. The authoritative contract is the current [API contract](../api/API_CONTRACT.md), [requirements](../requirements/REQUIREMENTS.md), [role matrix](../requirements/ROLE_PERMISSION_MATRIX.md), [event lifecycle](../requirements/EVENT_LIFECYCLE.md), [design system](../design/DESIGN_SYSTEM.md), and current Slice 2 code. Historical proposal/audit documents explain decisions but do not override those sources.

## 1. Scope and execution rules

Slice 3 delivers only:

- authenticated owned/assigned Event workspace, Draft creation, management detail, permitted Draft/Published editing, readiness, minimum Gate creation, and Organizer lifecycle transitions;
- anonymous PUBLIC Published catalog/detail;
- PRIVATE Published allowlisted detail through the approved controlled bearer link;
- Organizer-only PRIVATE-link issue, reissue, and revoke controls;
- registration **policy** availability derived from Event state/configuration, without registration records or capacity-usage claims;
- active Event + effective Role context switching and Light/Dark/System theme behavior;
- synchronized Prisma, backend, frontend, tests, and API/OpenAPI documentation for the frozen 12-route contract.

It does **not** deliver registration/cancellation, QR credentials, scanner/check-in, attendance/occupancy, command center, realtime transport, alerts, forecasting, certificates, volunteer tasks, participant notification, image upload, Gate update/delete, terminal reopening, or unrestricted Live editing. No table, route, UI control, or placeholder data for those later slices is justified here.

Implementation must preserve these rules:

1. The backend derives identity, owner/assignment scope, lifecycle authority, and permitted fields. Event IDs, selected roles, `permitted_actions`, and PRIVATE event IDs are never authorization proof.
2. Public and management serializers are separate. PRIVATE detail uses the public allowlist, not the management serializer.
3. Protected writes commit the state change and required audit in one transaction. Audit failure rolls back the protected change.
4. POST replay is checked before a now-stale revision is rejected. A timeout is an unknown result, not a rejection.
5. No raw PRIVATE proof or access URL is stored in ordinary database columns, logs, audit metadata, error details, analytics, browser storage, or management GET responses.
6. Slice 3 reports no registered count, remaining places, capacity usage, `CAPACITY_REACHED`, or functioning registration action.

## 2. Existing Slice 2 foundation versus Slice 3 work

| Area | Existing and reusable from Slice 2 | New work in Slice 3 |
| --- | --- | --- |
| Process/API shell | Express 5 composition, JSON limit, correlation IDs, safe fallback errors, Pino request completion logs, `/health/live`, database `/health/ready`. | Mount Event and discovery routers; allow approved methods/headers; extend the error envelope with safe `details`/`retryable` where needed. |
| Authentication | OTP account verification, 15-minute signed account cookie, persisted Session check on every authenticated request, logout, CSRF helper, `GET /api/v1/auth/me`. | Reuse unchanged as the account boundary. Slice 3 adds no login/provider flow. Protected Slice 3 writes use the existing session/Origin/CSRF boundary and contract code `CSRF_INVALID`. |
| Authorization | Organizer capability, immutable Event owner, current Event Admin assignments, Gate-scoped staff policy helpers, assignment revoke-on-next-request behavior. | Event-specific owner/Admin read and write policies; exact Admin field allowlist; Organizer-only creation, transitions, policy changes, and PRIVATE-link commands; safe out-of-scope concealment. |
| Persistence | Prisma/PostgreSQL client; `User`, `VerifiedContact`, `Session`, `OtpChallenge`, minimal owned `Event`, `Gate`, `EventRoleAssignment`, append-only `AuditEvent`; ownership and active-assignment constraints. | Event configuration/lifecycle/revision/publish-order fields; PRIVATE proof and replay persistence; command idempotency; indexes/checks/partial uniqueness; migration/backfill strategy. No later-slice domain models. |
| Gate foundation | `Gate(eventId)` relation and same-event composite reference; assignment and gate-scope reads. Existing Gates are fixture/foundation records, not a product configuration workflow. | Product `POST /events/{eventId}/gates`, Draft/Published state guard, revision/idempotency, required audit, embedded Gate/readiness responses. No scanner/staff/device/health readiness. |
| Audit | Transactional `recordAudit`, append-only database trigger, required-denial audit patterns. | Event create/edit/Gate/transition/link action records; material Published edit evidence; safe metadata only; rollback tests for every critical command family. |
| Frontend | React/Vite entry, health adapter, developer bootstrap, account/guest proof form, basic semantic/loading/error tests. | Product shell, theme bootstrap, Event + Role context, Event workspace/setup flows, discovery, PRIVATE fragment entry, route-specific services, semantic states, responsive/accessibility treatment. Guest proof is not used for PRIVATE detail. |
| Tests | Vitest, React Testing Library, Supertest, real-PostgreSQL Slice 2 integration/concurrency tests. | Domain unit tests, 12-route integration tests, migration/constraint/concurrency tests, component tests, and focused browser journey coverage when an approved browser-test setup exists. Preserve all Slice 1/2 regression suites. |

Existing staff routes remain mounted and supported:

- `GET /api/v1/events/{eventId}/gates/{gateId}/scope`
- `GET /api/v1/events/{eventId}/assignments`
- `POST /api/v1/events/{eventId}/assignments`
- `DELETE /api/v1/events/{eventId}/assignments/{assignmentId}`

They are supporting Slice 2 infrastructure, not part of the 12 new Slice 3 routes. Slice 3 Gate creation must interoperate with these routes without changing their authority.

## 3. Target backend boundaries

Keep business code close to its domain and split policy/pure logic from HTTP wiring. The exact filenames may be adjusted during implementation review, but responsibilities should remain separated.

| Proposed boundary | Responsibility |
| --- | --- |
| `backend/src/modules/events/http.ts` | The nine management route handlers: list, create, detail, PATCH, Gate create, transition, and three link commands (the link commands may delegate to a colocated submodule). Parse transport inputs and map results only. |
| `backend/src/modules/events/service.ts` | Scoped Event queries and transactional commands; revision compare-and-write; authoritative response assembly; audit coupling. |
| `backend/src/modules/events/policy.ts` | Owner/current-Admin relationship resolution, action checks, exact role/field permissions, and safe out-of-scope handling. Reuse the existing staff foundation rather than duplicate assignment semantics. |
| `backend/src/modules/events/validation.ts` | Exact request key allowlists; field type/size/time/zone/URL validation; `If-Match`, idempotency key, cursor, and limit parsing. Unknown or forbidden submitted fields are rejected, never ignored. |
| `backend/src/modules/events/lifecycle.ts` | Pure allowed-edge and publication/readiness evaluation for Draft, Published, Live, Completed, and Cancelled. |
| `backend/src/modules/events/availability.ts` | Pure server-time derivation of policy `OPEN`/`CLOSED` and only `NOT_OPEN_YET`, `SCHEDULED_CLOSE_REACHED`, `MANUALLY_CLOSED`. Lifecycle remains separate. |
| `backend/src/modules/events/serializers.ts` | Management list/detail, Gate/readiness, transition, and link result serializers. Does not export public detail. |
| `backend/src/modules/events/private-links.ts` | Proof generation/verifier comparison, active-link constraint handling, link invalidation, access URL creation, encrypted replay response, and redaction-safe results. |
| `backend/src/modules/events/idempotency.ts` | Actor/action/resource/key scoping, canonical request fingerprint, original response replay, conflict detection, retention, and replay-before-version ordering. |
| `backend/src/modules/discovery/http.ts` | PUBLIC catalog/detail and PRIVATE bearer-detail handlers. PRIVATE failure always collapses to the approved safe response. |
| `backend/src/modules/discovery/service.ts` | Published/visibility filtering, opaque cursor paging, PRIVATE verifier lookup, and dedicated public serializer use. |
| `backend/src/modules/discovery/serializers.ts` | The single allowlisted PUBLIC/PRIVATE item/detail representation; mechanically excludes management/internal fields. |

Do not create generic repository/service abstractions merely to wrap Prisma. Share only the genuinely cross-command primitives: parsed revisions, idempotency handling, audit input, and response/error types.

`backend/src/app.ts` must:

- continue mounting existing auth/staff routes;
- mount the new Event router under `/api/v1/events` and discovery router under `/api/v1/discovery` without shadowing existing assignment/gate-scope paths;
- add `PATCH` to CORS methods;
- allow `If-Match`, `Idempotency-Key`, and `Authorization` alongside current safe headers;
- keep credentials enabled only for the configured frontend origin;
- avoid logging headers, bodies, fragments, proof values, or returned access URLs.

## 4. Prisma schema and migration requirements

The implementation requires a reviewed forward migration and matching Prisma schema update. Prefer one coherent additive Slice 3 migration after physical design review so no deployed route observes half of the required invariants. If it is split, every intermediate migration must be deployable and the application route must not ship before its required constraints exist.

### 4.1 Event persistence

Extend the existing `Event` rather than creating a second event aggregate. It needs durable representation for:

- the approved lifecycle state values and immutable `ownerUserId`;
- `name`, optional `description`, `publicLocation`, `imageUrl`, `category`, and `tags`;
- nullable `startAt`, `endAt`, and IANA `timeZone` for partial Drafts;
- nullable `visibility` (`PUBLIC`/`PRIVATE`) until a Draft is configured;
- nullable positive `registrationCapacity`;
- nullable `registrationOpensAt`, `registrationClosesAt`, and `registrationCancellationCutoffAt`;
- manual-registration-closure and checkout settings, using a documented nullable/default strategy consistent with partial Drafts;
- monotonically increasing positive `revision`, initialized to `1` for existing/new records;
- `publishedAt` for the approved public ordering and any minimal transition timestamps/reason storage actually needed to reconstruct the authoritative lifecycle alongside the audit trail;
- existing `createdAt`, plus an update timestamp only if the implementation uses it for management facts rather than substituting it for response `as_of`.

Database/application invariants must cover positive capacity, ordered complete schedules, positive revision, valid lifecycle values, and no owner mutation. Cross-field publication completeness remains a domain guard because partial Drafts are allowed.

The publish-readiness validator must require the documented configuration: nonblank name, visibility, schedule/start/end with valid IANA zone, one positive registration cap, coherent optional registration policy, and at least one persistent Event–Gate association. It must not invent a description, image, category, tag, staff assignment, scanner, connectivity, or health prerequisite.

### 4.2 Gate persistence

The existing `Gate` relation is sufficient for the approved minimum `{gate_id,event_id}` association. Gate create needs no name, device, staff, scanner, status, or health column. Preserve the existing event foreign key and same-event composite relation used by Gate/Security assignments.

### 4.3 PRIVATE controlled-link persistence

Add a dedicated Event-linked persistence concept (physical model name is an implementation choice) with at least:

- opaque row identity and `eventId` foreign key;
- protected non-reversible verifier value and verifier version/key identifier if rotation needs it;
- issued/revoked timestamps and enough lineage to distinguish replacement from the current proof;
- an explicit database-enforced **at most one active proof per Event** invariant, normally a PostgreSQL partial unique index on active rows;
- indexes supporting proof verification without scanning or revealing Event identity.

Generate the bearer proof from cryptographically secure server randomness. Store only a protected verifier. Use constant-time comparison where applicable. The active proof has no automatic time expiry. Authorization is re-evaluated against active association, PRIVATE visibility, and Published state on every read.

PRIVATE-to-PUBLIC edit must invalidate the active proof atomically with Event revision and audit. Reissue must invalidate the old proof and establish the replacement in one transaction with no overlap. Leaving PRIVATE Published must make the old proof unusable on the next read and incapable of later resurrection; the physical representation may use revocation state and/or the irreversible lifecycle predicate, but that choice needs a concurrency test.

### 4.4 Idempotency and protected replay persistence

Add durable command replay storage sufficient for Event create, Gate create, transition, and link issue/reissue/revoke:

- actor, action, resource scope (or create scope), idempotency key identity, and canonical request fingerprint;
- original HTTP status and response body needed for same-key replay;
- creation and retention timestamps;
- a uniqueness constraint over the full actor/action/resource/key scope;
- encrypted protected response material for issue/reissue so the same access URL can be replayed for 24 hours without storing it in raw columns.

After the protected 24-hour issuance replay retention ends, the verifier remains active but the URL is unrecoverable from management reads. A stale revision prevents accidental re-issuance; intentional recovery uses reissue. Non-link retention duration is an engineering choice that must be fixed and tested before implementation, without changing same-key behavior.

### 4.5 Indexes and ordering

Add indexes that support the exact scoped order/filter pairs:

- owned management list: owner plus `createdAt DESC,id DESC`;
- assigned management list: current Event Admin assignment lookup joined to Event `createdAt DESC,id DESC` (preserve the existing active-assignment indexes and add only measured gaps);
- public catalog: `state=PUBLISHED`, `visibility=PUBLIC`, `publishedAt DESC,id DESC`;
- active PRIVATE proof lookup and Event relation;
- idempotency unique lookup and retention cleanup.

Opaque cursors must bind the ordered tuple and query scope (`owned`, `assigned`, or PUBLIC), so a cursor cannot be reused across views to expose records.

### 4.6 Migration safety and verification

The migration must:

1. preserve current Slice 2 owners, Gates, assignments, audit rows, sessions, and OTP data;
2. keep all existing minimal Events as Draft and never publish them through a backfill;
3. define and test a safe existing-Draft name/configuration backfill or a disposable-environment reset procedure before making any new required column non-null;
4. install raw-SQL checks/partial indexes that Prisma cannot express;
5. keep the existing owner-immutability and append-only-audit triggers;
6. apply successfully both to an empty database and a database already at both Slice 2 migrations;
7. run Prisma generation and schema validation after the migration;
8. prove rollback of application transactions, not claim a destructive automatic down migration.

Do not add Registration, QRCredential, ScanAttempt, Attendance, Occupancy, Alert, Forecast, Certificate, delivery/job, or Volunteer-task models.

## 5. The 12 approved API routes

The signatures below are frozen. Implementation may add internal helpers, never a thirteenth product route or altered payload.

| # | Route | Backend work | Frontend consumer and required evidence |
| --- | --- | --- | --- |
| 1 | `GET /api/v1/events?view=owned&cursor=&limit=` or `view=assigned` | Authenticate; validate view/cursor/limit; server-filter owner or current Event Admin assignment before paging; order by `created_at DESC,event_id DESC`; return exact management wrapper and relationship. | Workspace/context loader. Test wrong/ineligible view, revoked assignment, cross-event concealment, default 20/max 100, cursor-scope binding, null Draft schedule, empty/error states. |
| 2 | `POST /api/v1/events` | Organizer-capable account only; CSRF; exact `{name}`; derive owner and Draft; require idempotency key; create revision 1 plus audit atomically. | Create-Draft form. Test incapable/Admin denial, invalid/unknown fields, same-key replay, fingerprint conflict, audit rollback, unknown-result retry. |
| 3 | `GET /api/v1/events/{eventId}` | Owner/current assigned Admin only; return management detail, Gates/readiness/availability/permitted actions/revision; owner-only link metadata and never proof/URL. | Event setup page and reconciliation after unknown PATCH. Test out-of-scope `EVENT_NOT_FOUND`, assignment revocation, Admin link-metadata exclusion, field completeness. |
| 4 | `PATCH /api/v1/events/{eventId}` | Session + CSRF + required quoted `If-Match`; Draft/Published only; reject unknown fields; Organizer allowlist versus exact six-field Admin allowlist; partial update; increment revision; material Published edit plus audit atomically; PRIVATE-to-PUBLIC proof invalidation atomically. | Role-aware Event form. Test every denied Admin field, Live/terminal denial, nullable clears, validation, stale revision, no idempotency requirement, audit rollback, timeout GET/reconcile. |
| 5 | `POST /api/v1/events/{eventId}/gates` | Owner/current Admin; Draft/Published only; `{}` only; `If-Match` + idempotency; create one persistent association and audit; increment Event revision; return Gate/readiness result. | Gate/readiness panel. Test Admin scope, wrong Event, body/header errors, same-key replay, concurrent replay/unique result, state/version conflict, and proof that no staff/device/health prerequisite exists. |
| 6 | `POST /api/v1/events/{eventId}/transitions` | Owner only; exact target state and cancellation reason rule; allowed-edge/readiness checks; independently enforce Gate at Publish and Live; `If-Match` + idempotency; state/revision/audit atomically. | Lifecycle actions, confirmations, cancellation-reason dialog. Test every valid/invalid edge, Admin denial, incomplete Publish, both Gate guards, terminal no-reopen, same-key replay before revision conflict, audit rollback. |
| 7 | `GET /api/v1/discovery/events?cursor=&limit=` | Anonymous; filter PUBLIC + Published before paging; public ordering; dedicated list serializer; no count. | PUBLIC catalog. Test PRIVATE/Draft/Live/Completed/Cancelled omission, allowlist, cursor rules, empty/unavailable states, and no capacity-use facts. |
| 8 | `GET /api/v1/discovery/events/{eventId}` | Anonymous; only PUBLIC + Published; dedicated public detail serializer; unknown/PRIVATE/non-Published collapse to `EVENT_NOT_FOUND`. | Public Event detail. Test exact allowlist and absence of management, Gate, participant, audit, occupancy, alert, link, revision, and internal fields. |
| 9 | `GET /api/v1/discovery/private` | Parse `Authorization: PrivateLink <opaque-proof>` without account auth; verify protected active proof + association + PRIVATE + Published every request; same public-detail serializer; `Cache-Control: no-store`. | `/private#access=...` entry page. Test missing/malformed/unknown/revoked/mismatched/wrong-visibility/non-Published identically as `404 PRIVATE_UNAVAILABLE`; no existence oracle or proof logging. |
| 10 | `POST /api/v1/events/{eventId}/private-link` | Owner only; PRIVATE + Published; no active link; `{}`; CSRF, `If-Match`, idempotency; generate protected verifier and access URL; active uniqueness/replay/audit/revision atomically; `201`. | Bounded Organizer link controls with one-time URL display/copy. Test Admin denial, wrong state/visibility, already active, concurrent issue, encrypted 24-hour same-key replay, redaction. |
| 11 | `POST /api/v1/events/{eventId}/private-link/reissue` | Owner only; PRIVATE + Published + active link; atomically revoke old/create new/audit/revision; same headers; `200` with new URL and `previous_revoked_at`. | Explicit confirmation and replacement result. Test old proof fails immediately, no overlap, concurrent reissue, same-key returns same replacement, different key/version conflicts safely. |
| 12 | `POST /api/v1/events/{eventId}/private-link/revoke` | Owner only; PRIVATE + Published + active link; atomically revoke/audit/revision; same headers; `200` with no secret. | Explicit revoke control and confirmed revoked state. Test immediate denial, no-active conflict, replay, concurrent revoke, Admin denial, audit rollback. |

All list wrappers use `items`, `next_cursor`, `as_of`, and `correlation_id`; default limit is 20 and maximum is 100. All write results include the authoritative new Event revision and server time. Public/PRIVATE detail does not include management state even though Published eligibility is enforced server-side.

## 6. Domain behavior and guard implementation

### 6.1 Lifecycle

Implement one pure transition table used by service and tests:

- Draft → Published;
- Published → Live;
- Live → Completed;
- Draft, Published, or Live → Cancelled;
- no skip, reverse, automatic clock transition, or terminal reopening.

Only the owning Organizer can invoke it. Cancellation requires explicit UI confirmation and a nonblank server-validated reason; confirmation itself is not sent as authority. Every state change is timestamped and audited.

Publish validates complete required configuration and at least one associated Gate. Live independently re-queries/rechecks at least one associated Gate inside the command transaction. A prior readiness response is advisory UI data, not proof that the transition still passes.

### 6.2 Readiness

Return `configured_gate_present`, `publish_blockers`, and `live_blockers` from one backend derivation shared by management detail, Gate result, and transition result. Stable blocker tokens must be enumerated in implementation/OpenAPI tests from the documented required fields; the UI renders those tokens without independently deciding readiness.

No staff assignment, scanner hardware, device registration, connectivity, scanner health, or operational readiness token is permitted in this Slice 3 predicate.

### 6.3 Registration-policy availability

Use a server clock injected into pure logic/tests. While Published:

- before a configured future opening: `CLOSED` with `NOT_OPEN_YET`;
- at/after configured close, or at/after Event start when no close is configured: `CLOSED` with `SCHEDULED_CLOSE_REACHED`;
- when manually closed: `CLOSED` with `MANUALLY_CLOSED`;
- include multiple applicable reasons;
- otherwise: `OPEN` with no reasons.

`opens_at` is the configured opening or null. `closes_at` is configured close or Event start. Draft/Live/Completed/Cancelled management responses still carry lifecycle state separately; those states do not authorize a public detail response. The availability object must never inspect or imply registration rows in Slice 3.

### 6.4 Event Admin permissions

An assigned Event Admin may:

- list only current assigned Events;
- read assigned Event management configuration;
- PATCH only `name`, `description`, `public_location`, `image_url`, `category`, and `tags` in Draft/Published;
- create a Gate for an assigned Draft/Published Event;
- continue using already-approved non-Slice-3 staff-assignment operations within their existing scope.

An Event Admin may not create an Event, change owner, capacity, visibility, schedule/time zone, registration opening/closing/cutoff/manual closure, checkout setting, lifecycle, cancellation, Event Admin grants, or PRIVATE link; may not PATCH Live/Completed/Cancelled; and receives no proof/URL/link controls. Reject a forbidden submitted field instead of silently stripping it.

### 6.5 Active Event + effective Role context

Build contexts only from current server results:

- `owned` maps to the Organizer context for an Event;
- `assigned` maps to the Event Admin context for an Event;
- the same Event can therefore appear twice when both relationships legitimately exist;
- exactly one context auto-selects; multiple contexts show the Event + Role switcher;
- remember only the opaque Event ID and relationship/effective-role label locally;
- restore it only after it appears in a fresh authorized list result;
- on assignment removal, `401`, scoped `404`, or relevant `403`, clear stale Event data, refresh contexts, select an available authorized fallback, or show the no-context state.

The selector is presentation/navigation state. Do not send a client role claim as authorization. Backend requests still resolve all current relationships. If a user intentionally selects the narrower Admin presentation while also an owner, the client limits visible controls to that selected context, while the server remains the final authority for every attempted action.

## 7. Frontend pages, components, and services

The only frozen browser path is `/private#access=<opaque-proof>`. Other page URLs and whether a routing dependency is justified are implementation choices; do not add a router package merely to match a folder name.

### 7.1 Application shell and shared state

- Refactor the developer bootstrap so account proof remains an entry state, not the product shell.
- Add an application shell with current Event, effective Role, context switcher, theme selector, navigation limited to Slice 3 surfaces, and sign-out.
- Add a small typed API client that preserves status/code/correlation/details and distinguishes unsent, pending, unknown-result, forbidden, validation, and dependency-unavailable outcomes.
- Keep server state feature-local; do not add a global state/data-fetching dependency without a concrete demonstrated need.
- Use semantic landmarks/headings, keyboard operation, visible focus, non-color status text, controlled focus after errors/dialogs, reduced-motion behavior, and responsive layouts under the design system.

### 7.2 Theme

Implement Light, Dark, and System from the first product UI slice:

- store only the selected mode locally for authenticated and anonymous use;
- run a pre-render bootstrap before React paints, applying the effective theme to the root element;
- explicit Light/Dark ignores OS changes; System uses `prefers-color-scheme` and reacts live;
- expose design tokens through CSS custom properties for both rendered appearances;
- keep status meaning, focus, validation, loading, forbidden, and safe-unavailable states accessible in both themes;
- do not add an account preference, database field, API call, fourth mode, or custom theme engine.

### 7.3 Management surfaces

Build these feature components/pages:

- Event workspace/list with owned/assigned contexts, loading/empty/error states, cursor continuation, and Organizer-only create form;
- Event setup/detail with revision/as-of display, field-level validation, Organizer form sections, Admin six-field form, and stale/unknown-result reconciliation;
- Gate/readiness panel with create action and explicit distinction between configured association and operational scanner readiness;
- lifecycle action panel showing only server-permitted actions, confirmations, cancellation reason, blockers, and retry/reconcile behavior;
- registration-policy availability explanation with no registration button or capacity count;
- bounded owner-only PRIVATE-link panel for issue/reissue/revoke, one-time returned URL, explicit replacement/revocation confirmation, and no persistent browser copy.

`permitted_actions` is server-derived UI guidance and must be refreshed after every mutation/context change. It never replaces server authorization.

### 7.4 Public and PRIVATE surfaces

- PUBLIC catalog: exact allowlisted items, cursor continuation, loading/empty/service-unavailable states.
- PUBLIC detail: exact allowlisted detail and truthful policy availability; no management or registration action.
- PRIVATE entry: synchronously capture the `access` fragment into memory, remove it from the visible URL/history before ordinary rendering/telemetry, call only `GET /api/v1/discovery/private` with `Authorization: PrivateLink`, and discard the proof when the page/session context ends.
- PRIVATE safe-unavailable state: identical user-facing treatment for every `PRIVATE_UNAVAILABLE` cause; no sign-in prompt suggesting an account would grant access.

Never put the proof in query parameters, path segments, local/session storage, React debug output, error reporting, analytics, clipboard automatically, or referrer-bearing navigation.

## 8. Validation, errors, retries, and concurrency

### 8.1 Request validation

Use exact object-key allowlists and safe field-level errors. Validate:

- UUID/opaque ID syntax without treating syntax as resource authority;
- nonblank name and cancellation reason;
- bounded strings/tags and duplicate/empty tags under implementation constants recorded in OpenAPI/tests;
- ISO-8601 timestamps and ordered start/end/registration policy times;
- IANA time zone through a server-supported canonical check;
- positive integer registration capacity;
- optional public HTTPS image URL only; no upload/data/file URL;
- `view`, cursor, and limit 1–100;
- exact quoted `If-Match: "<revision>"` and required idempotency header syntax/size;
- exact `{}` bodies where required, rejecting extra fields.

Client validation improves recovery but never replaces server validation. Server time is authoritative for availability and response `as_of`.

### 8.2 Error contract

Extend the existing `ApiError`/error middleware so every Slice 3 error is:

`{code,message,correlation_id,details?,retryable?}`

Implement the exact approved catalog:

- `400 VALIDATION` for malformed transport/header/query/body/field values;
- `401 UNAUTHENTICATED` for management session failure only;
- `403 FORBIDDEN` or `403 CSRF_INVALID` after authentication;
- `404 EVENT_NOT_FOUND` for absent/out-of-scope management or unavailable PUBLIC detail;
- uniform `404 PRIVATE_UNAVAILABLE` for every PRIVATE proof denial, including malformed/missing header;
- `409 INVALID_TRANSITION`, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `LINK_ALREADY_ACTIVE`, `LINK_NOT_ACTIVE`;
- `422 WRONG_LIFECYCLE_STATE`, `MISSING_CONFIGURED_GATE`, or policy `VALIDATION`;
- `503 DEPENDENCY_UNAVAILABLE` for required database/audit/service failure without protected facts.

Only safe validation field names belong in `details`. No stack, SQL, verifier, proof, raw access URL, hidden Event fact, participant data, or unauthorized current revision may be returned. Authorized version conflicts may include a safe current revision.

### 8.3 Version and idempotency order

For Gate, transition, and link commands:

1. authenticate and establish current resource scope safely;
2. find a same actor/action/resource/key replay and verify its fingerprint;
3. return the original authorized outcome for the same fingerprint even though the Event revision advanced;
4. reject a changed fingerprint as `IDEMPOTENCY_CONFLICT`;
5. only for a new command, compare `If-Match`, recheck authority/state inside the transaction, mutate, audit, increment revision, and persist the replay outcome.

PATCH uses revision only. After an uncertain PATCH result, GET management detail and reconcile before another PATCH. Event create has idempotency but no prior revision.

Use database uniqueness plus a short transaction/locking strategy proven against real PostgreSQL for concurrent issue/reissue/revoke and duplicate commands. Do not rely on an in-process mutex or Prisma-only precheck.

## 9. Test plan

### 9.1 Pure domain tests

- every allowed and forbidden lifecycle edge, including Live cancellation and no reopening;
- publication completeness and independent Gate checks at Publish and Live;
- availability boundaries before/at/after opening, configured/default close, multiple reasons, manual closure, and time-zone/DST cases;
- Organizer/Admin field and action matrices;
- readiness/permitted-action derivation;
- public serializer allowlist versus management serializer;
- cursor scope/order encoding and request fingerprint canonicalization.

### 9.2 API/database integration tests

Run Supertest against disposable PostgreSQL with real migrations. Cover all 12 routes and:

- owner/current Admin/capability, wrong-event, revoked-assignment, all other roles, and anonymous negatives;
- CSRF, Origin, malformed JSON, unknown fields, header syntax, field bounds, typed errors/correlation IDs;
- stale revision, same-key replay, changed fingerprint, timeout reconciliation behavior;
- state change + audit atomicity and injected audit-write rollback;
- concurrent Event create replay, Gate create replay, transition replay, one-active link issue, reissue, and revoke;
- old-proof immediate denial after revoke/reissue/visibility change/leaving PRIVATE Published;
- identical PRIVATE failures and absence of an Event-existence timing/body oracle within reasonable test controls;
- no raw proof/access URL in verifier rows, idempotency ordinary columns, logs, audit, management reads, or errors;
- PUBLIC filters/ordering/allowlist and management cursor isolation;
- availability with no registration/capacity-use facts;
- existing auth, logout/revocation, staff assignment, gate scope, ownership immutability, and audit append-only regressions.

### 9.3 Migration tests

- clean database deploy through all migrations;
- upgrade from the two committed Slice 2 migrations with representative owned Draft/Gate/assignment/audit rows;
- preservation/backfill assertions and no accidental publication;
- database check and partial-unique violations;
- concurrent active-proof constraint behavior;
- Prisma schema/client compatibility and query-plan inspection for list/proof lookups where needed.

### 9.4 Frontend component tests

- one context auto-selected; multiple Event/Role contexts; two roles on one Event; remembered authorized restoration; revoked fallback/no-context;
- Organizer versus Admin controls and exact disabled/absent actions;
- create/edit/Gate/transition/link success, validation, forbidden, stale, service-unavailable, and unknown-result recovery;
- PUBLIC list/detail allowlists and no registration action/capacity claim;
- PRIVATE fragment capture/removal, in-memory header use, proof non-persistence, and uniform safe-unavailable rendering;
- Light/Dark/System persistence, pre-render attribute, live OS change only in System, and semantic state legibility;
- keyboard/focus/dialog behavior, status text independent of color, reduced motion, and responsive reflow.

### 9.5 Browser acceptance

When browser automation is justified and authorized, cover these focused Slice 3 journeys against the real API/database:

1. Organizer signs in, creates/configures Draft, creates Gate, publishes, starts, completes or cancels with safe retry/reconciliation.
2. Assigned Admin switches context, edits only the six fields and creates a Gate, while lifecycle/policy/link attempts are denied.
3. Anonymous visitor discovers only PUBLIC Published Events and sees policy availability without a registration action.
4. Organizer issues a PRIVATE link; anonymous bearer views the same allowlisted schema; reissue/revoke makes the old proof fail immediately and uniformly.
5. Theme and remembered-context behavior survives reload while permissions are revalidated.

Do not install Playwright, an accessibility package, Testcontainers, or another test dependency merely because it appears in planning documents. First use existing Vitest/RTL/Supertest and the repository's real-PostgreSQL test pattern; request/justify a new package only when the concrete suite requires it.

## 10. Implementation order as small vertical slices

Each slice ends with relevant type/lint/test/build checks, contract synchronization, and a reviewable migration/API/UI delta. Do not implement all backend routes first and defer authorization/UI/tests to the end.

### Vertical 0 — persistence and shared command safety

- Finalize the physical Event, proof, and idempotency design; write/review the forward migration and backfill.
- Add exact shared error envelope, revision/header parsing, command replay primitive, CORS headers/method, and test fixtures.
- Prove migration-from-Slice-2, uniqueness, transaction rollback, and existing regression suites before exposing a route.

### Vertical 1 — theme, authenticated shell, owned list, and create Draft

- Apply Light/Dark/System before render and add the minimal authenticated shell.
- Implement route 1 for `view=owned` and route 2 Event create.
- Build owned workspace, empty/error/loading states, and create form.
- Prove Organizer capability, server-derived ownership, idempotent create, pagination basics, audit rollback, and theme behavior.

### Vertical 2 — assigned list, management detail, and context switching

- Complete route 1 for `view=assigned` and implement route 3.
- Build fresh authorized contexts, one-context auto-select, multi-context/Event+Role switcher, restore/fallback behavior, and Event setup read view.
- Prove assignment revocation, wrong-event concealment, owner-only link metadata, and two roles on one Event.

### Vertical 3 — permitted Event editing

- Implement route 4 with revision-only conditional update, full Organizer allowlist, exact Admin six-field allowlist, validation, and Published material-edit audit.
- Build role-scoped forms, field errors, stale conflict, and timeout GET/reconcile.
- Include atomic PRIVATE-to-PUBLIC invalidation even if the link-issuance UI is delivered later; integration tests create proof fixtures through internal test setup until route 10 exists.

### Vertical 4 — Gate configuration and readiness

- Implement route 5 and shared readiness derivation.
- Build Gate/readiness panel and blocker presentation.
- Prove owner/Admin scope, Draft/Published guard, idempotency/revision/audit, and that Gate association alone satisfies the configuration predicate.

### Vertical 5 — lifecycle and policy availability

- Implement route 6 and pure lifecycle/availability logic.
- Build transition controls, confirmation/reason flow, blockers, authoritative results, and policy availability explanation.
- Prove all edges, both Gate guards, partial Draft behavior, no automatic lifecycle transition, terminal behavior, and no fabricated capacity facts.

### Vertical 6 — PUBLIC discovery

- Implement routes 7 and 8 with their dedicated serializers and cursor ordering.
- Build catalog/detail and all public states in both themes.
- Prove PUBLIC+Published filtering, exact allowlist, safe `EVENT_NOT_FOUND`, no management leakage, and no registration action.

### Vertical 7 — PRIVATE issue and bearer detail

- Implement routes 9 and 10 together so a proof can be created and consumed end to end.
- Build fragment capture/removal, in-memory header transport, safe unavailable state, and owner issue control with one-time URL display.
- Prove no TTL, one-active constraint, encrypted same-key 24-hour replay, redaction, public serializer identity, and all collapsed denial causes.

### Vertical 8 — PRIVATE reissue/revoke and concurrency hardening

- Implement routes 11 and 12 and complete bounded owner link controls.
- Prove atomic replacement, immediate old-proof denial, revoke, replay-before-version, concurrent commands, audit rollback, lifecycle/visibility invalidation, and Admin denial.

### Vertical 9 — contract, accessibility, and release evidence

- Confirm the implemented OpenAPI representation exactly matches all 12 rows and payload/error schemas without changing authority.
- Run the full static/unit/component/API/database/migration/regression suite and focused browser acceptance if its setup is approved.
- Perform keyboard, focus, contrast, responsive, proof-leak, log/audit, and dependency review.
- Update only implementation-status and evidence documentation; do not claim later-slice behavior.

## 11. Implementation-time decisions that are not product ambiguity

There is **no genuine blocking Slice 3 product, role, lifecycle, API, PRIVATE-link, or UX ambiguity**. The following engineering choices must be resolved in code review and captured in tests/OpenAPI without widening behavior:

| Engineering choice | Boundary that may not change |
| --- | --- |
| Physical Prisma names, nullable/default strategy, Event-state representation, and safe backfill for existing synthetic Drafts | Preserve owners/assignments/Gates/audit, keep partial Drafts savable, never auto-publish, and return the approved payload. |
| PostgreSQL isolation/row-lock strategy for revision/idempotency/link concurrency | Real PostgreSQL must prove one logical command, one active link, replay-before-version, and atomic audit. |
| Verifier algorithm/key versioning and encrypted replay mechanism | Secure randomness, non-reversible stored verifier, server-side keys, no raw proof/logging, and 24-hour protected issuance replay only. |
| Non-link idempotency retention and cleanup | Same actor/action/resource/key/body replays; changed fingerprint conflicts; unknown outcomes remain safely reconcilable. |
| Cursor encoding/signing | Opaque, stable tuple ordering, scope-bound, no total count or PRIVATE leakage. |
| Maximum field/tag/idempotency-key sizes and exact stable readiness/permitted-action token vocabulary | Use conservative documented limits/tokens derived only from approved fields/actions; reject rather than silently truncate or grant. |
| Final palette/font/component variants/breakpoints and internal frontend route structure | Light/Dark/System behavior, accessibility, screen responsibilities, and `/private#access=...` stay fixed. No package is authorized by documentation alone. |
| Config key name/public-origin wiring for generated access URLs | URL is under the configured public origin with `/private#access=...`; secret never reaches logs or management GET. |

If implementation discovers that one of these choices would alter an observable approved route, field, permission, lifecycle edge, proof rule, or UX behavior, stop and raise it as a contract conflict instead of silently deciding it.

## 12. Determination on the three untracked documents

The following files are untracked at the baseline, are absent from commit `b45ab2262eda97a73a45c92639a65f76e8382cf2`, have no history in the current repository, and are not referenced by current tracked documentation. None is required to implement or validate Slice 3:

| Untracked document | Determination |
| --- | --- |
| `docs/architecture/CERTIFICATE_JOB_ARCHITECTURE.md` | **Not required for Slice 3.** It describes future certificate generation/delivery work owned by Slices 9–10, which this plan explicitly excludes. It may be reviewed later as a candidate future-slice architecture note, but must not be added or cited to justify Slice 3 work. |
| `docs/architecture/FORECASTING_ARCHITECTURE.md` | **Not required for Slice 3.** It describes the future Node↔FastAPI forecasting boundary owned by Slice 8. Slice 3 has no AI-service, forecast route, model, table, chart, or dependency. |
| `docs/implementation/SLICE_1_PLAN.md` | **Not required for Slice 3 or the current documentation baseline.** It is a historical planning artifact for a foundation already represented by committed implementation, tests, roadmap, and current Slice 2/Slice 3 seam. It may be retained separately only as intentionally approved project history; it is not an authority for current work. |

This task does not delete, add, stage, commit, or otherwise modify those files. Their disposition is separate from the Slice 3 execution plan.

## 13. Slice 3 completion gate

Slice 3 is complete only when:

- all 12 routes match the frozen methods, paths, callers, payloads, status codes, errors, pagination, version, idempotency, and audit behavior;
- the migration upgrades both clean and Slice 2 databases and database constraints hold under concurrency;
- Organizer/Event Admin and cross-event negative authorization evidence passes;
- both Gate guards, lifecycle terminal rules, and availability boundaries pass;
- PUBLIC/PRIVATE serializers and uniform PRIVATE denial prove non-leakage;
- one-active PRIVATE proof, no TTL, protected verifier/replay, immediate invalidation, and redaction pass;
- Event + Role restoration/switching remains non-authoritative and handles revocation;
- Light/Dark/System pre-render/persistence/live-System behavior and required UI states are accessible;
- no later-slice route/table/control/data claim has been introduced;
- all existing Slice 1/2 checks and the new Slice 3 checks pass, with implementation, schema, tests, and documentation synchronized.
