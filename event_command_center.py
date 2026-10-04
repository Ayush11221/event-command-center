from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
from typing import Any


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(ts: str) -> datetime:
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    dt = datetime.fromisoformat(ts)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _to_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True)
class QRIdentity:
    attendee_id: str
    role: str
    issued_at: datetime
    expires_at: datetime


class QRIdentityProvider:
    """Issues and validates signed QR identity payloads."""

    def __init__(self, signing_secret: str, token_ttl_minutes: int = 30) -> None:
        if not signing_secret:
            raise ValueError("signing_secret is required")
        if token_ttl_minutes <= 0:
            raise ValueError("token_ttl_minutes must be positive")
        self._secret = signing_secret.encode("utf-8")
        self._ttl = timedelta(minutes=token_ttl_minutes)

    def issue_token(self, attendee_id: str, role: str, now: datetime | None = None) -> str:
        if not attendee_id:
            raise ValueError("attendee_id is required")
        if not role:
            raise ValueError("role is required")

        now = now or _utc_now()
        payload = {
            "attendee_id": attendee_id,
            "role": role,
            "issued_at": _to_iso(now),
            "expires_at": _to_iso(now + self._ttl),
        }
        payload_json = json.dumps(payload, separators=(",", ":"), sort_keys=True)
        signature = hmac.new(self._secret, payload_json.encode("utf-8"), hashlib.sha256).hexdigest()
        return f"{payload_json}.{signature}"

    def validate_token(self, token: str, now: datetime | None = None) -> QRIdentity:
        if "." not in token:
            raise ValueError("Malformed token")

        payload_json, provided_signature = token.rsplit(".", 1)
        expected_signature = hmac.new(self._secret, payload_json.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected_signature, provided_signature):
            raise ValueError("Invalid token signature")

        payload = json.loads(payload_json)
        issued_at = _parse_iso(payload["issued_at"])
        expires_at = _parse_iso(payload["expires_at"])

        current = now or _utc_now()
        if current > expires_at:
            raise ValueError("Token expired")

        return QRIdentity(
            attendee_id=payload["attendee_id"],
            role=payload["role"],
            issued_at=issued_at,
            expires_at=expires_at,
        )


@dataclass
class Incident:
    zone_id: str
    severity: str
    message: str
    created_at: datetime = field(default_factory=_utc_now)


@dataclass
class ZoneState:
    capacity: int
    occupancy_history: list[int] = field(default_factory=list)


class CrowdForecaster:
    """Simple demand forecaster using weighted trend + recent average."""

    def forecast_next(self, occupancy_history: list[int]) -> int:
        if not occupancy_history:
            return 0
        if len(occupancy_history) == 1:
            return occupancy_history[0]

        recent = occupancy_history[-3:]
        avg_recent = sum(recent) / len(recent)
        trend = occupancy_history[-1] - occupancy_history[-2]
        projected = round(avg_recent + (0.6 * trend))
        return max(0, projected)


class EventCommandCenter:
    """Tracks live event operations, incidents, and forecasted crowd pressure."""

    def __init__(self, identity_provider: QRIdentityProvider, forecaster: CrowdForecaster | None = None) -> None:
        self._identity_provider = identity_provider
        self._forecaster = forecaster or CrowdForecaster()
        self._zones: dict[str, ZoneState] = {}
        self._incidents: list[Incident] = []

    def register_zone(self, zone_id: str, capacity: int) -> None:
        if not zone_id:
            raise ValueError("zone_id is required")
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        self._zones[zone_id] = ZoneState(capacity=capacity, occupancy_history=[0])

    def ingest_scan(self, zone_id: str, qr_token: str, entering: bool = True) -> dict[str, Any]:
        if zone_id not in self._zones:
            raise KeyError(f"Zone {zone_id!r} is not registered")

        identity = self._identity_provider.validate_token(qr_token)
        zone = self._zones[zone_id]
        current = zone.occupancy_history[-1] if zone.occupancy_history else 0
        next_occupancy = current + (1 if entering else -1)
        next_occupancy = min(max(0, next_occupancy), zone.capacity)
        zone.occupancy_history.append(next_occupancy)

        utilization = next_occupancy / zone.capacity
        status = "normal"
        if utilization >= 0.95:
            status = "critical"
        elif utilization >= 0.8:
            status = "warning"

        return {
            "attendee_id": identity.attendee_id,
            "role": identity.role,
            "zone_id": zone_id,
            "occupancy": next_occupancy,
            "capacity": zone.capacity,
            "status": status,
        }

    def report_incident(self, zone_id: str, severity: str, message: str) -> None:
        if zone_id not in self._zones:
            raise KeyError(f"Zone {zone_id!r} is not registered")
        if not severity:
            raise ValueError("severity is required")
        if not message:
            raise ValueError("message is required")
        self._incidents.append(Incident(zone_id=zone_id, severity=severity, message=message))

    def live_snapshot(self) -> dict[str, Any]:
        zones = {}
        for zone_id, state in self._zones.items():
            occupancy = state.occupancy_history[-1] if state.occupancy_history else 0
            forecast = self._forecaster.forecast_next(state.occupancy_history)
            zones[zone_id] = {
                "capacity": state.capacity,
                "occupancy": occupancy,
                "forecast_next": min(forecast, state.capacity),
                "utilization": round(occupancy / state.capacity, 3),
            }

        incidents = [
            {
                "zone_id": i.zone_id,
                "severity": i.severity,
                "message": i.message,
                "created_at": _to_iso(i.created_at),
            }
            for i in sorted(self._incidents, key=lambda item: item.created_at, reverse=True)
        ]

        return {"zones": zones, "incidents": incidents}
