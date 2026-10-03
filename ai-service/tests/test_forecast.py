from copy import deepcopy
from datetime import datetime, timedelta, timezone
import pytest
from app.forecast import forecast, stamp, LIMITATIONS

NOW = datetime(2026, 10, 3, 12, tzinfo=timezone.utc)

def series(size=360, value=None):
    start = NOW - timedelta(minutes=size - 1)
    observations = [{"at": stamp(start + timedelta(minutes=i)), "value": value(i) if value else i + 1, "quality": "COMMITTED"} for i in range(size)]
    occupied = observations[-1]["value"] if observations else 0
    return {"contract_version": 1, "event_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "as_of": stamp(NOW), "time_zone": "UTC", "schedule": {"start_at": None, "end_at": None}, "occupied": occupied, "capacity": 1, "revision": occupied, "observations": observations, "horizons": [30, 60], "method": {"name": "persistence", "version": "1"}}

def test_reproducible_horizons_metrics_and_no_capacity_clipping():
    result = forecast(series(), NOW)
    assert result["status"] == "AVAILABLE"
    assert result["limitations"] == LIMITATIONS
    for point, metric, horizon in zip(result["points"], result["evaluation"]["horizons"], [30, 60]):
        assert point["horizon_minutes"] == horizon
        assert point["target_at"] == stamp(NOW + timedelta(minutes=horizon))
        assert point["predicted_occupancy"] == 360
        assert point["uncertainty"]["lower"] == 360 - horizon
        assert point["uncertainty"]["upper"] == 360 + horizon
        assert metric == {"horizon_minutes": horizon, "samples": 120 - horizon, "mae": horizon, "rmse": horizon, "baseline_mae": horizon, "baseline_rmse": horizon, "interval_coverage": 1.0, "availability_coverage": 1.0}
    split = result["evaluation"]["split"]
    assert split["training"]["end_at"] < split["validation"]["start_at"] < split["test"]["start_at"]
    assert forecast(series(), NOW) == result

def test_test_outcomes_never_calibrate_interval():
    original = series(value=lambda i: 10)
    changed = series(value=lambda i: 10 if i < 240 else 10 + (i - 239) * 2)
    first, second = forecast(original, NOW), forecast(changed, NOW)
    assert first["points"][0]["uncertainty"]["upper"] - first["points"][0]["predicted_occupancy"] == 0
    assert second["points"][0]["uncertainty"]["upper"] - second["points"][0]["predicted_occupancy"] == 0
    assert second["evaluation"]["horizons"][0]["interval_coverage"] == 0
    assert second["evaluation"]["horizons"][0]["mae"] == 60

@pytest.mark.parametrize("size", [0, 1, 60, 269])
def test_sparse_is_unavailable_not_zero(size):
    result = forecast(series(size), NOW)
    assert result["status"] == "INSUFFICIENT_DATA"
    assert result["points"] == [] and result["evaluation"] is None

def test_minimum_and_quiet_zero_history_are_real_available_observations():
    result = forecast(series(270, lambda _: 0), NOW)
    assert result["status"] == "AVAILABLE"
    assert result["points"][0]["predicted_occupancy"] == 0
    assert result["evaluation"]["horizons"][1]["samples"] == 30

def test_staleness_boundary_and_future():
    assert forecast(series(), NOW + timedelta(seconds=60))["status"] == "AVAILABLE"
    assert forecast(series(), NOW + timedelta(seconds=60, milliseconds=1))["status"] == "STALE_INPUT"
    assert forecast(series(), NOW - timedelta(milliseconds=1))["status"] == "INVALID_INPUT"

@pytest.mark.parametrize("kind", ["duplicate", "unsorted", "missing", "negative", "decreasing", "final", "quality", "too_many", "version", "extra", "horizons", "boolean", "uuid", "off_grid"])
def test_invalid_series_is_never_a_prediction(kind):
    request = series()
    if kind == "duplicate": request["observations"][1]["at"] = request["observations"][0]["at"]
    if kind == "unsorted": request["observations"][0], request["observations"][1] = request["observations"][1], request["observations"][0]
    if kind == "missing": del request["observations"][100]
    if kind == "negative": request["observations"][0]["value"] = -1
    if kind == "decreasing": request["observations"][20]["value"] = 0
    if kind == "final": request["occupied"] += 1
    if kind == "quality": request["observations"][0]["quality"] = "REJECTED"
    if kind == "too_many": request["observations"] *= 2
    if kind == "version": request["contract_version"] = 2
    if kind == "extra": request["contact"] = "secret"
    if kind == "horizons": request["horizons"] = [15, 60]
    if kind == "boolean": request["occupied"] = True
    if kind == "uuid": request["event_id"] = "-" * 36
    if kind == "off_grid": request["observations"][0]["at"] = stamp(NOW - timedelta(minutes=359, seconds=-1))
    result = forecast(request, NOW)
    assert result["status"] == "INVALID_INPUT"
    assert result["points"] == [] and result["evaluation"] is None

def test_partial_endpoint_is_origin_not_extra_evaluation_minute():
    request = series(270)
    request["as_of"] = stamp(NOW + timedelta(seconds=12))
    request["observations"].append({"at": request["as_of"], "value": request["occupied"], "quality": "COMMITTED"})
    result = forecast(request, NOW + timedelta(seconds=13))
    assert result["status"] == "AVAILABLE"
    assert result["points"][0]["target_at"] == stamp(NOW + timedelta(minutes=30, seconds=12))
    assert result["evaluation"]["horizons"][1]["samples"] == 30

def test_schedule_json_order_has_no_meaning():
    request = series()
    request["schedule"] = {"end_at": stamp(NOW + timedelta(hours=1)), "start_at": stamp(NOW)}
    assert forecast(request, NOW)["status"] == "AVAILABLE"
