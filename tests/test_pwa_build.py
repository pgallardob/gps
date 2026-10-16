"""Public build and subpath serving must never expose desktop or relay implementation."""

import http.client
import importlib.util
import json
import tempfile
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BUILD = load("punto_build_tests", ROOT / "scripts/build_site.py")
SERVER = load("punto_pwa_server_tests", ROOT / "serve.py")


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.output = Path(self.directory.name) / "public"

    def tearDown(self):
        self.directory.cleanup()

    def test_build_contains_only_public_files_and_no_owner_keys_or_backends(self):
        version = BUILD.build(self.output)
        files = json.loads((ROOT / "public-files.json").read_text(encoding="utf-8"))
        actual = {str(path.relative_to(self.output)).replace("\\", "/") for path in self.output.rglob("*") if path.is_file()}
        self.assertEqual(actual, set(files) | {".punto-build", ".nojekyll"})
        self.assertNotIn("serve.py", actual)
        self.assertNotIn("qgis_bridge.py", actual)
        self.assertTrue(all(not path.startswith("sharing/") for path in actual))
        self.assertIn(version, (self.output / "sw.js").read_text(encoding="utf-8"))
        self.assertIn('sharingApiUrl": ""', (self.output / "js/deployment.js").read_text(encoding="utf-8"))

    def test_public_relay_url_is_injected_without_embedding_credentials(self):
        BUILD.build(self.output, "https://relay.example/punto")
        for page in ("index.html", "share.html"):
            content = (self.output / page).read_text(encoding="utf-8")
            self.assertIn("connect-src 'self' https://relay.example", content)
        for value in ("http://relay.example", "https://user:password@relay.example", "https://relay.example/?secret=x", "https://relay.example/#secret", "https://*.example"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                BUILD.relay_url(value)

    def test_refuses_to_overwrite_nonbuild_files(self):
        self.output.mkdir()
        private = self.output / "notes.txt"
        private.write_text("user work", encoding="utf-8")
        with self.assertRaises(ValueError):
            BUILD.build(self.output)
        self.assertEqual(private.read_text(encoding="utf-8"), "user work")

    def test_manifest_worker_icons_and_pages_are_served_under_a_repository_prefix(self):
        BUILD.build(self.output)
        server = SERVER.LocalServer(("127.0.0.1", 0), self.output, site_prefix="/my-gps/")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for resource in ("", "manifest.webmanifest", "sw.js", "share.html", "assets/icon-192.png"):
                with self.subTest(resource=resource):
                    connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                    connection.request("GET", "/my-gps/" + resource)
                    response = connection.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertIn("worker-src 'self'", response.getheader("Content-Security-Policy"))
                    response.read()
                    connection.close()
            connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            connection.request("GET", "/my-gps/sharing/app.py")
            response = connection.getresponse()
            self.assertEqual(response.status, 404)
            response.read()
            connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)
