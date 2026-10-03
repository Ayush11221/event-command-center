import json
from fastapi.testclient import TestClient
from app.main import app
from test_forecast import series

client = TestClient(app)
KEY = "a" * 64

def test_internal_auth_and_no_browser_surface(monkeypatch):
    monkeypatch.setenv("FORECAST_SERVICE_KEY", KEY)
    assert client.post("/internal/v1/forecasts", json=series()).status_code == 401
    assert client.post("/internal/v1/forecasts", headers={"Authorization": "Bearer wrong"}, json=series()).status_code == 401
    for path in ["/docs", "/openapi.json", "/api/v1/events/x/forecasts/current"]:
        assert client.get(path).status_code == 404
    response = client.options("/internal/v1/forecasts", headers={"Origin": "https://browser.test", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in response.headers

def test_safe_bounded_malformed_and_unconfigured(monkeypatch):
    monkeypatch.delenv("FORECAST_SERVICE_KEY", raising=False)
    assert client.post("/internal/v1/forecasts").status_code == 503
    monkeypatch.setenv("FORECAST_SERVICE_KEY", "z" * 64)
    assert client.post("/internal/v1/forecasts").status_code == 503
    monkeypatch.setenv("FORECAST_SERVICE_KEY", KEY)
    headers = {"Authorization": "Bearer " + KEY}
    for content in ["not-json-secret", "x" * 65537, json.dumps({"observations": [1]})]:
        response = client.post("/internal/v1/forecasts", headers=headers, content=content)
        assert response.status_code == 400
        assert response.json() == {"code": "INVALID_INPUT"}
    response = client.post("/internal/v1/forecasts", headers=headers, json=series())
    assert response.status_code == 200
    assert set(response.json()) == {"contract_version", "event_id", "status", "generated_at", "input", "method", "points", "evaluation", "limitations"}
