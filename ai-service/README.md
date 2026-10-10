# Internal forecasting service

Node/Express owns the public forecasting reads and all event/session/RBAC checks.
This service has no browser CORS, account authentication, database access or
attendance/control endpoints. The finalized public contract is
[API_CONTRACT.md](../docs/api/API_CONTRACT.md), with
[SLICE_8_OPENAPI.json](../docs/api/SLICE_8_OPENAPI.json).

Use the project-local Python 3.13 environment and the versions in `pyproject.toml`.
Set the same independent 32-byte hex `FORECAST_SERVICE_KEY` in Node and Python;
Node also needs `FORECAST_SERVICE_URL`. For local execution from `ai-service`:

```powershell
& '.\.venv\Scripts\python.exe' -m uvicorn app.main:app --host 127.0.0.1 --port 8000
& '.\.venv\Scripts\python.exe' -m pytest -q
```

Keep the listener internal. By default Node permits loopback HTTP or remote HTTPS, rejects
redirects, and bounds one request including its body to 2,000 ms and 64 KiB.
Missing configuration, outages and timeouts yield new persisted
`MODEL_UNAVAILABLE` attempts; incompatible results yield `INVALID_INPUT`.
Neither case substitutes an older successful forecast. History never calls Python.

Railway private HTTP requires `FORECAST_SERVICE_TRANSPORT=railway_private_http`
on both services, API `FORECAST_SERVICE_URL=http://forecast.railway.internal:8000`
(an optional trailing `/` is accepted), and the same independent bearer key.
Both startup validators require Railway's documented `RAILWAY_PROJECT_ID` and
`RAILWAY_ENVIRONMENT_ID`; the Python wrapper additionally requires its own
`RAILWAY_PRIVATE_DOMAIN=forecast.railway.internal`. These are platform-provided
inputs, not values to invent locally for deployment. Set forecast `UVICORN_HOST=0.0.0.0`
and `UVICORN_PORT=8000`, remove both `UVICORN_SSL_*FILE` variables, and use
`python forecast-entry.py` from the service root. This mode rejects TLS settings,
other binds/ports, other URLs and unknown transport values. Leaving the mode
absent preserves loopback HTTP and the existing off-loopback TLS requirement.
It never falls back from HTTPS to HTTP.

Railpack installs the production dependency closure from `requirements.txt`.
Keep its pins identical to `requirements.lock`; deployment tests enforce this.
A bare `pyproject.toml` and `requirements.lock` do not select a Railpack install
step. The requirements file contains the pins directly because Railpack's pip
install layer does not copy `requirements.lock` for a `-r` include. See
[Railpack Python support](https://railpack.com/languages/python).

The wrapper launches the current Python interpreter with `-m uvicorn app.main:app`
and checks imports before the process handoff. Failures identify `configuration`,
`uvicorn_import`, `application_import` or `process_launch`. Configuration messages
name the failed variable/check; import/launch messages report an exception type,
an OS error number when applicable, and a fixed troubleshooting hint. They omit
exception contents, tracebacks, secret values, file paths and environment dumps.
Errors after a successful process handoff are reported by Uvicorn.

The bearer and forecast data rely on Railway's isolated encrypted private network
in this mode. Runtime metadata cannot attest the destination's project/environment,
DNS resolution or all public routes. Operators must confirm both services are in
the same project/environment, the actual private domain matches, private DNS has
IPv4 reachability, and forecast has no public domain or TCP proxy. See the
[Railway settings and verification boundary](../docs/implementation/RAILWAY_DEPLOYMENT.md#explicit-railway-private-http).

The initial method is deliberately the persistence baseline: carry forward the
last authoritative occupancy at 30 and 60 minutes without capacity clipping.
Node reconstructs exact one-minute states from committed accepted check-ins over
at most six hours, with a fresh endpoint. Python requires 270 full minute
observations, calibrates a nearest-rank 90th-percentile interval on validation
residuals, and reports chronological held-out MAE/RMSE, interval coverage and
availability per horizon. This uses net accepted entry/exit history and is baseline-only output with no
production accuracy claim.

Backend PostgreSQL tests require `TEST_DATABASE_URL` pointing to a dedicated test
database with the repository migrations applied. From `backend`, run the full
suite with the installed CLI:

```powershell
node ../node_modules/vitest/vitest.mjs run --environment node --maxWorkers 1 --fileParallelism false
```

Existing occupancy tests assert global audit counts, which concurrent suites can
change. The upgrade preservation test creates and drops only its uniquely named
temporary database.
