"""Transport startup constraints without launching Uvicorn or exposing secrets."""
import importlib.util
import json
import shlex
import shutil
import subprocess
import sys
from pathlib import Path, PurePosixPath
import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("forecast_entry", ROOT / "ai-service" / "forecast-entry.py")
entry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entry)
KEY = "a" * 64

def assert_startup_from_source_root(image_dir, script):
    assert (image_dir / script).is_file(), "Start command must resolve inside the service root"
    # Execute the actual wrapper; intercept exec only to avoid opening a listener.
    result = subprocess.run(
        [sys.executable, "-c", """
import importlib, os, runpy, sys
from pathlib import Path
from unittest.mock import patch
from uvicorn.importer import import_from_string

def launch(executable, args):
    assert executable == args[0] == 'uvicorn'
    application = import_from_string(args[1])
    module = importlib.import_module('app.main')
    assert application is module.app
    assert Path(module.__file__).resolve() == Path('app/main.py').resolve()

with patch.dict(os.environ, {'FORECAST_SERVICE_KEY': 'a' * 64}, clear=True):
    with patch('os.execvp', side_effect=launch) as execute:
        runpy.run_path(sys.argv[1], run_name='__main__')
        execute.assert_called_once()
""", script],
        cwd=image_dir, capture_output=True, text=True, timeout=15,
    )
    assert result.returncode == 0, result.stderr


def test_railpack_service_root_contains_its_start_command(tmp_path):
    image_dir = tmp_path / "app"
    shutil.copytree(
        ROOT / "ai-service", image_dir,
        ignore=shutil.ignore_patterns(".venv", "__pycache__", ".pytest_cache", "tests"),
    )
    assert_startup_from_source_root(image_dir, "forecast-entry.py")


def test_docker_build_contains_its_start_command(tmp_path):
    dockerfile = ROOT / "docker" / "forecast.Dockerfile"
    instructions = [line.split(maxsplit=1) for line in dockerfile.read_text().splitlines() if line.strip()]
    workdir = PurePosixPath(next(value for op, value in instructions if op == "WORKDIR"))
    assert workdir == PurePosixPath("/app")
    image_dir = tmp_path / workdir.relative_to("/")
    image_dir.mkdir()
    # Reproduce this image's COPY paths using the documented repository-root context.
    for op, value in instructions:
        if op != "COPY":
            continue
        source, target = shlex.split(value)
        source = ROOT / source
        destination = tmp_path / (workdir / target).relative_to("/")
        if source.is_dir():
            shutil.copytree(source, destination)
        else:
            if target.endswith("/"):
                destination /= source.name
            shutil.copyfile(source, destination)
    command = json.loads(next(value for op, value in instructions if op == "CMD"))
    assert command[0] == "python"
    assert_startup_from_source_root(image_dir, command[1])


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
