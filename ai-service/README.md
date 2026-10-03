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

Keep the listener internal. Node permits loopback HTTP or remote HTTPS, rejects
redirects, and bounds one request including its body to 2,000 ms and 64 KiB.
Missing configuration, outages and timeouts yield new persisted
`MODEL_UNAVAILABLE` attempts; incompatible results yield `INVALID_INPUT`.
Neither case substitutes an older successful forecast. History never calls Python.

The initial method is deliberately the persistence baseline: carry forward the
last authoritative occupancy at 30 and 60 minutes without capacity clipping.
Node reconstructs exact one-minute states from committed accepted check-ins over
at most six hours, with a fresh endpoint. Python requires 270 full minute
observations, calibrates a nearest-rank 90th-percentile interval on validation
residuals, and reports chronological held-out MAE/RMSE, interval coverage and
availability per horizon. This is check-in-only, baseline-only output with no
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
