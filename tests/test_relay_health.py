"""Health checker validation and opt-in real HTTP tests against the local simulation."""

import contextlib
import http.client
import importlib.util
import io
import os
from pathlib import Path
import re
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("relay_health", ROOT / "scripts/check_relay_health.py")
health = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(health)
SIM = os.environ.get("PUNTO_HEALTH_SIM_URL", "")


class HealthConfigurationTests(unittest.TestCase):
    def test_only_the_project_https_origin_is_used(self):
        for value in ("https://gps-lj9l.onrender.com", "https://gps-lj9l.onrender.com/", "https://gps-lj9l.onrender.com:443"):
            self.assertEqual(health.health_url(value), "https://gps-lj9l.onrender.com/health")

    def test_invalid_targets_are_rejected_without_echoing_secrets(self):
        for value in (None, "", "http://gps-lj9l.onrender.com", "https://127.0.0.1", "https://evil.invalid",
                      "https://name:private-value@gps-lj9l.onrender.com", "https://gps-lj9l.onrender.com?private-value=1",
                      "https://gps-lj9l.onrender.com/#private-value", "https://gps-lj9l.onrender.com/v1/sessions",
                      "https://gps-lj9l.onrender.com:80", "https://gps-lj9l.onrender.com:invalid", " https://gps-lj9l.onrender.com"):
            with self.subTest(value=value), self.assertRaises(health.HealthCheckError) as caught:
                health.health_url(value)
            self.assertNotIn("private-value", str(caught.exception))

    def test_bad_environment_fails_before_a_request(self):
        output = io.StringIO()
        with patch.dict(os.environ, {"PUNTO_SHARING_API_URL": "https://name:private-value@gps-lj9l.onrender.com"}), contextlib.redirect_stdout(output):
            self.assertEqual(health.main(), 2)
        self.assertNotIn("private-value", output.getvalue())

    def test_workflow_has_nominal_gaps_no_larger_than_fourteen_minutes(self):
        workflow = (ROOT / ".github/workflows/relay-health.yml").read_text(encoding="utf-8")
        cron = re.search(r"cron: '([^']+)'", workflow).group(1).split()
        self.assertEqual(cron[1:], ["*", "*", "*", "*"])
        minutes = sorted(map(int, cron[0].split(",")))
        self.assertEqual(max((minutes[(i + 1) % len(minutes)] - minute) % 60 for i, minute in enumerate(minutes)), 14)
        self.assertNotIn(0, minutes)
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("timeout-minutes: 4", workflow)
        self.assertIn("persist-credentials: false", workflow)
        self.assertNotIn("PUNTO_OWNER_KEY", workflow)


@unittest.skipUnless(SIM, "Set PUNTO_HEALTH_SIM_URL to the local relay-health simulation.")
class HealthHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = SIM.rstrip("/")
        parsed = urlsplit(cls.base)
        if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.port is None
                or parsed.path != "/health" or parsed.username is not None or parsed.password is not None
                or parsed.query or parsed.fragment):
            raise ValueError("Only an explicit loopback simulation is allowed.")
        cls.port = parsed.port

    def test_healthy_json_needs_no_credentials(self):
        self.assertIsNone(health.probe(f"{self.base}/health", timeout=2))

    def test_invalid_bodies_never_count_as_success(self):
        for route in ("bad-json", "wrong-shape", "large", "html-ok"):
            with self.subTest(route=route), self.assertRaises(health.HealthCheckError):
                health.probe(f"{self.base}/{route}", timeout=2)

    def test_redirect_is_not_followed(self):
        with self.assertRaisesRegex(health.HealthCheckError, "HTTP 302"):
            health.probe(f"{self.base}/redirect", timeout=2)

    def test_persistent_failure_returns_failure(self):
        reports = []
        self.assertFalse(health.check_health(f"{self.base}/html", timeout=2, retry_delay=0, report=reports.append))
        self.assertEqual(sum(line.startswith("Attempt ") for line in reports), 2)
        self.assertEqual(reports[-1], "Relay health check failed.")

    def test_transient_failure_is_retried(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        try:
            connection.request("POST", "/health/reset")
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            response.read()
        finally:
            connection.close()
        reports = []
        self.assertTrue(health.check_health(f"{self.base}/transient", timeout=2, retry_delay=0, report=reports.append))
        self.assertIn("Attempt 1/2 failed", reports[0])
        self.assertEqual(reports[-1], "Relay health check passed.")

    def test_a_slow_service_has_a_socket_timeout(self):
        with self.assertRaises(health.HealthCheckError):
            health.probe(f"{self.base}/slow", timeout=0.1)


if __name__ == "__main__":
    unittest.main()
