from datetime import datetime, timedelta, timezone
import unittest

from event_command_center import CrowdForecaster, EventCommandCenter, QRIdentityProvider


class QRIdentityProviderTests(unittest.TestCase):
    def test_issue_and_validate_token(self) -> None:
        provider = QRIdentityProvider("secret", token_ttl_minutes=10)
        now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)

        token = provider.issue_token("attendee-1", "staff", now=now)
        identity = provider.validate_token(token, now=now + timedelta(minutes=5))

        self.assertEqual(identity.attendee_id, "attendee-1")
        self.assertEqual(identity.role, "staff")

    def test_rejects_tampered_token(self) -> None:
        provider = QRIdentityProvider("secret")
        token = provider.issue_token("attendee-1", "staff")
        tampered = token.replace("attendee-1", "attendee-2")

        with self.assertRaises(ValueError):
            provider.validate_token(tampered)

    def test_rejects_expired_token(self) -> None:
        provider = QRIdentityProvider("secret", token_ttl_minutes=1)
        now = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
        token = provider.issue_token("attendee-1", "staff", now=now)

        with self.assertRaises(ValueError):
            provider.validate_token(token, now=now + timedelta(minutes=2))


class EventCommandCenterTests(unittest.TestCase):
    def test_live_operations_and_forecast(self) -> None:
        provider = QRIdentityProvider("secret")
        center = EventCommandCenter(provider, forecaster=CrowdForecaster())
        center.register_zone("main-stage", capacity=5)

        token = provider.issue_token("attendee-1", "guest")
        scans = [center.ingest_scan("main-stage", token, entering=True) for _ in range(5)]

        self.assertEqual(scans[0]["status"], "normal")
        self.assertEqual(scans[3]["status"], "warning")
        self.assertEqual(scans[4]["status"], "critical")

        center.report_incident("main-stage", "high", "Barrier pressure increase")
        snapshot = center.live_snapshot()

        zone = snapshot["zones"]["main-stage"]
        self.assertEqual(zone["occupancy"], 5)
        self.assertEqual(zone["forecast_next"], 5)
        self.assertGreaterEqual(len(snapshot["incidents"]), 1)
        self.assertEqual(snapshot["incidents"][0]["severity"], "high")


if __name__ == "__main__":
    unittest.main()
