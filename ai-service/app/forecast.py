"""Deterministic accepted-occupancy persistence baseline; no HTTP or database access."""

from datetime import datetime, timedelta, timezone
from math import ceil, sqrt
import re

METHOD = {"name": "persistence", "version": "1", "baseline_name": "persistence", "baseline_version": "1"}
LIMITATIONS = ["BASELINE_ONLY", "CHECK_IN_ONLY", "EMPIRICAL_UNCERTAINTY", "NO_PRODUCTION_ACCURACY_CLAIM"]
STATUSES = {"AVAILABLE", "INSUFFICIENT_DATA", "STALE_INPUT", "MODEL_UNAVAILABLE", "INVALID_INPUT"}


def stamp(value):
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value):
        raise ValueError("Invalid timestamp")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def count(value):
    return type(value) is int and 0 <= value <= 9007199254740991


def forecast(request, now=None):
    """Strict request validation, chronological calibration/test evaluation, two horizons.

    Only actual ledger-derived observations are accepted. Quiet minutes are exact
    reconstructed states, not hypothetical arrivals. No observations are filled here.
    """
    now = now or datetime.now(timezone.utc)
    observations = request.get("observations", [])
    context = {
        "start_at": observations[0].get("at") if observations else None,
        "end_at": request.get("as_of"),
        "last_observation_at": observations[-1].get("at") if observations else None,
        "observation_count": len(observations),
        "revision": request.get("revision"),
        "occupied": request.get("occupied"),
        "capacity": request.get("capacity"),
    }
    result = {
        "contract_version": 1, "event_id": request.get("event_id"),
        "status": "INVALID_INPUT", "generated_at": stamp(now), "input": context,
        "method": dict(METHOD), "points": [], "evaluation": None,
        "limitations": list(LIMITATIONS),
    }
    try:
        expected = {"contract_version", "event_id", "as_of", "time_zone", "schedule", "capacity", "occupied", "revision", "observations", "horizons", "method"}
        if set(request) != expected or request["contract_version"] != 1 or type(request["contract_version"]) is not int:
            return result
        if request["horizons"] != [30, 60] or request["method"] != {"name": "persistence", "version": "1"}:
            return result
        if not isinstance(request["event_id"], str) or not re.fullmatch(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", request["event_id"]):
            return result
        if request["time_zone"] is not None and (not isinstance(request["time_zone"], str) or not 1 <= len(request["time_zone"]) <= 100):
            return result
        if not isinstance(request["schedule"], dict) or set(request["schedule"]) != {"start_at", "end_at"}:
            return result
        schedule = [timestamp(request["schedule"][key]) if request["schedule"][key] is not None else None for key in ("start_at", "end_at")]
        if all(schedule) and schedule[1] <= schedule[0]:
            return result
        if not count(request["occupied"]) or not count(request["revision"]) or request["revision"] != request["occupied"]:
            return result
        if request["capacity"] is not None and (not count(request["capacity"]) or request["capacity"] < 1):
            return result
        end = timestamp(request["as_of"])
        if end > now or len(observations) > 361 or not isinstance(observations, list):
            return result
        parsed = []
        for item in observations:
            if set(item) != {"at", "value", "quality"} or item["quality"] != "COMMITTED" or not count(item["value"]):
                return result
            at = timestamp(item["at"])
            if at > end or end - at > timedelta(hours=6) or (parsed and (at <= parsed[-1][0] or item["value"] < parsed[-1][1])):
                return result
            parsed.append((at, item["value"]))
        if any(at.second != 0 or at.microsecond != 0 for at, _ in parsed[:-1]):
            return result
        if parsed and (parsed[-1][0] != end or parsed[-1][1] != request["occupied"]):
            return result
        if not parsed and request["occupied"] != 0:
            return result
        if now - end > timedelta(seconds=60):
            result["status"] = "STALE_INPUT"
            return result
        # Endpoint may be off the minute grid. It grounds the operational point,
        # but is never counted as another full minute of evaluation history.
        regular = [(at, value) for at, value in parsed if at.second == 0 and at.microsecond == 0]
        if any(right[0] - left[0] != timedelta(minutes=1) for left, right in zip(regular, regular[1:])):
            return result
        if len(regular) < 270:
            result["status"] = "INSUFFICIENT_DATA"
            return result
        size = len(regular)
        blocks = [regular[:size // 3], regular[size // 3:2 * size // 3], regular[2 * size // 3:]]
        split = {name: {"start_at": stamp(block[0][0]), "end_at": stamp(block[-1][0])} for name, block in zip(["training", "validation", "test"], blocks)}
        points, metrics = [], []
        for horizon in (30, 60):
            validation = [abs(blocks[1][i + horizon][1] - blocks[1][i][1]) for i in range(len(blocks[1]) - horizon)]
            radius = sorted(validation)[ceil(len(validation) * 0.9) - 1]
            test = [abs(blocks[2][i + horizon][1] - blocks[2][i][1]) for i in range(len(blocks[2]) - horizon)]
            mae, rmse = sum(test) / len(test), sqrt(sum(error * error for error in test) / len(test))
            value = request["occupied"]
            points.append({"horizon_minutes": horizon, "target_at": stamp(end + timedelta(minutes=horizon)), "predicted_occupancy": value, "uncertainty": {"method": "validation_residual_quantile", "nominal_coverage": 0.9, "lower": max(0, value - radius), "upper": value + radius}})
            eligible_origins = len(blocks[2]) - horizon
            metrics.append({"horizon_minutes": horizon, "samples": len(test), "mae": mae, "rmse": rmse, "baseline_mae": mae, "baseline_rmse": rmse, "interval_coverage": sum(error <= radius for error in test) / len(test), "availability_coverage": len(test) / eligible_origins})
        result.update(status="AVAILABLE", points=points, evaluation={"kind": "BASELINE_ONLY", "split": split, "horizons": metrics})
    except (ValueError, KeyError, TypeError, IndexError, OverflowError):
        pass
    return result
