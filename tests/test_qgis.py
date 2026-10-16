"""Native integration tests mock QGIS; no real desktop program is launched."""

import http.client
import importlib.util
import json
import os
import tempfile
import threading
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("punto_qgis_server_tests", ROOT / "serve.py")
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)
BRIDGE = SERVER._bridge_module
APPROVED_TEMP = Path(tempfile.gettempdir()) / "opencode"


def snapshot():
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"kind": "route", "source": "demo", "timestamps": ["2026-10-16T12:00:00.000Z", None], "accuracyMeters": [5, None]},
         "geometry": {"type": "LineString", "coordinates": [[-3, 40], [-3.001, 40]]}},
        {"type": "Feature", "properties": {"kind": "waypoint", "name": '<img src="x">', "source": "demo", "popupContent": "<script>bad</script>"},
         "geometry": {"type": "Point", "coordinates": [-3, 40]}}
    ]}


class WaitingProcess:
    def __init__(self):
        self.event = threading.Event()
        self.returncode = None

    def poll(self):
        return self.returncode

    def wait(self):
        self.event.wait()
        return self.returncode

    def finish(self):
        self.returncode = 0
        self.event.set()


class NativeBridgeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="punto-qgis-tests-", dir=APPROVED_TEMP if APPROVED_TEMP.is_dir() else None)
        self.root = Path(self.directory.name)
        self.executable = self.root / "bin" / "qgis-bin.exe"
        self.executable.parent.mkdir()
        self.executable.write_bytes(b"Test fixture only; never executed.")
        self.processes = []
        self.calls = []
        self.threads = set(threading.enumerate())
        self.now = 0

    def tearDown(self):
        for process in self.processes:
            process.finish()
        for thread in threading.enumerate():
            if thread not in self.threads and thread.name == "punto-qgis-cleanup":
                thread.join(timeout=3)
        self.directory.cleanup()

    def launcher(self, arguments, **options):
        self.calls.append((arguments, options, Path(arguments[-1]).read_bytes()))
        process = WaitingProcess()
        self.processes.append(process)
        return process

    def bridge(self, **options):
        return BRIDGE.QgisBridge(executable=self.executable, launcher=self.launcher, now=lambda: self.now, temp_root=self.root, **options)

    def test_canonical_snapshot_drops_urls_crs_and_unrecognized_properties(self):
        data = snapshot()
        data["crs"] = {"href": "https://example.invalid"}
        result = BRIDGE.canonical_snapshot(data)
        self.assertNotIn("crs", result)
        self.assertNotIn("popupContent", result["features"][1]["properties"])
        self.assertTrue(result["metadata"]["simulated"])
        self.assertEqual(result["metadata"]["pointCount"], 2)

    def test_native_launch_uses_fixed_argument_list_no_shell_and_a_private_profile(self):
        bridge = self.bridge()
        with patch.dict(os.environ, {"PYQGIS_STARTUP": "evil.py", "PYTHONPATH": "untrusted"}):
            self.assertEqual(bridge.open(snapshot(), "geojson"), {"opened": True, "format": "geojson"})
        arguments, options, body = self.calls[0]
        self.assertEqual(arguments[0], str(self.executable.resolve()))
        self.assertIn("--noplugins", arguments)
        self.assertIn("--noversioncheck", arguments)
        self.assertIn("--profiles-path", arguments)
        self.assertEqual(arguments[-2], "--")
        self.assertFalse(options["shell"])
        self.assertEqual(options["cwd"], str(self.executable.parent))
        self.assertNotIn("PYQGIS_STARTUP", options["env"])
        self.assertNotIn("PYTHONPATH", options["env"])
        self.assertNotIn(b"popupContent", body)
        self.assertIn("DEMO", Path(arguments[-1]).name)

    def test_gpx_is_generated_from_validated_data_with_escaped_names_and_segments(self):
        self.bridge().open(snapshot(), "gpx")
        body = self.calls[0][2]
        document = ET.fromstring(body)
        namespace = {"g": "http://www.topografix.com/GPX/1/1"}
        self.assertEqual(len(document.findall("g:trk/g:trkseg/g:trkpt", namespace)), 2)
        self.assertEqual(document.find("g:wpt/g:name", namespace).text, '<img src="x">')
        self.assertNotIn(b"<img", body)
        self.assertLess(body.index(b"<wpt"), body.index(b"<trk>"))

    def test_bad_geometry_formats_and_coordinates_never_launch_a_program(self):
        bridge = self.bridge()
        for coordinates in ([[True, 0], [0, 0]], [[181, 0], [0, 0]], [[float("nan"), 0], [0, 0]], [["https://example.invalid", 0], [0, 0]]):
            data = snapshot()
            data["features"][0]["geometry"]["coordinates"] = coordinates
            with self.assertRaises(BRIDGE.QgisError):
                bridge.open(data, "geojson")
        for format in ("qgs", "qgz", "bat", "--code", "../../payload"):
            with self.assertRaises(BRIDGE.QgisError):
                bridge.open(snapshot(), format)
        self.assertEqual(self.calls, [])

    def test_bounds_names_metadata_route_points_and_waypoints(self):
        cases = []
        data = snapshot()
        data["features"][1]["properties"]["name"] = "x" * 81
        cases.append(data)
        data = snapshot()
        data["features"][0]["properties"]["timestamps"] = ["bad", None]
        cases.append(data)
        data = snapshot()
        data["features"][0]["properties"]["accuracyMeters"] = [-1, None]
        cases.append(data)
        data = snapshot()
        data["features"][0]["geometry"]["coordinates"] = [[0, 0]] * 10001
        cases.append(data)
        data = snapshot()
        data["features"] = [data["features"][1]] * 101
        cases.append(data)
        for data in cases:
            with self.assertRaises(ValueError):
                BRIDGE.canonical_snapshot(data)

    def test_rate_limits_success_and_failure_and_caps_active_windows(self):
        bridge = self.bridge()
        bridge.open(snapshot(), "geojson")
        with self.assertRaisesRegex(BRIDGE.QgisError, "rate_limit"):
            bridge.open(snapshot(), "geojson")
        for now in (5, 10):
            self.now = now
            bridge.open(snapshot(), "gpx")
        self.now = 15
        with self.assertRaisesRegex(BRIDGE.QgisError, "busy"):
            bridge.open(snapshot(), "geojson")
        self.assertEqual(len(self.calls), 3)

    def test_failed_launch_removes_only_its_own_temporary_folder(self):
        bridge = self.bridge()
        bridge.launcher = lambda *args, **kwargs: (_ for _ in ()).throw(OSError("test failure"))
        with self.assertRaisesRegex(BRIDGE.QgisError, "launch_failed"):
            bridge.open(snapshot(), "geojson")
        self.assertEqual(list(self.root.glob("punto-qgis-*")), [])
        self.assertTrue(self.executable.is_file())
        with self.assertRaisesRegex(BRIDGE.QgisError, "rate_limit"):
            bridge.open(snapshot(), "geojson")

    def test_files_are_removed_when_the_mock_qgis_process_exits(self):
        self.bridge().open(snapshot(), "geojson")
        folder = Path(self.calls[0][0][-1]).parent
        self.assertTrue(folder.is_dir())
        self.processes[0].finish()
        for thread in threading.enumerate():
            if thread not in self.threads and thread.name == "punto-qgis-cleanup":
                thread.join(timeout=3)
        self.assertFalse(folder.exists())

    def test_absent_or_disabled_qgis_creates_no_files_and_does_not_install_anything(self):
        for enabled, code in ((True, "not_installed"), (False, "disabled")):
            bridge = BRIDGE.QgisBridge(enabled=enabled, autodetect=False, temp_root=self.root)
            self.assertFalse(bridge.status()["available"])
            with self.assertRaisesRegex(BRIDGE.QgisError, code):
                bridge.open(snapshot(), "geojson")
        self.assertEqual(list(self.root.glob("punto-qgis-*")), [])

    def test_executable_configuration_does_not_accept_scripts_or_browser_selected_programs(self):
        for value in ("qgis-bin.exe", self.root / "calc.exe", self.root / "qgis.bat"):
            with self.assertRaises(ValueError):
                BRIDGE.executable_path(value)


class ApiBridge:
    def __init__(self):
        self.calls = []

    def status(self):
        return {"available": True, "reason": "ready"}

    def open(self, data, format):
        BRIDGE.canonical_snapshot(data)
        if format not in ("geojson", "gpx"):
            raise BRIDGE.QgisError("invalid_data")
        self.calls.append((data, format))
        return {"opened": True, "format": format}


class QgisApiTests(unittest.TestCase):
    def setUp(self):
        self.bridge = ApiBridge()
        self.server = SERVER.LocalServer(("127.0.0.1", 0), ROOT, qgis_bridge=self.bridge)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)

    def request(self, payload=None, headers=None, omit=(), path="/api/qgis/open", raw=None, method="POST"):
        base = {"Origin": self.origin, "X-Punto-Token": self.server.qgis_token, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin"}
        base.update(headers or {})
        for name in omit:
            base.pop(name, None)
        body = raw if raw is not None else json.dumps(payload if payload is not None else {"data": snapshot(), "format": "geojson"}).encode()
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            connection.request(method, path, body=body if method == "POST" else None, headers=base)
            response = connection.getresponse()
            return response.status, response.read(), dict(response.getheaders())
        finally:
            connection.close()

    def test_status_is_local_no_store_and_does_not_expose_program_or_temp_paths(self):
        status, body, headers = self.request(path="/api/qgis/status", method="GET")
        data = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(data["token"], self.server.qgis_token)
        self.assertEqual(set(data), {"available", "reason", "token"})
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(self.bridge.calls, [])

    def test_valid_same_origin_token_request_opens_only_qgis(self):
        status, body, _ = self.request()
        self.assertEqual(status, 202)
        self.assertTrue(json.loads(body)["opened"])
        self.assertEqual(len(self.bridge.calls), 1)

    def test_requires_csrf_capability_and_exact_origin(self):
        for headers, omit in [({}, ("Origin",)), ({}, ("X-Punto-Token",)), ({"X-Punto-Token": "bad"}, ()),
                              ({"Origin": "https://attacker.example"}, ()), ({"Sec-Fetch-Site": "same-site"}, ())]:
            with self.subTest(headers=headers, omit=omit):
                self.assertEqual(self.request(headers=headers, omit=omit)[0], 403)
        self.assertEqual(self.bridge.calls, [])

    def test_rejects_content_types_oversized_bodies_and_transfer_encoding(self):
        for headers, expected in [({"Content-Type": "text/plain"}, 415), ({"Content-Length": str(BRIDGE.MAX_BYTES + 1)}, 413),
                                  ({"Transfer-Encoding": "chunked"}, 400), ({"Content-Encoding": "gzip"}, 400)]:
            with self.subTest(headers=headers):
                self.assertEqual(self.request(headers=headers)[0], expected)
        self.assertEqual(self.bridge.calls, [])

    def test_rejects_arbitrary_paths_commands_duplicate_keys_and_malformed_json(self):
        for raw in (b"null", b"[]", b"{bad}", b'{"format":"geojson","format":"gpx","data":{}}',
                    json.dumps({"format": "geojson", "data": snapshot(), "executable": "calc.exe"}).encode()):
            with self.subTest(raw=raw[:40]):
                self.assertEqual(self.request(raw=raw)[0], 400)
        self.assertEqual(self.request(path="/api/qgis/open?program=calc.exe")[0], 405)
        self.assertEqual(self.request(path="/api/execute")[0], 405)
        self.assertEqual(self.bridge.calls, [])


if __name__ == "__main__":
    unittest.main()
