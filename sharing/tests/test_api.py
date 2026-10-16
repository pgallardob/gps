"""No real GPS data, external services, accounts or paid resources are used."""

import json
import unittest
from fastapi.testclient import TestClient
from sharing.app import create_app
from sharing.store import SessionStore

OWNER = "o" * 43
ORIGIN = "https://account.github.io"


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(owner_key=OWNER, origins=[ORIGIN], hosts=["relay.test"])
        self.client = TestClient(self.app, base_url="https://relay.test")
        self.headers = {"Origin": ORIGIN, "Authorization": "Bearer " + OWNER}

    def tearDown(self):
        self.client.close()

    def create(self):
        response = self.client.post("/v1/sessions", json={"minutes": 15}, headers=self.headers)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def role(self, token):
        return {"Origin": ORIGIN, "Authorization": "Bearer " + token}

    def test_complete_explicit_consent_publish_view_and_revoke_flow(self):
        session = self.create()
        identifier = session["id"]
        preview = self.client.get(f"/v1/invitations/{identifier}", headers=self.role(session["inviteToken"]))
        self.assertEqual(preview.status_code, 200)
        self.assertNotIn("point", preview.json())
        denied = self.client.post(f"/v1/invitations/{identifier}/accept", json={"consent": False}, headers=self.role(session["inviteToken"]))
        self.assertEqual(denied.status_code, 403)
        acceptance = self.client.post(f"/v1/invitations/{identifier}/accept", json={"consent": True}, headers=self.role(session["inviteToken"]))
        publisher = acceptance.json()["publisherToken"]
        position = {"latitude": 40, "longitude": -3, "accuracy": 10}
        self.assertEqual(self.client.put(f"/v1/sessions/{identifier}/position", json=position, headers=self.role(publisher)).status_code, 200)
        visible = self.client.get(f"/v1/sessions/{identifier}", headers=self.role(session["viewerToken"]))
        self.assertEqual(visible.json()["point"]["latitude"], 40)
        self.assertEqual(visible.headers["cache-control"], "no-store")
        self.assertEqual(self.client.delete(f"/v1/sessions/{identifier}", headers=self.role(publisher)).status_code, 200)
        self.assertIsNone(self.client.get(f"/v1/sessions/{identifier}", headers=self.role(session["viewerToken"])).json()["point"])

    def test_https_exact_host_and_origin_are_required(self):
        for headers in ({"Origin": "https://evil.example"}, {}, {"Origin": ORIGIN, "Host": "evil.example"}):
            response = self.client.post("/v1/sessions", json={"minutes": 15}, headers=headers)
            self.assertIn(response.status_code, (400, 403))
        insecure = TestClient(self.app, base_url="http://relay.test")
        self.assertEqual(insecure.get("/health").status_code, 403)
        insecure.close()

    def test_preflight_allows_only_the_configured_origin_without_cookies(self):
        headers = {"Origin": ORIGIN, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "Authorization,Content-Type"}
        response = self.client.options("/v1/sessions/id/position", headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], ORIGIN)
        self.assertNotIn("access-control-allow-credentials", response.headers)
        response = self.client.options("/v1/sessions/id/position", headers={**headers, "Origin": "https://evil.example"})
        self.assertEqual(response.status_code, 403)

    def test_tokens_are_not_accepted_in_queries_and_weak_keys_are_rejected(self):
        self.assertEqual(self.client.get("/v1/sessions/id?token=" + OWNER, headers={"Origin": ORIGIN}).status_code, 400)
        with self.assertRaises(ValueError):
            create_app(owner_key="password", origins=[ORIGIN], hosts=["relay.test"])
        for origin in ("*", "http://site.example", "https://account.github.io/repo/", "https://a.example;connect-src *"):
            with self.assertRaises(ValueError):
                create_app(owner_key=OWNER, origins=[origin], hosts=["relay.test"])

    def test_body_limits_duplicate_keys_and_extra_fields_fail_closed(self):
        for body in ('{"minutes":15,"minutes":60}', json.dumps({"minutes": 15, "phone": "+123456789"}), '"' + "x" * 5000 + '"', '{"minutes":NaN}'):
            response = self.client.post("/v1/sessions", content=body, headers={**self.headers, "Content-Type": "application/json"})
            self.assertIn(response.status_code, (400, 413, 422))
            self.assertNotIn("+123456789", response.text)

    def test_publisher_does_not_get_viewer_capability_or_reverse_phone_lookup(self):
        session = self.create()
        for path in ("/v1/phone/+123456789", "/api/qgis/open", "/docs", "/openapi.json"):
            self.assertEqual(self.client.get(path, headers=self.headers).status_code, 404)
        response = self.client.get(f"/v1/sessions/{session['id']}", headers=self.role(session["inviteToken"]))
        self.assertEqual(response.status_code, 401)

    def test_strict_consent_and_coordinates_do_not_coerce_strings_or_booleans(self):
        session = self.create()
        url = f"/v1/invitations/{session['id']}/accept"
        self.assertEqual(self.client.post(url, json={"consent": "true"}, headers=self.role(session["inviteToken"])).status_code, 422)
        publisher = self.client.post(url, json={"consent": True}, headers=self.role(session["inviteToken"])).json()["publisherToken"]
        for point in ({"latitude": True, "longitude": 0, "accuracy": 1}, {"latitude": "40", "longitude": 0, "accuracy": 1}, {"latitude": 91, "longitude": 0, "accuracy": 1}):
            self.assertEqual(self.client.put(f"/v1/sessions/{session['id']}/position", json=point, headers=self.role(publisher)).status_code, 422)

    def test_lifespan_cleans_volatile_sessions_and_rate_state_on_shutdown(self):
        store = SessionStore(OWNER)
        app = create_app(owner_key=OWNER, origins=[ORIGIN], hosts=["relay.test"], store=store)
        with TestClient(app, base_url="https://relay.test") as client:
            self.assertEqual(client.post("/v1/sessions", json={"minutes": 15}, headers=self.headers).status_code, 201)
            self.assertEqual(len(store.sessions), 1)
        self.assertEqual(store.sessions, {})
        self.assertEqual(store.rates, {})
