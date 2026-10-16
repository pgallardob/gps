"""Bounded in-memory sessions with separate, hashed, revocable capabilities."""

import hashlib
import hmac
import math
import re
import secrets
import threading
import time
from datetime import datetime, timezone

TOKEN = re.compile(r"^[A-Za-z0-9_-]{43,128}$")
SESSION_ID = re.compile(r"^[A-Za-z0-9_-]{22}$")


class RelayError(Exception):
    def __init__(self, code, status=400):
        super().__init__(code)
        self.code, self.status = code, status


def digest(token):
    return hashlib.sha256(token.encode("ascii")).digest()


def matches(token, expected):
    return bool(isinstance(token, str) and TOKEN.fullmatch(token) and expected and hmac.compare_digest(digest(token), expected))


class SessionStore:
    def __init__(self, owner_key, now=time.monotonic, wall=time.time):
        if not TOKEN.fullmatch(owner_key) or owner_key.upper().startswith(("REPLACE", "CHANGE")):
            raise ValueError("Set PUNTO_OWNER_KEY to a unique token_urlsafe(32) secret.")
        self.owner_hash = digest(owner_key)
        self.now, self.wall = now, wall
        self.sessions = {}
        self.lock = threading.RLock()
        self.last_create = -math.inf
        self.rates = {}

    def _owner(self, token):
        if not matches(token, self.owner_hash):
            raise RelayError("unauthorized", 401)

    def _finish(self, session, state):
        session["state"] = state
        session["point"] = None
        session["ended"] = self.now()

    def _sweep(self):
        now = self.now()
        for identifier, session in list(self.sessions.items()):
            if session["state"] in ("pending", "active"):
                if now >= session["expires"]:
                    self._finish(session, "expired")
                elif session["state"] == "active" and (now - session["published"] > 45 or now - session["viewed"] > 60):
                    self._finish(session, "disconnected")
                elif session["point"] and now - session["published"] > 20:
                    session["point"] = None
            elif now - session["ended"] > 60:
                del self.sessions[identifier]

    def rate(self, peer):
        with self.lock:
            now = self.now()
            self.rates = {key: value for key, value in self.rates.items() if now - value[0] < 60}
            if peer not in self.rates and len(self.rates) >= 4096:
                raise RelayError("rate_limit", 429)
            started, count = self.rates.get(peer, (now, 0))
            if count >= 300:
                raise RelayError("rate_limit", 429)
            self.rates[peer] = (started, count + 1)
            self._sweep()

    def _get(self, identifier):
        self._sweep()
        session = self.sessions.get(identifier)
        if session is None:
            raise RelayError("not_found", 404)
        return session

    def expire(self):
        with self.lock:
            self._sweep()
            self.rates = {key: value for key, value in self.rates.items() if self.now() - value[0] < 60}

    def clear(self):
        with self.lock:
            self.sessions.clear()
            self.rates.clear()

    def _view(self, session):
        return {"id": session["id"], "state": session["state"], "expiresAt": session["expires_at"],
                "remainingSeconds": max(0, int(session["expires"] - self.now())),
                "point": dict(session["point"]) if session["point"] else None}

    def create(self, owner, minutes):
        self._owner(owner)
        if type(minutes) is not int or minutes not in (5, 15, 30, 60):
            raise RelayError("invalid_duration")
        with self.lock:
            self._sweep()
            if self.now() - self.last_create < 2 or len(self.sessions) >= 100 or sum(s["state"] in ("active", "pending") for s in self.sessions.values()) >= 20:
                raise RelayError("rate_limit", 429)
            identifier, invite, viewer = secrets.token_urlsafe(16), secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            expiry = self.wall() + minutes * 60
            session = {"id": identifier, "invite": digest(invite), "viewer": digest(viewer), "publisher": None,
                       "state": "pending", "expires": self.now() + minutes * 60,
                       "expires_at": datetime.fromtimestamp(expiry, timezone.utc).isoformat().replace("+00:00", "Z"),
                       "viewed": self.now(), "published": self.now(), "point": None, "ended": None}
            self.sessions[identifier] = session
            self.last_create = self.now()
            return {**self._view(session), "inviteToken": invite, "viewerToken": viewer}

    def preview(self, identifier, invite):
        with self.lock:
            session = self._get(identifier)
            if not matches(invite, session["invite"]):
                raise RelayError("unauthorized", 401)
            if session["state"] != "pending":
                raise RelayError("invitation_used" if session["state"] == "active" else "closed", 410)
            result = self._view(session)
            result.pop("point")
            return result

    def accept(self, identifier, invite, consent):
        if consent is not True:
            raise RelayError("consent_required", 403)
        with self.lock:
            session = self._get(identifier)
            if not matches(invite, session["invite"]):
                raise RelayError("unauthorized", 401)
            if session["state"] != "pending":
                raise RelayError("invitation_used", 409)
            if self.now() - session["viewed"] > 60:
                raise RelayError("viewer_offline", 409)
            publisher = secrets.token_urlsafe(32)
            session["publisher"] = digest(publisher)
            session["state"] = "active"
            session["published"] = self.now()
            return {"publisherToken": publisher, "expiresAt": session["expires_at"],
                    "remainingSeconds": max(0, int(session["expires"] - self.now()))}

    def publish(self, identifier, publisher, position):
        for key, bound in (("latitude", 90), ("longitude", 180), ("accuracy", 20000000)):
            value = position.get(key)
            if type(value) not in (int, float) or abs(value) > bound or not math.isfinite(value) or key == "accuracy" and value < 0:
                raise RelayError("invalid_position")
        with self.lock:
            session = self._get(identifier)
            if not matches(publisher, session["publisher"]):
                raise RelayError("unauthorized", 401)
            if session["state"] != "active":
                raise RelayError("closed", 410)
            if session["point"] and self.now() - session["published"] < 2:
                raise RelayError("rate_limit", 429)
            session["published"] = self.now()
            session["point"] = {key: float(position[key]) for key in ("latitude", "longitude", "accuracy")}
            session["point"]["updatedAt"] = datetime.fromtimestamp(self.wall(), timezone.utc).isoformat().replace("+00:00", "Z")
            return {"accepted": True, "remainingSeconds": max(0, int(session["expires"] - self.now()))}

    def view(self, identifier, viewer):
        with self.lock:
            session = self._get(identifier)
            if not (matches(viewer, session["viewer"]) or matches(viewer, self.owner_hash)):
                raise RelayError("unauthorized", 401)
            session["viewed"] = self.now()
            return self._view(session)

    def revoke(self, identifier, token):
        with self.lock:
            session = self._get(identifier)
            invited = matches(token, session["invite"])
            if not (invited or matches(token, session["viewer"]) or matches(token, session["publisher"]) or matches(token, self.owner_hash)):
                raise RelayError("unauthorized", 401)
            self._finish(session, "stopped")
            return {"stopped": True}
