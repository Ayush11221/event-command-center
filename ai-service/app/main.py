"""Private, authenticated transport. It has no database, browser CORS or control API."""

import hmac
import json
import os
import re
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from .forecast import forecast

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


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
