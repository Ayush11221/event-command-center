"""Transport startup constraints without launching Uvicorn or exposing secrets."""
import importlib.util
import json
import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path, PurePosixPath
from unittest.mock import patch as mock_patch
import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("forecast_entry", ROOT / "ai-service" / "forecast-entry.py")
entry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entry)
KEY = "a" * 64
PRIVATE_ENV = {
    "FORECAST_SERVICE_KEY": KEY,
    "FORECAST_SERVICE_TRANSPORT": "railway_private_http",
    "RAILWAY_PROJECT_ID": "synthetic-project",
    "RAILWAY_ENVIRONMENT_ID": "synthetic-environment",
    "RAILWAY_PRIVATE_DOMAIN": "forecast.railway.internal",
    "UVICORN_HOST": "0.0.0.0",
    "UVICORN_PORT": "8000",
}

def assert_startup_from_source_root(image_dir, script, env):
    assert (image_dir / script).is_file(), "Start command must resolve inside the service root"
    # Execute the actual wrapper; intercept exec only to avoid opening a listener.
    result = subprocess.run(
        [sys.executable, "-c", """
import importlib, json, os, runpy, sys
from pathlib import Path
from unittest.mock import patch
from uvicorn.importer import import_from_string

def launch(executable, args):
    assert executable == args[0] == sys.executable
    assert args[1:3] == ['-m', 'uvicorn']
    application = import_from_string(args[3])
    module = importlib.import_module('app.main')
    assert application is module.app
    assert Path(module.__file__).resolve() == Path('app/main.py').resolve()

with patch.dict(os.environ, json.loads(sys.argv[2]), clear=True):
    with patch('os.execv', side_effect=launch) as execute:
        try:
            runpy.run_path(sys.argv[1], run_name='__main__')
        except SystemExit as error:
            assert error.code == 0
        execute.assert_called_once()
""", script, json.dumps(env)],
        cwd=image_dir, capture_output=True, text=True, timeout=15,
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("env", [{"FORECAST_SERVICE_KEY": KEY}, PRIVATE_ENV])
def test_railpack_service_root_contains_its_start_command(tmp_path, env):
    image_dir = tmp_path / "app"
    shutil.copytree(
        ROOT / "ai-service", image_dir,
        ignore=shutil.ignore_patterns(".venv", "__pycache__", ".pytest_cache", "tests"),
    )
    assert_startup_from_source_root(image_dir, "forecast-entry.py", env)


@pytest.mark.parametrize("env", [{"FORECAST_SERVICE_KEY": KEY}, PRIVATE_ENV])
def test_docker_build_contains_its_start_command(tmp_path, env):
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
    assert_startup_from_source_root(image_dir, command[1], env)


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


def test_explicit_railway_private_http_without_tls():
    env = dict(PRIVATE_ENV)
    args = entry.configure(env)
    assert args == [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
    assert env["FORECAST_SERVICE_KEY"] == KEY and KEY not in args


@pytest.mark.parametrize("transport", ["", "https", "http", "railway_private_https", "RAILWAY_PRIVATE_HTTP", " railway_private_http", "railway_private_http ", "secret-unknown"])
def test_unknown_transport_fails_closed_even_on_loopback(transport):
    for env in [{"FORECAST_SERVICE_KEY": KEY}, PRIVATE_ENV]:
        with pytest.raises(ValueError, match="Invalid forecast service transport"):
            entry.configure({**env, "FORECAST_SERVICE_TRANSPORT": transport})


@pytest.mark.parametrize("name", ["RAILWAY_PROJECT_ID", "RAILWAY_ENVIRONMENT_ID"])
@pytest.mark.parametrize("value", [None, "", "   "])
def test_private_http_requires_railway_context(name, value):
    env = dict(PRIVATE_ENV)
    if value is None:
        del env[name]
    else:
        env[name] = value
    with pytest.raises(ValueError, match="Railway project and environment context"):
        entry.configure(env)


@pytest.mark.parametrize("domain", [None, "", "other.railway.internal", "forecast.railway.internal.", "FORECAST.RAILWAY.INTERNAL", "forecast.railway.internal.attacker.invalid", "forecast.up.railway.app", "forecast.railway.internal "])
def test_private_http_requires_exact_platform_private_domain(domain):
    env = dict(PRIVATE_ENV)
    if domain is None:
        del env["RAILWAY_PRIVATE_DOMAIN"]
    else:
        env["RAILWAY_PRIVATE_DOMAIN"] = domain
    with pytest.raises(ValueError, match="forecast private domain"):
        entry.configure(env)


@pytest.mark.parametrize("patch", [
    {"UVICORN_HOST": "127.0.0.1"}, {"UVICORN_HOST": "::"},
    {"UVICORN_PORT": "8001"}, {"UVICORN_PORT": "08000"},
    {"UVICORN_SSL_CERTFILE": "private/cert"},
    {"UVICORN_SSL_KEYFILE": "private/key"},
    {"UVICORN_SSL_CERTFILE": "private/cert", "UVICORN_SSL_KEYFILE": "private/key"},
    {"FORECAST_SERVICE_KEY": "secret-invalid"},
    {"FORECAST_SERVICE_KEY_FILE": "private/key"},
])
def test_private_http_rejects_invalid_bind_tls_or_key_without_disclosure(patch):
    with pytest.raises(ValueError) as error:
        entry.configure({**PRIVATE_ENV, **patch})
    for sensitive in [KEY, "private/cert", "private/key", "secret-invalid"]:
        assert sensitive not in str(error.value)


def test_private_http_retains_file_key_loading(tmp_path):
    file = tmp_path / "key"
    file.write_text(KEY + "\n")
    env = {**PRIVATE_ENV, "FORECAST_SERVICE_KEY_FILE": str(file)}
    del env["FORECAST_SERVICE_KEY"]
    args = entry.configure(env)
    assert env["FORECAST_SERVICE_KEY"] == KEY and KEY not in args
    assert "--ssl-certfile" not in args


def test_startup_failure_output_redacts_configuration():
    result = subprocess.run(
        [sys.executable, str(ROOT / "ai-service" / "forecast-entry.py")],
        env={**PRIVATE_ENV, "FORECAST_SERVICE_TRANSPORT": "secret-unknown"},
        capture_output=True, text=True, timeout=15,
    )
    assert result.returncode == 1 and result.stdout == ""
    assert result.stderr == (
        "Forecast startup failed [configuration] (ConfigurationError): Invalid forecast service transport: "
        "FORECAST_SERVICE_TRANSPORT must be absent or railway_private_http\n"
    )


def test_railpack_requirements_are_self_contained_and_match_production_pins():
    service = ROOT / "ai-service"
    # Railpack copies requirements.txt, but not a referenced requirements.lock,
    # into its dependency-install layer. An '-r requirements.lock' shim fails.
    def pins(path):
        return [line.strip() for line in path.read_text().splitlines() if line.strip() and not line.startswith("#")]

    requirements = pins(service / "requirements.txt")
    assert requirements == pins(service / "requirements.lock")
    assert all("==" in line and not line.startswith("-") for line in requirements)
    assert "fastapi==0.142.2" in requirements and "uvicorn==0.54.0" in requirements


def test_actual_module_launch_does_not_require_uvicorn_on_path(tmp_path):
    # Exercise the real process handoff, with --help avoiding a network listener.
    result = subprocess.run(
        [sys.executable, "-c", """
import os, runpy
from unittest.mock import patch
execute = os.execv
def launch(executable, args):
    execute(executable, [*args, '--help'])
with patch('os.execv', side_effect=launch):
    runpy.run_path('forecast-entry.py', run_name='__main__')
"""],
        cwd=ROOT / "ai-service",
        env={**PRIVATE_ENV, "PATH": str(tmp_path), **{name: os.environ[name] for name in ("SystemRoot", "WINDIR") if name in os.environ}},
        capture_output=True, text=True, timeout=15,
    )
    assert result.returncode == 0, result.stderr
    assert "Usage:" in result.stdout and "--no-access-log" in result.stdout
    assert KEY not in result.stdout + result.stderr


@pytest.mark.parametrize("uvicorn_present, check, diagnostic", [
    (False, "uvicorn_import", "Cannot import Uvicorn"),
    (True, "application_import", "Cannot import app.main:app"),
])
def test_missing_dependencies_in_bare_service_environment(tmp_path, uvicorn_present, check, diagnostic):
    service = tmp_path / "app"
    service.mkdir()
    shutil.copyfile(ROOT / "ai-service" / "forecast-entry.py", service / "forecast-entry.py")
    shutil.copytree(ROOT / "ai-service" / "app", service / "app", ignore=shutil.ignore_patterns("__pycache__"))
    if uvicorn_present:
        (service / "uvicorn.py").write_text("# Synthetic importable Uvicorn; FastAPI remains absent.\n")
    environment = tmp_path / "bare-python"
    subprocess.run([sys.executable, "-m", "venv", "--without-pip", str(environment)], check=True, capture_output=True, timeout=30)
    python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    result = subprocess.run(
        [str(python), "forecast-entry.py"], cwd=service,
        env={**PRIVATE_ENV, "PATH": str(tmp_path), **{name: os.environ[name] for name in ("SystemRoot", "WINDIR") if name in os.environ}},
        capture_output=True, text=True, timeout=15,
    )
    assert result.returncode == 1 and result.stdout == ""
    assert f"Forecast startup failed [{check}] (ModuleNotFoundError): {diagnostic}" in result.stderr
    assert "requirements.txt" in result.stderr
    assert KEY not in result.stderr and str(tmp_path) not in result.stderr
    assert "Traceback" not in result.stderr


@pytest.mark.parametrize("changes, diagnostic", [
    ({"FORECAST_SERVICE_TRANSPORT": "secret-transport"}, "FORECAST_SERVICE_TRANSPORT"),
    ({"RAILWAY_PROJECT_ID": " "}, "RAILWAY_PROJECT_ID is missing or blank"),
    ({"RAILWAY_ENVIRONMENT_ID": ""}, "RAILWAY_ENVIRONMENT_ID is missing or blank"),
    ({"RAILWAY_PRIVATE_DOMAIN": "secret-domain"}, "RAILWAY_PRIVATE_DOMAIN must equal"),
    ({"FORECAST_SERVICE_KEY_FILE": "secret-path"}, "Ambiguous forecast key source"),
    ({"FORECAST_SERVICE_KEY": None, "FORECAST_SERVICE_KEY_FILE": "secret-path"}, "Cannot load forecast key"),
    ({"FORECAST_SERVICE_KEY": None}, "Invalid forecast key"),
    ({"FORECAST_SERVICE_KEY": "secret-key"}, "exactly 64 hexadecimal characters"),
    ({"UVICORN_HOST": "secret-host"}, "Invalid forecast bind host"),
    ({"UVICORN_PORT": "secret-port"}, "Invalid forecast port"),
    ({"UVICORN_HOST": "127.0.0.1"}, "requires UVICORN_HOST=0.0.0.0"),
    ({"UVICORN_PORT": "08000"}, "requires UVICORN_PORT=8000 exactly"),
    ({"UVICORN_SSL_CERTFILE": "secret-cert"}, "unset UVICORN_SSL_CERTFILE and UVICORN_SSL_KEYFILE"),
    ({"UVICORN_SSL_KEYFILE": "secret-tls-key"}, "unset UVICORN_SSL_CERTFILE and UVICORN_SSL_KEYFILE"),
    ({"FORECAST_SERVICE_TRANSPORT": None}, "requires a TLS certificate and key"),
    ({"FORECAST_SERVICE_TRANSPORT": None, "UVICORN_SSL_CERTFILE": "secret-cert", "UVICORN_SSL_KEYFILE": "secret-tls-key"}, "Cannot load forecast TLS files"),
])
def test_each_configuration_failure_identifies_check_without_values(changes, diagnostic, capsys):
    env = {**PRIVATE_ENV, "UNRELATED_TOKEN": "secret-unrelated", **changes}
    env = {name: value for name, value in env.items() if value is not None}
    with mock_patch.dict(os.environ, env, clear=True), mock_patch.object(entry.os, "execv") as execute:
        assert entry.main() == 1
    execute.assert_not_called()
    output = capsys.readouterr()
    assert output.out == "" and diagnostic in output.err
    assert output.err.startswith("Forecast startup failed [configuration] (ConfigurationError): ")
    for sensitive in [KEY, "synthetic-project", "synthetic-environment", *[value for value in env.values() if value.startswith("secret-")]]:
        assert sensitive not in output.err
    assert "Traceback" not in output.err


@pytest.mark.parametrize("failure", [
    FileNotFoundError(2, "secret-exception-message", "secret-file-path"),
    PermissionError(13, "secret-exception-message", "secret-file-path"),
    OSError(8, "secret-exception-message", "secret-file-path"),
    ValueError("secret-exception-message"),
])
def test_launch_errors_report_type_and_errno_without_exception_contents(failure, capsys):
    with mock_patch.dict(os.environ, PRIVATE_ENV, clear=True), mock_patch.object(entry.os, "execv", side_effect=failure):
        assert entry.main() == 1
    output = capsys.readouterr()
    assert output.out == ""
    assert f"Forecast startup failed [process_launch] ({type(failure).__name__}" in output.err
    assert "runtime executable availability and permissions" in output.err
    if isinstance(failure, OSError):
        assert f"errno={failure.errno}" in output.err
    for sensitive in [KEY, "secret-exception-message", "secret-file-path"]:
        assert sensitive not in output.err
    assert "Traceback" not in output.err


@pytest.mark.parametrize("module, check", [("uvicorn", "uvicorn_import"), ("app.main", "application_import")])
def test_import_exception_diagnostics_do_not_echo_secrets(module, check, capsys):
    def import_module(name):
        if name == module:
            raise ModuleNotFoundError("secret-exception-message", name="secret-module-name")
        return object()

    with mock_patch.dict(os.environ, PRIVATE_ENV, clear=True), mock_patch.object(entry.importlib, "import_module", side_effect=import_module), mock_patch.object(entry.os, "execv") as execute:
        assert entry.main() == 1
    execute.assert_not_called()
    output = capsys.readouterr()
    assert output.out == "" and f"[{check}] (ModuleNotFoundError)" in output.err
    for sensitive in [KEY, "secret-exception-message", "secret-module-name"]:
        assert sensitive not in output.err
    assert "Traceback" not in output.err
