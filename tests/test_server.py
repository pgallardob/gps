"""Local HTTP launcher smoke tests; no external network or GPS access."""

import re
import socket
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parent.parent


class ServerTests(unittest.TestCase):
    def test_serves_app_from_any_working_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            process = subprocess.Popen(
                [sys.executable, "-I", "-B", str(ROOT / "serve.py"), "--port", "0", "--no-browser"],
                cwd=directory, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )
            try:
                line = process.stdout.readline()
                match = re.search(r"http://127\.0\.0\.1:\d+", line)
                self.assertIsNotNone(match, line)
                base = match.group(0)
                for resource, expected_type in [
                    ("/", "text/html"), ("/css/styles.css", "text/css"),
                    ("/js/app.js", "javascript"), ("/vendor/leaflet/leaflet.js", "javascript"),
                ]:
                    with self.subTest(resource=resource), urlopen(base + resource, timeout=5) as response:
                        self.assertEqual(response.status, 200)
                        self.assertIn(expected_type, response.headers["Content-Type"])
                        self.assertGreater(len(response.read()), 0)
            finally:
                process.terminate()
                process.communicate(timeout=5)

    def test_reports_an_occupied_port(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            port = listener.getsockname()[1]
            result = subprocess.run(
                [sys.executable, "-I", "-B", str(ROOT / "serve.py"), "--port", str(port), "--no-browser"],
                capture_output=True, text=True, timeout=5,
            )
        self.assertEqual(result.returncode, 1)
        self.assertIn("Choose another port", result.stdout)


if __name__ == "__main__":
    unittest.main()
