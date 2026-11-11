"""Local privacy/configuration gates; actual Android behavior is exercised by emulator CI."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "mobile/android/app/src"
NS = "{http://schemas.android.com/apk/res/android}"
SPEC = importlib.util.spec_from_file_location("android_trace", ROOT / "scripts/check_android_trace.py")
trace = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(trace)
REPORT_SPEC = importlib.util.spec_from_file_location("android_annotations", ROOT / "scripts/annotate_android_failure.py")
reporter = importlib.util.module_from_spec(REPORT_SPEC)
REPORT_SPEC.loader.exec_module(reporter)


class AndroidContractTests(unittest.TestCase):
    def test_service_is_private_and_visible_location_only(self):
        manifest = ET.parse(ANDROID / "main/AndroidManifest.xml").getroot()
        permissions = {item.attrib[NS + "name"] for item in manifest.findall("uses-permission")}
        self.assertIn("android.permission.FOREGROUND_SERVICE_LOCATION", permissions)
        self.assertIn("android.permission.POST_NOTIFICATIONS", permissions)
        for denied in ("ACCESS_BACKGROUND_LOCATION", "READ_CONTACTS", "READ_PHONE_STATE", "RECEIVE_BOOT_COMPLETED", "WRITE_EXTERNAL_STORAGE"):
            self.assertNotIn("android.permission." + denied, permissions)
        service = manifest.find("application/service")
        self.assertEqual(service.attrib[NS + "exported"], "false")
        self.assertEqual(service.attrib[NS + "foregroundServiceType"], "location")
        app = manifest.find("application")
        self.assertEqual(app.attrib[NS + "allowBackup"], "false")
        self.assertEqual(app.attrib[NS + "usesCleartextTraffic"], "false")
        self.assertEqual(app.find("activity").attrib[NS + "launchMode"], "singleTask")

    def test_invitation_input_is_not_saved_or_autofilled(self):
        controls = ET.parse(ANDROID / "main/res/layout/activity_main.xml").getroot().iter("EditText")
        link = next(controls)
        self.assertEqual(link.attrib[NS + "saveEnabled"], "false")
        self.assertEqual(link.attrib[NS + "importantForAutofill"], "no")
        source = (ANDROID / "main/java/io/github/pgallardob/punto/MainActivity.kt").read_text(encoding="utf-8")
        self.assertIn("FLAG_SECURE", source)

    def test_default_native_map_uses_a_closed_origin_scoped_adapter(self):
        root = ET.parse(ANDROID / "main/res/layout/activity_main.xml").getroot()
        views = {view.attrib.get(NS + "id", "").split("/")[-1]: view for view in root.iter()}
        self.assertNotEqual(views["personal_panel"].attrib.get(NS + "visibility"), "gone")
        self.assertEqual(views["sharing_panel"].attrib[NS + "visibility"], "gone")
        renderer = (ANDROID / "main/java/io/github/pgallardob/punto/NativeMap.kt").read_text(encoding="utf-8")
        self.assertNotIn("addJavascriptInterface(", renderer)
        self.assertIn("setOf(ORIGIN)", renderer)
        self.assertIn("isMainFrame", renderer)
        self.assertIn("sourceOrigin.toString() == ORIGIN", renderer)
        self.assertIn("view.url == PAGE", renderer)
        for setting in ("allowFileAccess = false", "allowContentAccess = false", "setGeolocationEnabled(false)", "domStorageEnabled = false"):
            self.assertIn(setting, renderer)

    def test_no_native_credential_or_history_persistence_is_added(self):
        source = "\n".join(path.read_text(encoding="utf-8") for path in (ANDROID / "main/java").rglob("*.kt"))
        for denied in ("getSharedPreferences(", "FileOutputStream(", "SQLiteDatabase", "Log.d(", "Log.e(", "PUNTO_OWNER_KEY"):
            self.assertNotIn(denied, source)
        self.assertIn("START_NOT_STICKY", source)
        self.assertIn("instanceFollowRedirects = false", source)

    def test_trace_requires_real_routes_and_no_upload_after_stop(self):
        session = "/v1/sessions/" + "r" * 22
        invite = "/v1/invitations/" + "r" * 22
        events = [{"event": "listening"}] + [
            {"event": "request", "routeKey": "relay", "method": method, "path": path, "statusCode": 200}
            for method, path in (("GET", invite), ("POST", invite + "/accept"), ("PUT", session + "/position"),
                                 ("PUT", session + "/position"), ("DELETE", session))
        ]
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "trace.ndjson"
            file.write_text("\n".join(map(json.dumps, events)), encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()):
                trace.verify(file)
            marker = {"event": "request", "routeKey": "relay", "method": "POST", "path": "/__personal_done", "statusCode": 200}
            reset = {"event": "request", "routeKey": "relay", "method": "POST", "path": "/__reset", "statusCode": 200}
            personal_events = [events[0], reset, marker] + events[1:]
            file.write_text("\n".join(map(json.dumps, personal_events)), encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()):
                trace.verify(file, with_personal=True)
            events.append({"event": "request", "routeKey": "relay", "method": "PUT", "path": session + "/position", "statusCode": 410})
            file.write_text("\n".join(map(json.dumps, events)), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "after Stop"):
                trace.verify(file)

    def test_personal_trace_must_not_contact_the_relay(self):
        marker = {"event": "request", "routeKey": "relay", "method": "POST", "path": "/__personal_done", "statusCode": 200}
        events = [{"event": "listening"}, {"event": "request", "routeKey": "relay", "method": "GET", "path": "/v1/invitations/private", "statusCode": 200}, marker]
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "trace.ndjson"
            file.write_text("\n".join(map(json.dumps, events)), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Personal mode contacted"):
                trace.verify(file, with_personal=True)

    def test_personal_trace_requires_its_successful_completion_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "trace.ndjson"
            file.write_text(json.dumps({"event": "listening"}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "personal no-invitation test did not finish"):
                trace.verify(file, with_personal=True)

    def test_diagnostic_annotations_redact_credentials_and_escape_commands(self):
        text = 'Bearer private-header {"publisherToken":"private-json", "PUNTO_OWNER_KEY":"private-owner"} #invite=private-link'
        safe = reporter.sanitize(text)
        for secret in ("private-header", "private-json", "private-owner", "private-link"):
            self.assertNotIn(secret, safe)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            reporter.emit("compiler failure\n::warning::unexpected%")
        self.assertEqual(len(output.getvalue().splitlines()), 1)
        self.assertIn("%0A", output.getvalue())
        self.assertIn("%25", output.getvalue())

    def test_compile_diagnostics_do_not_exhaust_the_annotation_budget_on_normal_tasks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "android-build.log").write_text("\n".join(["> Task :app:normal"] * 100 + ["e: compiler root cause"]), encoding="utf-8")
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                reporter.main(root, root / "empty-build")
            self.assertEqual(output.getvalue().count("::error title="), 1)
            self.assertIn("compiler root cause", output.getvalue())

    def test_emulator_invokes_one_bash_script_without_masking_test_failures(self):
        workflow = (ROOT / ".github/workflows/android.yml").read_text(encoding="utf-8")
        self.assertIn("script: bash scripts/verify_android_emulator.sh", workflow)
        shell = (ROOT / "scripts/verify_android_emulator.sh").read_text(encoding="utf-8")
        self.assertIn("set -euo pipefail", shell)
        self.assertIn("connectedSimulationDebugAndroidTest", shell)
        self.assertIn("check_android_trace.py", shell)

    def test_successful_build_is_not_reported_as_a_compilation_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "android-build.log").write_text("BUILD SUCCESSFUL in 2m", encoding="utf-8")
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                reporter.main(root, root / "empty-build")
            self.assertNotIn("android-build.log", output.getvalue())


if __name__ == "__main__":
    unittest.main()
