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

    def test_invitation_input_is_not_saved_or_autofilled(self):
        controls = ET.parse(ANDROID / "main/res/layout/activity_main.xml").getroot().iter("EditText")
        link = next(controls)
        self.assertEqual(link.attrib[NS + "saveEnabled"], "false")
        self.assertEqual(link.attrib[NS + "importantForAutofill"], "no")
        source = (ANDROID / "main/java/io/github/pgallardob/punto/MainActivity.kt").read_text(encoding="utf-8")
        self.assertIn("FLAG_SECURE", source)

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
            events.append({"event": "request", "routeKey": "relay", "method": "PUT", "path": session + "/position", "statusCode": 410})
            file.write_text("\n".join(map(json.dumps, events)), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "after Stop"):
                trace.verify(file)

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


if __name__ == "__main__":
    unittest.main()
