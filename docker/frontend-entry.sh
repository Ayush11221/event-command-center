#!/bin/sh
set -eu
if [ -n "${RAILWAY_ENVIRONMENT_ID:-}" ]; then
  case "${PORT:-}" in
    ''|*[!0-9]*) echo 'Railway PORT must be an integer' >&2; exit 1 ;;
  esac
  if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
    echo 'Railway PORT must be between 1 and 65535' >&2
    exit 1
  fi
  exec caddy run --config /etc/caddy/Caddyfile.railway --adapter caddyfile
fi
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
