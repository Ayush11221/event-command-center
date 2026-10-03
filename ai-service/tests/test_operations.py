import logging
from fastapi.testclient import TestClient
from app.main import app

def test_private_health_and_header_redaction(monkeypatch, caplog):
    key = "a" * 64
    monkeypatch.setenv("FORECAST_SERVICE_KEY", key)
    client = TestClient(app)
    assert client.get("/internal/health").status_code == 401
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        response = client.get("/internal/health", headers={"Authorization": "Bearer " + key, "x-correlation-id": "safe-correlation", "traceparent": "00-" + "b" * 32 + "-" + "c" * 16 + "-01"})
    assert response.json() == {"status": "alive"}
    assert "safe-correlation" in caplog.text and "b" * 32 in caplog.text
    assert key not in caplog.text
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        client.get("/internal/health", headers={"x-correlation-id": "private@example.invalid", "Authorization": "Bearer secret-token"})
    assert "private@example.invalid" not in caplog.text and "secret-token" not in caplog.text
