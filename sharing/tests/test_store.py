"""Capability separation, explicit consent, time bounds and minimal retention."""

import unittest
from sharing.store import RelayError, SessionStore

OWNER = "o" * 43
POINT = {"latitude": 40, "longitude": -3, "accuracy": 5}


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.time = 0
        self.store = SessionStore(OWNER, now=lambda: self.time, wall=lambda: 1792188000 + self.time)
        self.session = self.store.create(OWNER, 15)
        self.identifier = self.session["id"]

    def activate(self):
        return self.store.accept(self.identifier, self.session["inviteToken"], True)["publisherToken"]

    def test_phone_numbers_and_plaintext_capabilities_are_not_stored(self):
        stored = self.store.sessions[self.identifier]
        self.assertNotIn("phone", stored)
        self.assertNotIn(self.session["inviteToken"], stored.values())
        self.assertNotIn(self.session["viewerToken"], stored.values())
        self.assertNotIn(OWNER, stored.values())

    def test_pending_invitation_has_no_location_and_requires_explicit_consent(self):
        self.assertIsNone(self.store.view(self.identifier, self.session["viewerToken"])["point"])
        for value in (False, 1, "true", None):
            with self.assertRaises(RelayError):
                self.store.accept(self.identifier, self.session["inviteToken"], value)
        self.assertEqual(self.store.sessions[self.identifier]["state"], "pending")

    def test_invite_can_accept_once_but_cannot_view_or_publish(self):
        publisher = self.activate()
        with self.assertRaises(RelayError):
            self.activate()
        with self.assertRaises(RelayError):
            self.store.view(self.identifier, self.session["inviteToken"])
        with self.assertRaises(RelayError):
            self.store.publish(self.identifier, self.session["viewerToken"], POINT)
        self.store.publish(self.identifier, publisher, POINT)
        result = self.store.view(self.identifier, self.session["viewerToken"])
        self.assertEqual(result["point"]["latitude"], 40)
        self.assertNotIn("publisher", result)
        with self.assertRaises(RelayError):
            self.store.view(self.identifier, publisher)

    def test_only_latest_position_is_retained(self):
        publisher = self.activate()
        self.store.publish(self.identifier, publisher, POINT)
        self.time = 10
        self.store.publish(self.identifier, publisher, {**POINT, "latitude": 41})
        stored = self.store.sessions[self.identifier]
        self.assertEqual(stored["point"]["latitude"], 41)
        self.assertNotIn("history", stored)

    def test_sender_viewer_and_original_invitation_can_revoke_without_leaving_coordinates(self):
        for capability in ("publisher", "viewerToken", "inviteToken"):
            self.setUp()
            publisher = self.activate()
            self.store.publish(self.identifier, publisher, POINT)
            key = publisher if capability == "publisher" else self.session[capability]
            self.store.revoke(self.identifier, key)
            self.assertIsNone(self.store.view(self.identifier, self.session["viewerToken"])["point"])
            with self.assertRaises(RelayError):
                self.store.publish(self.identifier, publisher, POINT)

    def test_stale_positions_hidden_before_publisher_lease_ends(self):
        publisher = self.activate()
        self.store.publish(self.identifier, publisher, POINT)
        self.time = 21
        self.assertIsNone(self.store.view(self.identifier, self.session["viewerToken"])["point"])
        self.time = 46
        result = self.store.view(self.identifier, self.session["viewerToken"])
        self.assertEqual(result["state"], "disconnected")
        with self.assertRaises(RelayError):
            self.store.publish(self.identifier, publisher, POINT)

    def test_viewer_must_be_present_and_expiry_is_absolute(self):
        self.time = 61
        with self.assertRaisesRegex(RelayError, "viewer_offline"):
            self.activate()
        self.store.view(self.identifier, self.session["viewerToken"])
        self.activate()
        self.time = 901
        result = self.store.view(self.identifier, self.session["viewerToken"])
        self.assertEqual(result["state"], "expired")
        self.assertIsNone(result["point"])
        self.time = 962
        self.store.rate("test-peer")
        self.assertNotIn(self.identifier, self.store.sessions)

    def test_session_creation_requires_owner_key_and_is_rate_limited(self):
        with self.assertRaises(RelayError):
            self.store.create(self.session["viewerToken"], 15)
        with self.assertRaisesRegex(RelayError, "rate_limit"):
            self.store.create(OWNER, 15)
        for duration in (True, 0, 1440, "15"):
            with self.assertRaises(RelayError):
                self.store.create(OWNER, duration)

    def test_bad_coordinates_are_not_accepted(self):
        publisher = self.activate()
        for point in ({**POINT, "latitude": True}, {**POINT, "longitude": "-3"}, {**POINT, "accuracy": -1}, {**POINT, "latitude": float("nan")}, {**POINT, "latitude": 10 ** 1000}):
            with self.assertRaises(RelayError):
                self.store.publish(self.identifier, publisher, point)

    def test_periodic_cleanup_removes_idle_ip_counters_without_new_requests(self):
        self.store.rate("synthetic-peer")
        self.time = 61
        self.store.expire()
        self.assertNotIn("synthetic-peer", self.store.rates)
