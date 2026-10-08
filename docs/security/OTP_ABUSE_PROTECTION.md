# P0-E aggregate OTP abuse protection

Public account and guest challenge requests can otherwise generate repeated outbound messages after each challenge cooldown. The shared enforcement boundary is `OtpService.request`; HTTP-only throttling would miss internal callers. Normalization and channel availability checks precede admission. The existing sender, challenge-specific HMAC, constant-time verification, five-minute expiry, sixty-second cooldown, five attempts, latest-active semantics, contact locking, audits and account/guest separation are preserved.

EMAIL admission accepts a single bare mailbox and rejects SMTP display/list/comment/quote/backslash/control syntax before creating a challenge. Otherwise SMTP could deliver different hashed address strings to the same mailbox. The aggregate contact key also canonicalizes Unicode domains with IDNA, so equivalent Unicode/ASCII domain spellings cannot evade it. Existing identity hashes, stored contacts and verification normalization are unchanged; canonicalization applies only to the new abuse key.

## Admission and configuration

| Layer                                                       | Environment variables                               | Defaults                    |
| ----------------------------------------------------------- | --------------------------------------------------- | --------------------------- |
| Normalized contact, shared across account/guest purposes    | `OTP_CONTACT_LIMIT`, `OTP_CONTACT_WINDOW_SECONDS`   | 10 requests / 3600 seconds  |
| Canonical request source, across contacts/purposes          | `OTP_SOURCE_LIMIT`, `OTP_SOURCE_WINDOW_SECONDS`     | 120 requests / 600 seconds  |
| Application OTP admission, across channels/purposes/sources | `OTP_PROVIDER_LIMIT`, `OTP_PROVIDER_WINDOW_SECONDS` | 500 requests / 3600 seconds |

These are application defaults, not assumptions about Brevo's quota. Operators must align the application budget with their selected service capacity and traffic. Limits are positive decimal integers up to 1,000,000; windows are positive integer seconds up to 86,400. All replicas must share configuration and the existing stable OTP/contact keys. Changing a window or rotating keys creates a new budget identity; deploy such changes consistently and account for the fresh capacity.

The provider layer counts admitted requests, including cooldown requests and unknown PHONE account requests that do not produce delivery. This conservative policy prevents account existence from affecting provider saturation. A denial rolls back all reservations and challenge changes. Valid requests consume capacity only when their challenge transaction commits, including an admitted cooldown result. Rejected input, unavailable channels and failed transactions consume no capacity. The chosen contact allowance is well above an ordinary sign-in plus retries, while preventing a contact from sending once per minute indefinitely; the source allowance accommodates shared networks. Fixed windows may admit a burst on either side of a window boundary.

## Source trust

Express has no existing `trust proxy` policy. OTP source resolution is feature-local and does not change session, Origin/CORS or authorization behavior. `OTP_SOURCE_MODE` must be explicit in production:

- `direct`: use the socket peer, canonicalizing IPv4-mapped IPv6 and IPv6 spellings; ignore all client forwarding headers. Use only for direct client connections, not a shared production reverse proxy.
- `forwarded`: require `OTP_TRUSTED_PROXY_CIDRS`, accept X-Forwarded-For only from a matching socket peer and walk right to left to the first untrusted address. The configured proxies must append/overwrite accurate peer information. Chains are bounded to sixteen addresses.
- `railway`: require `OTP_TRUSTED_PROXY_CIDRS`, accept exactly one valid X-Real-IP only from a matching socket peer. [Railway documents X-Real-IP as its client remote IP header](https://docs.railway.com/networking/public-networking/specs-and-limits). The repository's Railway Caddy edge forwards this header to the private API. This mode relies on requests entering through Railway HTTP ingress, its replacement of the client header, a private API with no public bypass, and only the identified Caddy peers reaching that API. Configure exact trusted Caddy IPv4/IPv6 CIDRs for every replica; do not infer a platform-wide trusted range or allow all private networks. Verify different external clients produce distinct sources and spoofed client headers cannot change the result before deployment acceptance.

Proxy modes fail closed on an untrusted peer, missing/invalid header or ambiguous metadata; they do not quietly group everyone under the proxy's IP. Direct mode is the development default. No trusted proxy range is guessed or installed automatically. Internal direct service callers without HTTP context share a durable `internal` source budget; they still reserve contact and application capacity. No raw source identity is persisted or returned to clients.

## Atomicity, storage and failures

The additive `OtpRateLimitBucket` table has a composite `(category,key,windowStart)` primary key, a positive count constraint, category/expiry constraints and an expiry index. Keys are domain-separated keyed HMACs, not raw contacts/IPs. Database `clock_timestamp()` determines epoch-aligned windows consistently across application instances. Parameterized PostgreSQL UPSERT increments only while below the limit, with row locking; all three reservations and challenge/audit writes share a transaction. A consistent PROVIDER, SOURCE, CONTACT order prevents competing budget-lock order cycles. Existing contact locks still protect challenge issuance/verification. Admission-store errors return generic temporary unavailability and cannot reach delivery. Other authenticated APIs never access the limiter.

There are no per-request permanent rows. Each bucket expires one day after its window ends (at most two days after its start). Each successful admission transaction deletes up to 200 indexed expired rows with SKIP LOCKED. Cleanup is lazy: idle buckets remain until traffic resumes, and denied/rolled-back transactions do not commit cleanup. Successful traffic removes old rows faster than it creates new ones (at most three per admission). The application admission cap also bounds new contact/source bucket creation; exhaustion cannot create rows indefinitely. No worker or external infrastructure is added.

Committed reservations are never refunded, including definite/ambiguous provider failures, process failure or abandoned delivery callbacks. They expire with their window, so failure costs are finite and attackers cannot exploit reserve/refund loops. A delivery callback attempts sending at most once. Failed delivery keeps existing challenge consumption/audit handling. Brevo retains HTTPS, its ten-second timeout, bounded acceptance parsing, no response-body logging and no SMTP fallback.

Aggregate denials use one generic 429 without category/count/quota details or existence-dependent retry timing. Operator Pino warnings contain only CONTACT/SOURCE/PROVIDER and `delivery_attempted:false`; normal admissions add no limiter log or PII-heavy audit trail. Existing issuance/delivery/failure audits distinguish whether sending proceeded. OTP values, contact hashes, raw sources, tokens and credentials never enter limiter logs.

## Validation and deployment

Focused PostgreSQL tests exercise each budget, concurrency across independent clients/services, normalized-contact purpose sharing, request/source spoofing, window rollover, bounded cleanup, fail-closed admission, enumeration, failed-delivery reservations and one-use callbacks. Existing auth/Brevo/session/staff/registration suites retain legitimate signup/login, guest proof, registration and permission coverage. An additive-upgrade test snapshots all old tables and columns, then verifies their preservation and new constraints. Apply the new migration through the existing migration deployment path before starting the API. Repository implementation and local tests do not certify live Railway trust settings or real Brevo delivery.
