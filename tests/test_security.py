"""Regression tests for the localhost HTTP security boundary."""

import http.client
import importlib.util
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("punto_server", ROOT / "serve.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = MODULE.LocalServer(("127.0.0.1", 0), ROOT)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def request(self, path="/", method="GET", headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            connection.request(method, path, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_internal_files_and_directory_listings_are_not_public(self):
        for path in ("/serve.py", "/qgis_bridge.py", "/start.bat", "/README.md", "/tests/", "/js/", "/.env", "/.git/config"):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)

    def test_blocks_traversal_and_windows_path_encodings(self):
        for path in ("/../serve.py", "/%2e%2e/serve.py", "/js/%2e%2e/serve.py", "/%5cserve.py",
                     "/%252e%252e/serve.py", "/%00index.html", "//attacker.example/index.html"):
            with self.subTest(path=path):
                self.assertIn(self.request(path)[0], (400, 404))

    def test_rejects_rebinding_hosts_and_untrusted_origins(self):
        for host in ("attacker.example", "127.0.0.1.attacker.example", "localhost", "localhost:1", "[::1]:1"):
            with self.subTest(host=host):
                self.assertEqual(self.request(headers={"Host": host})[0], 421)
        for origin in ("https://attacker.example", "null", "http://127.0.0.1:1"):
            with self.subTest(origin=origin):
                self.assertEqual(self.request(headers={"Origin": origin})[0], 403)
        self.assertEqual(self.request(headers={"Host": f"localhost:{self.server.server_port}"})[0], 200)

    def test_rejects_duplicate_host_headers(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            connection.putrequest("GET", "/", skip_host=True)
            connection.putheader("Host", f"localhost:{self.server.server_port}")
            connection.putheader("Host", "attacker.example")
            connection.endheaders()
            response = connection.getresponse()
            self.assertEqual(response.status, 421)
            response.read()
        finally:
            connection.close()

    def test_blocks_cross_site_subresources_but_allows_top_level_navigation(self):
        self.assertEqual(self.request(headers={"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Dest": "iframe"})[0], 403)
        self.assertEqual(self.request(headers={"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate"})[0], 200)

    def test_security_headers_on_success_and_errors(self):
        for path in ("/", "/.env"):
            _, headers, _ = self.request(path)
            self.assertIn("script-src 'self'", headers["Content-Security-Policy"])
            self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
            self.assertNotIn("'unsafe-eval'", headers["Content-Security-Policy"])
            self.assertEqual(headers["X-Frame-Options"], "DENY")
            self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
            self.assertEqual(headers["Cache-Control"], "no-store")
            self.assertIn("geolocation=(self)", headers["Permissions-Policy"])
            self.assertNotIn("Python", headers["Server"])
            self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_static_paths_support_only_get_and_head(self):
        status, headers, body = self.request(method="HEAD")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"")
        for method in ("POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE", "CONNECT"):
            with self.subTest(method=method):
                self.assertEqual(self.request(method=method)[0], 405)

    def test_canceled_browser_connections_are_handled_without_hiding_other_errors(self):
        handler = object.__new__(MODULE.PublicHandler)
        for error in (ConnectionAbortedError(), ConnectionResetError(), BrokenPipeError(), TimeoutError()):
            with patch.object(MODULE.BaseHTTPRequestHandler, "handle", side_effect=error):
                handler.handle()
        with patch.object(MODULE.BaseHTTPRequestHandler, "handle", side_effect=RuntimeError("real bug")):
            with self.assertRaises(RuntimeError):
                handler.handle()

    def test_csp_origin_configuration_rejects_injection_and_plaintext_remote_endpoints(self):
        for value in ("*", "https://*.example.test", "https://example.test; script-src *", "http://example.test", "https://u:p@example.test", "https://example.test/path", "https://éxample.test"):
            with self.subTest(value=value), self.assertRaises(Exception):
                MODULE.safe_origin(value)
        self.assertEqual(MODULE.safe_origin("https://example.test/"), "https://example.test")
        self.assertEqual(MODULE.safe_origin("http://127.0.0.1:9000"), "http://127.0.0.1:9000")

    def test_symlinks_cannot_escape_the_public_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            outside = root / "private.txt"
            outside.write_text("private test data", encoding="utf-8")
            public = root / "public"
            public.mkdir()
            try:
                (public / "index.html").symlink_to(outside)
            except OSError:
                self.skipTest("Creating symlinks requires additional privileges on this OS.")
            server = MODULE.LocalServer(("127.0.0.1", 0), public)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            try:
                connection.request("GET", "/")
                response = connection.getresponse()
                self.assertEqual(response.status, 404)
                self.assertNotIn(b"private test data", response.read())
            finally:
                connection.close()
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)
