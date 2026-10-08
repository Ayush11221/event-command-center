# P1-A authentication and participant UX

Scope: authentication entry, verification, participant registration, entry QR recovery, and session-expiry presentation. P1-B, P1-C, and P1-D remain out of scope. No API, database, authorization, OTP, session-duration, or registration policy changes.

## Journey

One email-first account entry serves existing and new accounts. The existing verified-email endpoint creates ordinary accounts without granting staff capabilities. Ordinary accounts receive participant guidance; organizers and assigned staff keep the existing authorized workspace/context selection.

Registration offers account sign-in/account creation and continuing without an account. Guest email and phone verification remain supported. The shared verification form masks contact information, supports six-digit typing/paste and one-time-code autofill, focuses the code field, shows a five-minute expiry estimate and sixty-second resend cooldown, and prevents concurrent requests. Back/change-contact actions retain cooldowns in component memory. Codes and contacts are never written to browser storage.

The event entry uses an authenticated read of existing registration state to choose Register or View my registration. Confirmation shows available event name/schedule in its configured timezone, current registration state, Show entry QR, and a recovery link. Guests are told to return with the same verified contact. QR content is rendered only as an image, cleared on navigation/access loss, and never displayed as a token string. Cancellation explanations follow server responses; no client-side eligibility policy is introduced.

## Authorization and data reasoning

- The server remains authoritative for account/guest precedence, ownership, staff assignments, CSRF, idempotency, cutoff, check-in, and QR validity.
- Guest requests check account access first. An existing account requires an explicit sign-out action before guest verification. A temporary access failure or expired account is not permission to fall back to a guest.
- The participant page detects changes to the current verification context before accepting refreshed registration state. Identity changes clear pending idempotency keys, ownership, and QR display. New verification requires an explicit choice.
- Unknown mutation results retain the same idempotency key and recover current server state. Duplicate results recover the existing registration instead of submitting another registration.
- On genuine account expiry, the workspace stays mounted but hidden and inert. Same-account reauthentication restores non-sensitive form input; a different account remounts its workspace. New CSRF state is supplied after reauthentication. Shareable private-link bearer material is cleared on access-loss events.
- Verification success followed by a temporary continuation failure offers continuation retry without verifying the consumed code again.
- Negative tests cover access-store failures, expired accounts, failed logout, account appearance during guest verification, changed identities, lost ownership, cancellation rejection, and QR/code privacy.

## Contract limitations

Challenge acceptance is independent of delivery outcome. The API does not disclose sender failures, challenge timestamps, or separate incorrect/expired-code states. The UI uses safe combined verification errors and request-based countdowns; server enforcement remains authoritative. Reloading the page cannot recover an exact countdown from this API.

Registration recovery can fetch allowlisted public event details. For private or no-longer-public events, the existing recovery response does not include event name/time, so the page directs participants to their original event link while keeping registration and QR recovery available.

Validation uses the existing Vitest/testing-library stack and local Playwright Chromium with synthetic API responses. Browser checks do not establish deployed delivery, live-database integration, physical-device behavior, or production readiness.
