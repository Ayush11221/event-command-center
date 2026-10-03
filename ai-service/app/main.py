"""Private, authenticated transport. It has no database, browser CORS or control API."""

import hmac
import json
import os
import re
import logging
import time
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from .forecast import forecast

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

@app.middleware("http")
async def telemetry(request: Request, call_next):
    started = time.monotonic()
    response = await call_next(request)
    correlation = request.headers.get("x-correlation-id", "")
    parent = request.headers.get("traceparent", "")
    logging.getLogger("uvicorn.error").info(json.dumps({
        "operation": "forecast" if request.method == "POST" else "health",
        "status": response.status_code,
        "duration_ms": (time.monotonic() - started) * 1000,
        "correlation_id": correlation if re.fullmatch(r"[A-Za-z0-9._-]{1,64}", correlation) else None,
        "trace_id": parent.split("-")[1] if re.fullmatch(r"00-[a-f0-9]{32}-[a-f0-9]{16}-0[01]", parent) else None,
    }))
    return response

@app.get("/internal/health")
async def health(request: Request):
    key = os.environ.get("FORECAST_SERVICE_KEY", "")
    if not re.fullmatch(r"[a-fA-F0-9]{64}", key) or not hmac.compare_digest(request.headers.get("authorization", ""), "Bearer " + key):
        return JSONResponse({"code": "UNAUTHENTICATED"}, status_code=401)
    return {"status": "alive"}


@app.post("/internal/v1/forecasts")
async def generate(request: Request):
    key = os.environ.get("FORECAST_SERVICE_KEY", "")
    if not re.fullmatch(r"[a-fA-F0-9]{64}", key):
        return JSONResponse({"code": "MODEL_UNAVAILABLE"}, status_code=503)
    if not hmac.compare_digest(request.headers.get("authorization", ""), "Bearer " + key):
        return JSONResponse({"code": "UNAUTHENTICATED"}, status_code=401)
    # Bound reads even when Content-Length is absent/chunked; do not echo errors.
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 65536:
            return JSONResponse({"code": "INVALID_INPUT"}, status_code=400)
    try:
        payload = json.loads(body)
        if not isinstance(payload, dict) or not isinstance(payload.get("observations"), list) or any(not isinstance(item, dict) for item in payload["observations"]):
            raise ValueError()
        return forecast(payload)
    except (ValueError, TypeError):
        return JSONResponse({"code": "INVALID_INPUT"}, status_code=400)
    except Exception:
        return JSONResponse({"code": "MODEL_UNAVAILABLE"}, status_code=503)
