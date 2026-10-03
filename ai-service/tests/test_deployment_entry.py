"""Transport startup constraints without launching Uvicorn or exposing secrets."""
import importlib.util
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location("forecast_entry", Path(__file__).resolve().parents[2] / "docker" / "forecast-entry.py")
entry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entry)
KEY = "a" * 64

def test_compose_loopback_and_direct_key(tmp_path):
    file = tmp_path / "key"
    file.write_text(KEY + "\n")
    env = {"FORECAST_SERVICE_KEY_FILE": str(file)}
    args = entry.configure(env)
    assert args[args.index("--host") + 1] == "127.0.0.1"
    assert args[args.index("--port") + 1] == "8000"
    assert env["FORECAST_SERVICE_KEY"] == KEY and KEY not in args
    assert entry.configure({"FORECAST_SERVICE_KEY": KEY}) == args

@pytest.mark.parametrize("patch", [{"UVICORN_HOST": "0.0.0.0"}, {"UVICORN_HOST": "attacker.invalid"}, {"UVICORN_PORT": "0"}, {"UVICORN_PORT": "65536"}, {"UVICORN_PORT": "bad"}, {"UVICORN_SSL_CERTFILE": "private/file"}, {"FORECAST_SERVICE_KEY_FILE": "private/file"}, {"FORECAST_SERVICE_KEY": "secret-invalid"}])
def test_invalid_startup_is_safe(patch):
    with pytest.raises(ValueError) as error:
        entry.configure({"FORECAST_SERVICE_KEY": KEY, **patch})
    assert KEY not in str(error.value) and "private/file" not in str(error.value) and "secret-invalid" not in str(error.value)

def test_private_binding_requires_existing_tls_pair(tmp_path):
    cert = tmp_path / "certificate"
    key = tmp_path / "private-key"
    cert.write_text("synthetic placeholder; Uvicorn validates PEM at actual startup")
    key.write_text("synthetic placeholder")
    env = {"FORECAST_SERVICE_KEY": KEY, "UVICORN_HOST": "0.0.0.0", "UVICORN_SSL_CERTFILE": str(cert), "UVICORN_SSL_KEYFILE": str(key)}
    args = entry.configure(env)
    assert args[args.index("--host") + 1] == "0.0.0.0"
    assert "--ssl-certfile" in args and "--ssl-keyfile" in args and KEY not in args
    key.unlink()
    with pytest.raises(ValueError,match="Cannot load forecast TLS files"):
        entry.configure(env)
