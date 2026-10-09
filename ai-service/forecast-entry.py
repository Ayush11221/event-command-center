"""Loopback HTTP locally; verified private TLS when bound off loopback."""
import os
import re
import sys
from pathlib import Path


def configure(env):
    key = env.get("FORECAST_SERVICE_KEY")
    file = env.get("FORECAST_SERVICE_KEY_FILE")
    if key is not None and file:
        raise ValueError("Ambiguous forecast key source")
    if file:
        try:
            key = Path(file).read_text().strip()
        except (OSError, UnicodeError):
            raise ValueError("Cannot load forecast key") from None
    if not key or not re.fullmatch(r"[a-fA-F0-9]{64}", key):
        raise ValueError("Invalid forecast key")
    host = env.get("UVICORN_HOST", "127.0.0.1")
    if host not in ("127.0.0.1", "0.0.0.0"):
        raise ValueError("Invalid forecast bind host")
    port = env.get("UVICORN_PORT", "8000")
    if not re.fullmatch(r"[0-9]{1,5}", port) or not 1 <= int(port) <= 65535:
        raise ValueError("Invalid forecast port")
    cert = env.get("UVICORN_SSL_CERTFILE")
    private_key = env.get("UVICORN_SSL_KEYFILE")
    if bool(cert) != bool(private_key) or (host != "127.0.0.1" and not cert):
        raise ValueError("Private forecast networking requires a TLS certificate and key")
    args = ["uvicorn", "app.main:app", "--host", host, "--port", port, "--no-access-log"]
    if cert:
        if not Path(cert).is_file() or not Path(private_key).is_file():
            raise ValueError("Cannot load forecast TLS files")
        args.extend(["--ssl-certfile", cert, "--ssl-keyfile", private_key])
    env["FORECAST_SERVICE_KEY"] = key
    return args


if __name__ == "__main__":
    try:
        args = configure(os.environ)
        os.execvp("uvicorn", args)
    except (ValueError, OSError):
        # No key values, environment dumps or private file paths in diagnostics.
        sys.stderr.write("Forecast startup failed; verify key and private TLS configuration\n")
        sys.exit(1)
