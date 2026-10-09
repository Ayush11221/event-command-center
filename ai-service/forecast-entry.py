"""Loopback HTTP, verified TLS, or explicitly enabled Railway private HTTP."""
import importlib
import os
import re
import sys
from pathlib import Path


class ConfigurationError(ValueError):
    """Only fixed, value-free check descriptions may be reported to operators."""


def configure(env):
    transport = env.get("FORECAST_SERVICE_TRANSPORT")
    if transport is not None and transport != "railway_private_http":
        raise ConfigurationError("Invalid forecast service transport: FORECAST_SERVICE_TRANSPORT must be absent or railway_private_http")
    if transport == "railway_private_http":
        for name in ("RAILWAY_PROJECT_ID", "RAILWAY_ENVIRONMENT_ID"):
            if not env.get(name, "").strip():
                raise ConfigurationError("Private forecast HTTP requires Railway project and environment context: " + name + " is missing or blank")
        if env.get("RAILWAY_PRIVATE_DOMAIN") != "forecast.railway.internal":
            raise ConfigurationError("Private forecast HTTP requires the forecast private domain: RAILWAY_PRIVATE_DOMAIN must equal forecast.railway.internal")
    key = env.get("FORECAST_SERVICE_KEY")
    file = env.get("FORECAST_SERVICE_KEY_FILE")
    if key is not None and file:
        raise ConfigurationError("Ambiguous forecast key source: set only one of FORECAST_SERVICE_KEY and FORECAST_SERVICE_KEY_FILE")
    if file:
        try:
            key = Path(file).read_text().strip()
        except (OSError, UnicodeError, ValueError):
            raise ConfigurationError("Cannot load forecast key: FORECAST_SERVICE_KEY_FILE must be a readable text file") from None
    if not key or not re.fullmatch(r"[a-fA-F0-9]{64}", key):
        raise ConfigurationError("Invalid forecast key: FORECAST_SERVICE_KEY must contain exactly 64 hexadecimal characters")
    host = env.get("UVICORN_HOST", "127.0.0.1")
    if host not in ("127.0.0.1", "0.0.0.0"):
        raise ConfigurationError("Invalid forecast bind host: UVICORN_HOST must be 127.0.0.1 or 0.0.0.0")
    port = env.get("UVICORN_PORT", "8000")
    if not re.fullmatch(r"[0-9]{1,5}", port) or not 1 <= int(port) <= 65535:
        raise ConfigurationError("Invalid forecast port: UVICORN_PORT must be an integer from 1 to 65535")
    cert = env.get("UVICORN_SSL_CERTFILE")
    private_key = env.get("UVICORN_SSL_KEYFILE")
    if transport == "railway_private_http":
        if host != "0.0.0.0":
            raise ConfigurationError("Private forecast HTTP requires UVICORN_HOST=0.0.0.0")
        if port != "8000":
            raise ConfigurationError("Private forecast HTTP requires UVICORN_PORT=8000 exactly")
        if cert or private_key:
            raise ConfigurationError("Private forecast HTTP forbids TLS files: unset UVICORN_SSL_CERTFILE and UVICORN_SSL_KEYFILE")
    elif bool(cert) != bool(private_key) or (host != "127.0.0.1" and not cert):
        raise ConfigurationError("Private forecast networking requires a TLS certificate and key: set both UVICORN_SSL_CERTFILE and UVICORN_SSL_KEYFILE")
    args = [sys.executable, "-m", "uvicorn", "app.main:app", "--host", host, "--port", port, "--no-access-log"]
    if cert:
        try:
            if not Path(cert).is_file() or not Path(private_key).is_file():
                raise ConfigurationError("Cannot load forecast TLS files: UVICORN_SSL_CERTFILE and UVICORN_SSL_KEYFILE must be existing files")
        except (OSError, ValueError):
            raise ConfigurationError("Cannot load forecast TLS files: UVICORN_SSL_CERTFILE and UVICORN_SSL_KEYFILE must be existing files") from None
        args.extend(["--ssl-certfile", cert, "--ssl-keyfile", private_key])
    env["FORECAST_SERVICE_KEY"] = key
    return args


def report_failure(check, error, diagnostic):
    # Never include str/repr(error), tracebacks, arguments or environment values.
    number = error.errno if isinstance(error, OSError) else None
    errno = f", errno={number}" if isinstance(number, int) else ""
    sys.stderr.write(f"Forecast startup failed [{check}] ({type(error).__name__}{errno}): {diagnostic}\n")


def main():
    try:
        args = configure(os.environ)
    except ConfigurationError as error:
        report_failure("configuration", error, str(error))
        return 1
    except Exception as error:
        report_failure("configuration", error, "Unable to validate forecast configuration; check variable and file inputs")
        return 1

    check = "uvicorn_import"
    diagnostic = "Cannot import Uvicorn; install ai-service/requirements.txt with the startup Python interpreter"
    try:
        importlib.import_module("uvicorn")
        check = "application_import"
        diagnostic = "Cannot import app.main:app; install ai-service/requirements.txt and start from the ai-service root"
        importlib.import_module("app.main")
        check = "process_launch"
        diagnostic = "Cannot execute the startup Python interpreter; check runtime executable availability and permissions"
        os.execv(sys.executable, args)
    except Exception as error:
        report_failure(check, error, diagnostic)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
