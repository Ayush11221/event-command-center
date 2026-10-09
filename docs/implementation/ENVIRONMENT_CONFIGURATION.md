# Local environment and Railway inputs

## Vercel-to-Railway OTP source variables

The approved production OTP path uses the [signed gateway](../security/OTP_ABUSE_PROTECTION.md#signed-gateway-contract-and-threat-boundary), not the repository Caddy proxy as a source trust boundary.

| Consumer                                     | Variable                                                                    | Requirement                                                                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Railway API                                  | `OTP_SOURCE_MODE`                                                           | Explicitly `signed_gateway`                                                                                                     |
| Railway API + Vercel Production Node runtime | `OTP_SOURCE_SIGNING_KEY`                                                    | Same independent random 32-byte key encoded as exactly 64 lowercase hex characters; distinct from JWT/contact/OTP/forecast keys |
| Railway API                                  | `OTP_TRUSTED_PROXY_CIDRS`                                                   | Remove entirely in signed mode, including empty values                                                                          |
| Vercel Production Node runtime               | `RAILWAY_API_ORIGIN`                                                        | Existing configured production Railway API HTTPS root origin; no URL credentials, path, query or fragment                       |
| Browser                                      | `VITE_API_ORIGIN`                                                           | Existing origin for all API operations except the two same-origin OTP challenge POSTs; contains no secret                       |
| Railway API                                  | `OTP_CONTACT_*`, `OTP_SOURCE_*` limit/window, `OTP_PROVIDER_*` limit/window | Retain existing budgets unchanged                                                                                               |

The signing key is a direct server variable (no new `_FILE` alias), never a `VITE_*` variable. Do not change existing ignored env files or paste actual credentials into documentation. Configure Production secrets only in Production; Preview/Development require a separate API and separate keys. The gateway does not derive its upstream from request URL, Host or client headers. `direct`, `forwarded` and legacy `railway` retain their existing source validation; production must explicitly choose its mode. Plain local Vite does not execute the gateway function; use a Vercel Node function runtime for gateway development with separate test configuration. Deployment order and live acceptance checks are in the [Railway runbook](RAILWAY_DEPLOYMENT.md#approved-vercel-otp-source-deployment).

This configuration follows the existing parsers, secret loader, Dockerfiles and [Railway runbook](RAILWAY_DEPLOYMENT.md). Public API shapes, database, authorization and delivery lifecycle remain unchanged; account-verification/OTP and certificate email now select SMTP or Brevo HTTPS explicitly. Railway is not deployed by preparing these files.

## Prepared local files

The ignored root `.env` contains only Compose interpolation (`PUBLIC_ORIGIN`, `PUBLIC_HOST`, `RELEASE_TAG`, `SMTP_FROM`). Compose mounts the existing `.secrets` files without copying their contents into environment files. `backend/.env` uses existing `*_FILE` alternatives relative to the backend working directory. `frontend/.env` retains local Vite-to-API configuration. `.env.forecast` is a separate local forecast launch configuration; the Python entrypoint does not automatically read it.

All existing secret files were preserved without reading their contents. Consequently their validity, equality and database reachability are not certified by preparation. API and forecast reference the same `forecast_key` file. Existing database URLs are not rebuilt: native development needs a URL reachable from the host, while Compose uses its private service network. A URL written for Compose may not work with native backend startup. Use the Compose runbook for the prepared container deployment; no database migration or server startup is performed by configuration preparation.

Native backend/frontend commands remain `npm run dev:backend` and `npm run dev:frontend`. For the native forecast on this Windows checkout, launch from repository root:

```powershell
node --env-file=.env.forecast -e "const c=require('node:child_process');const r=c.spawnSync('ai-service/.venv/Scripts/python.exe',['ai-service/forecast-entry.py'],{stdio:'inherit'});process.exit(r.status ?? 1)"
```

This future operator command loads the shared file through the existing entrypoint. Do not run it as a secret-free configuration check.

## Brevo SMTP input

The verified sender supplied by the operator is configured only in ignored local files. The supplied SMTP login is encoded in the ignored `.secrets/smtp_url.brevo.example` template. No SMTP key was supplied to the agent; the existing `.secrets/smtp_url` was neither read nor overwritten.

The exact destination for the completed SMTP URL is **`.secrets/smtp_url`**, one line, without an `SMTP_URL=` prefix. Do not paste the bare key into that file. The URL uses `smtp://`, the Brevo SMTP relay, port 587, percent-encoded login/password and `?requireTLS=true`. This makes STARTTLS mandatory without changing either sender implementation. Both existing senders accept this URL form. [Nodemailer SMTP transport](https://nodemailer.com/smtp).

To avoid constructing or encoding the URL yourself, run `scripts/configure-brevo.ps1 -SmtpUser <YOUR_BREVO_SMTP_LOGIN> -ReplaceExisting`. Enter your **already-generated Brevo SMTP key** into its hidden prompt. The helper writes the URL to `.secrets/smtp_url`, restricts file permissions, never reads the previous file, prints no credentials, and does not connect to Brevo or send email. The replacement switch deliberately authorizes updating this one existing file. Never pass the key in command arguments or shell history. Alternatively complete the ignored template in an editor and put the resulting URL in `.secrets/smtp_url`.

SMTP is optional at startup. In smtp mode, empty SMTP disables account/guest email OTP: `OtpService.request` rejects an unavailable channel; certificate email returns FAILED without SMTP. In brevo_api mode, both OTP and certificate email use the configured Brevo HTTPS sender without SMTP. Phone OTP separately needs an operator SMS adapter. No real transport verification or email is performed by configuration preparation.

## Email transport selection

Use `EMAIL_TRANSPORT=smtp` locally with existing SMTP configuration (also the default when absent, including production). For Railway account-verification/OTP and certificate email set `EMAIL_TRANSPORT=brevo_api`, `BREVO_API_URL=https://api.brevo.com/v3/smtp/email`, and the existing `SMTP_FROM` to the verified Brevo platform email address. Configure the real `BREVO_API_KEY` later **only in protected Railway API service Variables**; never write it to local env files, worksheets, `.secrets`, commands, chat or Git. `backend/.env.example` contains an empty placeholder. The API secret loader also supports an operator-mounted `BREVO_API_KEY_FILE` instead of a direct variable; this task creates no key file.

An old `.env.railway.api` worksheet describes SMTP; it is not executable or authoritative for the selected email transport. Apply the variables above in Railway. Both email paths use the same bounded Brevo HTTPS implementation and need no outbound SMTP, fallback, volume or new SDK. OTP keeps the existing subject/body and expiry instructions. Provider acknowledgement resolves the existing OTP sender; rejection or uncertainty raises a generic error into its unchanged failure cleanup. Challenge HTTP responses, generation/hashing, expiry, attempt limits, resend cooldown, proof checks and account/guest privacy remain unchanged. Phone OTP still uses its existing SMS gateway. Missing Brevo key/URL/sender fails startup; invalid endpoint/auth header settings never echo supplied values. Only a trusted Brevo endpoint may be configured. See the [Railway runbook](RAILWAY_DEPLOYMENT.md) for payload, conservative UNKNOWN handling and operator requirements.

## Exact variable inventory

| Consumer                        | Variables consumed                                                                                                                                                                                                                                   | Source                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| API origin/listener             | `NODE_ENV`, `PORT`, `FRONTEND_ORIGIN`, `BIND_HOST`                                                                                                                                                                                                   | `backend/src/config/env.ts`; `server.ts`                           |
| API foundation                  | `DATABASE_URL`, `JWT_SECRET`, `CONTACT_KEY`, `OTP_KEY`, `EMAIL_TRANSPORT`, `BREVO_API_URL`, `BREVO_API_KEY`, `SMTP_URL`, `SMTP_FROM`, `SMS_GATEWAY_MODULE`, `FORECAST_SERVICE_URL`, `FORECAST_SERVICE_KEY`, `FORECAST_SERVICE_TRANSPORT`, `NODE_ENV` | `backend/src/config/foundation.ts`                                 |
| API file loader                 | `DATABASE_URL_FILE`, `JWT_SECRET_FILE`, `CONTACT_KEY_FILE`, `OTP_KEY_FILE`, `FORECAST_SERVICE_KEY_FILE`, `SMTP_URL_FILE`, `BREVO_API_KEY_FILE`, `METRICS_TOKEN_FILE`                                                                                 | `backend/src/config/secrets.ts`                                    |
| API database/observability      | `DB_POOL_MAX`, `TELEMETRY_ENABLED`, `TRACE_SAMPLE_RATIO`, `METRICS_TOKEN`                                                                                                                                                                            | `database.ts`; `observability/startup.ts`; `observability/http.ts` |
| API Node TLS                    | `NODE_EXTRA_CA_CERTS`                                                                                                                                                                                                                                | Node process startup; Railway runbook                              |
| Forecast startup/API            | `FORECAST_SERVICE_KEY`, `FORECAST_SERVICE_KEY_FILE`, `FORECAST_SERVICE_TRANSPORT`, `UVICORN_HOST`, `UVICORN_PORT`, `UVICORN_SSL_CERTFILE`, `UVICORN_SSL_KEYFILE`                                                                                     | `ai-service/forecast-entry.py`; `ai-service/app/main.py`           |
| Railway private HTTP context    | `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID`; forecast `RAILWAY_PRIVATE_DOMAIN`                                                                                                                                                                    | Platform-provided; API foundation and forecast startup validators  |
| Forecast Python runtime         | `PYTHONDONTWRITEBYTECODE`, `PYTHONUNBUFFERED`; `PYTHONPATH` for native launch                                                                                                                                                                        | Forecast Dockerfile; ignored native forecast configuration         |
| Migration                       | `DATABASE_URL`, `DATABASE_URL_FILE`, `PGPASSWORD`                                                                                                                                                                                                    | `docker/migrate.mjs`; `database/prisma7.config.ts`                 |
| Vite frontend                   | `VITE_API_ORIGIN`; Docker build argument `FRONTEND_ORIGIN`                                                                                                                                                                                           | Frontend service clients; `docker/frontend.Dockerfile`             |
| Frontend runtime                | `RAILWAY_ENVIRONMENT_ID`, `PORT`; local `PUBLIC_ORIGIN`, `PUBLIC_HOST`                                                                                                                                                                               | `frontend-entry.sh`; both Caddyfiles                               |
| Bootstrap                       | `BOOTSTRAP_APPROVED`, `BOOTSTRAP_CONTACT_TYPE`, `BOOTSTRAP_CONTACT_VALUE`, `BOOTSTRAP_ORGANIZER`, plus direct foundation configuration                                                                                                               | `backend/src/bootstrap.ts`                                         |
| Capability command              | `CAPABILITY_APPROVED`, `CAPABILITY_USER_ID`, `CAPABILITY_ENABLED`, plus direct foundation configuration                                                                                                                                              | `backend/src/capability.ts`                                        |
| Compose interpolation           | `RELEASE_TAG`, `PUBLIC_ORIGIN`, `PUBLIC_HOST`, `SMTP_FROM`; migration overlay uses `DATABASE_URL`, `PGPASSWORD`                                                                                                                                      | `docker-compose.yml`; `docker/railway-verification.yml`            |
| Local PostgreSQL initialization | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD_FILE`                                                                                                                                                                                             | Compose and official PostgreSQL entrypoint                         |
| Railway settings                | `RAILWAY_DOCKERFILE_PATH`, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`, temporary `RAILWAY_RUN_UID`                                                                                                                                                        | Railway runbook; platform settings                                 |
| Verification only               | `TEST_DATABASE_URL`, `SLICE12_ORIGIN`, `SLICE12_RESTORE_DATABASE`, `NODE_EXTRA_CA_CERTS`                                                                                                                                                             | Backend integration suite; release/deployment harnesses            |

Do not set a direct secret and its file alternative together. The API startup loads files; bootstrap and capability commands do not. Those administrative commands need direct foundation variables in their operator process. Native npm commands load `backend/.env`; root Prisma commands do not automatically load it.

## Railway checklist and missing inputs

Forecast transport defaults to the existing HTTPS/TLS configuration. The approved
alternative requires `FORECAST_SERVICE_TRANSPORT=railway_private_http` on API and
forecast, API `FORECAST_SERVICE_URL=http://forecast.railway.internal:8000`, and the
same independent forecast bearer key. Set forecast `UVICORN_HOST=0.0.0.0` and
`UVICORN_PORT=8000`, remove both `UVICORN_SSL_CERTFILE` and `UVICORN_SSL_KEYFILE`,
and retain its validated `python forecast-entry.py` start command. Unknown or
empty modes fail startup; absent mode preserves the existing TLS behavior.

Both services require Railway's documented, platform-provided `RAILWAY_PROJECT_ID`
and `RAILWAY_ENVIRONMENT_ID` in this mode. Forecast must additionally receive its
own `RAILWAY_PRIVATE_DOMAIN=forecast.railway.internal` from Railway. Do not create
expected-project/environment variables or override platform metadata to bypass
validation. Operators must confirm the same project/environment, that exact private
domain, IPv4 private connectivity, and no forecast public domain or TCP proxy.
These runtime variables cannot attest the destination's isolation or enumerate
all public routes. See the [exact settings, trust boundary and checks](RAILWAY_DEPLOYMENT.md#explicit-railway-private-http).

The ignored Railway worksheets below describe the default TLS scenario. They are
not evidence of live platform settings and are not loaded automatically. The
private HTTP mode needs no forecast TLS volume; API `NODE_EXTRA_CA_CERTS` may be
removed only when its CA is exclusively for forecast. Preserve any other HTTPS
trust requirements and the public API/frontend HTTPS configuration.

The four ignored `.env.railway.*` files are per-service worksheets, **not runnable configurations**. Do not deploy with unresolved placeholders. For the older all-Railway Docker topology, keep API/forecast/migration private and provision its API/forecast TLS volumes separately. Its fixed Caddy upstream requires the documented API private hostname. For the approved Vercel OTP topology, reuse the existing Railway HTTPS API origin and the signed-source requirements above; do not infer source trust from that Caddy topology.

| Worksheet / service                | Prepared configuration                                                                                                               | Operator inputs still required                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.env.railway.api` / API           | Production listener/origin validation, backend Dockerfile, private CA path, telemetry settings, verified SMTP sender, shutdown grace | Public frontend origin; restricted runtime database URL; preserved application keys; actual forecast HTTPS hostname; Brevo HTTPS endpoint and Railway-only API key; populated CA volume |
| `.env.railway.forecast` / forecast | Forecast Dockerfile, private bind/port, certificate/key paths                                                                        | Shared forecast key; operator-issued certificate/key matching actual private DNS                                                                                                        |
| `.env.railway.migrate` / migrate   | Dedicated migration Dockerfile and separate credential placeholders                                                                  | Managed private admin/migration URL; independent application-role password                                                                                                              |
| `.env.railway.frontend` / frontend | Frontend Dockerfile and public-origin build placeholder                                                                              | Public frontend origin; Railway runtime `PORT` and `RAILWAY_ENVIRONMENT_ID`                                                                                                             |

**Set FRONTEND_ORIGIN after Railway provides the frontend public domain.** Obtain it from frontend service Settings / Networking / Public Networking after reserving the domain. Use the same exact HTTPS origin without a trailing slash in API runtime and frontend build configuration. The Dockerfile derives `VITE_API_ORIGIN` from that build argument: no separate secret or runtime Vite override is needed. Domain changes require a frontend rebuild.

Obtain migration/admin `DATABASE_URL` from the Railway PostgreSQL service's private connection variables. The helper's `PGPASSWORD` is the **eoc_app application-role password**, not the managed PostgreSQL administrator password. Preserve the existing application-role password where appropriate; its file was not read here. The helper provisions that role; construct API's restricted runtime URL using the managed private connection details and that same role password. Do not copy local Compose URLs into Railway or give admin credentials to API. `PGPASSWORD` is removed from Prisma's subprocess environment. The migration job uses direct variables, or the existing mounted migration URL and fixed `/run/secrets/app_password` alternative; there is no invented `APP_PASSWORD_FILE` variable.

For the default HTTPS scenario, obtain the actual forecast private hostname from the forecast service's Settings / Networking / Private Networking (`RAILWAY_PRIVATE_DOMAIN` supplied by the platform). Do not guess it or paste the placeholder into an application variable. The leaf certificate DNS SAN must match that hostname exactly; use serverAuth usage, valid dates, matching key and a complete chain. Set API `FORECAST_SERVICE_URL` using that confirmed hostname. The explicit private HTTP mode instead rejects every hostname except `forecast.railway.internal`.

Provision an operator-managed forecast volume at `/tls` containing `server.crt` and `server.key` (optional public `ca.crt`), and a separate API volume containing only public `ca.crt`. The leaf key must be owned by UID 1000 with mode 0600. Never upload the CA private key, `.artifacts/railway/pki`, local test keys/certificates or the local edge-test CA. Railway volume uploads/ownership preparation and renewal remain operator tasks described in the runbook. No production certificate materialization or issuance mechanism is added here.

Application secret values remain exclusively in existing ignored files. Railway direct-variable placeholders must be filled by the operator through the protected platform UI, or the documented file alternatives must be mounted instead. No secrets are copied to Vite/build arguments. Selecting smtp mode on Railway requires the plan/provider prerequisites in the existing runbook. With brevo_api selected, neither account/guest email OTP nor certificate delivery requires outbound SMTP; provider authentication and real deliverability still need operator verification.

## One-time organizer and capability operations

`.env.bootstrap` and `.env.capability` contain placeholders only. For first organizer provisioning, use the existing API operator process with direct foundation configuration, set `BOOTSTRAP_APPROVED=yes`, choose `BOOTSTRAP_CONTACT_TYPE`, supply an approved `BOOTSTRAP_CONTACT_VALUE`, and set `BOOTSTRAP_ORGANIZER=yes` only for an authorized organizer. Run the existing bootstrap command with `--confirm`, then remove the four temporary variables. No contact or account was created here.

For a later capability change, obtain the existing user UUID from the controlled administration process; set `CAPABILITY_APPROVED=yes`, `CAPABILITY_USER_ID` and `CAPABILITY_ENABLED=yes|no`, then invoke the existing capability command with `--confirm`. Remove the temporary variables afterward. These commands are not application deployment/start commands.

## Verification boundary

Configuration checks must use synthetic credentials and temporary files. Do not validate by loading existing `.secrets` files. Sender tests use mocked Brevo HTTP or disposable loopback SMTP, never real provider calls. The live release, proxy, private-TLS and restore harnesses read existing secrets and/or mutate the demo stack, so they cannot be executed under the no-secret-read constraint. Remote deployment, existing-secret validity, database connectivity, provider authentication and real email remain unverified until the operator supplies inputs and explicitly requests those checks.

Earlier configuration-preparation checks passed: 42 backend configuration/sender tests, four migration tests, 37 Python tests, 384 frontend tests, TypeScript, lint, repository formatting, document formatting and both production builds. Offline transport checks verified URL escaping, both existing Nodemailer transport forms, mandatory STARTTLS and missing-sender rejection without connecting. Helper syntax, its existing-file overwrite guard, malformed-login rejection and percent encoding passed. Its complete write/ACL path was not executed; the temporary fixture test command was rejected by tool policy. Python reported one upstream TestClient deprecation warning.
