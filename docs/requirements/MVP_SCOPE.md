# MVP Scope

**Status:** Phase 1 working definition. This separates the smallest complete demonstration from richer versions; it does not delete Must requirements in [REQUIREMENTS.md](REQUIREMENTS.md).

## Complete demonstration thread

An authorized Organizer creates/configures/publishes an event → a participant finds a PUBLIC catalog event or accesses a PRIVATE controlled link → registers as a verified authenticated user or OTP-verified guest → receives an opaque QR → assigned gate staff scan it → the server accepts one check-in and rejects invalid, duplicate, or CANCELLED credentials → accepted attendance changes occupancy once → the command center receives a live update and deduplicated in-product alerts → 30/60-minute advisory forecasts or an explicit unavailable state appear → results/audit are reviewed → accepted-check-in eligibility is identified → staff preview a built-in template and start a bulk certificate batch → unique-ID PDFs are issued → platform-sender email jobs are tracked/retried → certificates remain auditable and revocable.

The demonstration must include a wrong/invalid credential, a retry/duplicate, an unauthorized action, and a degraded live or forecast state. A demonstration is not evidence of performance/security until the tests in [TEST_STRATEGY.md](../testing/TEST_STRATEGY.md) run.

## MVP: minimum implementation of each required capability

| Capability | Minimum viable behavior |
| --- | --- |
| Event | Organizer creates/owns and alone controls lifecycle, including cancellation from Live. Publish requires one configured persistent Event–Gate association; Live independently rechecks it. A Cancelled event blocks registration/check-in and retains existing registrations unchanged; participant notification is post-MVP. Organizer may edit Published details; assigned Admin's Draft/Published ordinary detail edits are only name, description, public venue/location, image/banner, and public category/tags, with separate gate configuration. Live registration/attendance policy changes are restricted. |
| Registration/discovery | PUBLIC Published catalog/detail exposes only approved public-detail fields; PRIVATE Published detail requires a valid opaque event-scoped controlled bearer link and does not leak in discovery. At most one link is active per event; Organizer alone issues/revokes/reissues it, with immediate old-proof invalidation and no automatic time-based MVP expiry. Link authority ends on revoke/replace or leaving PRIVATE Published. Viewing needs no account/guest OTP; registration ownership does. Verified authenticated and OTP-verified guest registration allows one REGISTERED registration per verified identity/event. Registration opens on publication unless a future opening is configured; closes at configured/default event-start time or on Live transition, REGISTERED-cap fullness, or Organizer manual closure. Only capacity-only closure may lift after pre-check-in cancellation; no role may cancel after accepted check-in. Re-registration gets a new token. Slice 3 does not fabricate registration counts/capacity usage or provide a registration action. |
| QR identity | One active opaque credential per registration; view, validate, revoke/reissue under an approved policy; no plaintext PII in QR. |
| Gate | Assigned gate/session, client-generated scan_id, idempotent server decision, failed-entry hold/reject, valid check-in, optional check-out and re-entry only after valid exit; no manual override. |
| Occupancy | Rebuildable accepted check-in/check-out and authorized reasoned correction transitions; never edit the count directly; show current count/capacity/freshness. |
| Roles/volunteers | Five named roles; Organizer-only event lifecycle; assigned-event Admin operations; gate sees only display name, registration/attendance status, event context, scan result; bounded titled volunteer assignment/instructions/applicable time/location and own ASSIGNED → IN_PROGRESS → COMPLETED status. |
| Command center | Live INSIDE occupancy (not REGISTERED count) versus the single event registration cap, gate activity, reconciliation/stale states; exactly three alert categories (occupancy capacity, gate/scanner failure, data/forecast staleness), deduplicated ACTIVE → ACKNOWLEDGED → RESOLVED. Organizer/Admin may acknowledge/resolve; gate sees assigned-gate errors read-only; Volunteer sees no general stream. Registration-full is not an alert. |
| Forecast | Advisory 30- and 60-minute baseline outputs when data permits; current occupancy, capacity, generation time, freshness, uncertainty/limitations, and unavailable state. |
| Results/certificates | Completed-event summary; first accepted check-in produces ELIGIBLE only; explicit Organizer/Admin single or batch issue generates unique-ID PDFs with built-in template/font preview; batch progress; platform-sender email PENDING/SENT/FAILED with Organizer/Admin retry and idempotency and optional Organizer Reply-To; independent explicit revoke/audit. Registration cannot be cancelled after accepted check-in. |
| Audit/security | Audit critical transitions and privileged actions; enforce ownership and role checks at the API; execute required security and accessibility checks. |

## Product Phase 2 (post-MVP)

- Configurable external operational alert/notification channels after consent/delivery rules are defined; MVP certificate email is separate.
- Richer compatible historical comparisons and forecast evaluation as real history accumulates.
- More volunteer task types and configurable operational thresholds.
- Optional wallet/email credential delivery.
- Carefully specified offline/degraded gate validation only if revocation, replay, and reconciliation risks are resolved.
- Waitlist, manual gate overrides, separate registration versus physical capacity, duration-based certificate eligibility, custom template upload/designer/name placement, CSV certificate import, Organizer Gmail OAuth sending, and advanced/configurable forecast horizons.
- Production forecast acceptance threshold after Phase 8 evaluation; no threshold is hardcoded in MVP planning.

## Future/optional

- Multi-venue or multi-organization portfolios, third-party ticketing/identity integrations, native apps, public partner APIs, and zone/spatial forecasting.
- Advanced ML models only if time-ordered evaluation shows a meaningful gain over the baseline.
- Kafka only when reliable fan-out/replay requirements justify its operational cost.

## Explicit limits and gates

- Forecasts and alerts advise people; they never autonomously change gate/safety policy.
- The [decision register](OPEN_PRODUCT_DECISIONS.md) records the locked MVP choices; terminal reopening, amendment, unrestricted export, and forecasting implementation criteria require later decisions if proposed. No unspecified capability is silently added to MVP.
- Build tooling, charting, authentication/session mechanism, live transport, and test libraries are selected or validated in their relevant implementation phases.
- No payment, biometrics, seating, general CRM, offline validation, or general external-alert platform is part of the MVP. Certificate email requires a bounded asynchronous job/delivery capability, not a broad messaging platform.
