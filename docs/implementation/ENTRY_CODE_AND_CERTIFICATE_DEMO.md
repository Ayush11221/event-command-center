# Entry code and certificate demonstration

Use dedicated synthetic records. Do not scan a real participant just to test.

1. Publish a demo event, configure a gate and assign its Gate / Security user.
2. Register a synthetic attendee while the event is Published.
3. Organizer: use **Start live event** and confirm. A Published event cannot admit attendees.
4. Participant: Public events → Live events → event → **View my registration** → **Show entry QR**. The existing registration remains available during Live.
5. Show the QR to the assigned gate scanner. For the fallback, choose **Show entry code** → **Copy entry code**, and have staff open **Enter QR code manually**, paste it into **Entry QR code**, then press **Check in**. The text is the exact credential encoded in the QR, not the registration ID/link or a short OTP.
6. The first eligible scan returns **Accepted / Inside**. Repeating the same QR or entry code returns **Already checked in**, with one attendance transition.
7. Participant: in **My certificate**, save the desired recipient name. Copy the registration link for staff lookup; this link is separate from the private entry code.
8. Organizer / Event Admin: Certificates → paste the registration link → **Check eligibility** → optionally **Preview certificate** → **Issue certificate**. An accepted check-in and a saved recipient name are required. Issuing is allowed while Live or Completed.
9. Participant: **Refresh certificate status** → **Prepare certificate download** → **Download my certificate PDF**.
10. **Email delivery** has its own status and refresh button. **Sent** means accepted by the email service, not proof of inbox delivery. **Failed** does not invalidate the issued PDF. **Unknown** must not be blindly resent. Missing eligible verified email may produce **Not required**.

## Exit scanning scope

The current API and attendance model implement check-in only. The stored `checkout_enabled` option does not implement exit scanning or grant an exit permission. An exit transition requires a separately tested backend/API/database implementation and corresponding occupancy changes. No exit scan is required for current certificate eligibility.

## Credential protection

`GET /registrations/{id}/credential` remains owner-only and `no-store`, and returns `entry_code` alongside `qr_svg`. Both represent the same existing opaque credential. No new credential, numeric code, migration, or admission rule is introduced. Staff and strangers cannot retrieve it. The frontend reveals text only on explicit action and clears it with the QR on hide, pagehide or ownership loss. Never log the value, put it in a URL, persist it in client storage, or copy it into certificate lookup. Clipboard copying is an explicit owner action.

Manual scans use the existing scan API, authentication, CSRF, current gate assignment, event scoping, expiry/revocation checks, Live lifecycle requirement, duplicate prevention and transactional attendance constraints. A frontend deployed ahead of the API displays a QR-only fallback rather than inventing a code.

Local camera emulation does not prove physical phone-camera decoding. Local SMTP/Brevo adapter tests do not prove production inbox delivery.
