"""Optional HTTPS relay: no desktop integration, phone lookup, database or location history."""

import asyncio
import json
import os
import re
from contextlib import asynccontextmanager, suppress
from typing import Literal
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator

from .store import RelayError, SessionStore


class CreateSession(BaseModel):
    model_config = ConfigDict(extra="forbid")
    minutes: Literal[5, 15, 30, 60] = 15


class Consent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    consent: StrictBool


class Position(BaseModel):
    model_config = ConfigDict(extra="forbid")
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    accuracy: float = Field(ge=0, le=20000000, allow_inf_nan=False)

    @field_validator("latitude", "longitude", "accuracy", mode="before")
    @classmethod
    def numeric_only(cls, value):
        if type(value) not in (int, float):
            raise ValueError("Numbers required")
        return value


def configuration(owner_key=None, origins=None, hosts=None, allow_local=False):
    owner_key = owner_key or os.environ.get("PUNTO_OWNER_KEY", "")
    origins = origins if origins is not None else os.environ.get("PUNTO_FRONTEND_ORIGINS", "").split(",")
    hosts = hosts if hosts is not None else os.environ.get("PUNTO_ALLOWED_HOSTS", "").split(",")
    origins, hosts = [x.strip() for x in origins if x.strip()], [x.strip().lower() for x in hosts if x.strip()]
    if not origins or not hosts:
        raise ValueError("Configure exact PUNTO_FRONTEND_ORIGINS and PUNTO_ALLOWED_HOSTS.")
    for origin in origins:
        value = urlsplit(origin)
        local = allow_local and value.hostname in ("127.0.0.1", "localhost")
        if (not value.hostname or value.username or value.password or value.path or value.query or value.fragment or
                not origin.isascii() or any(x in origin for x in " *;'\"\\<>") or
                value.scheme != "https" and not (local and value.scheme == "http")):
            raise ValueError("Frontend origins must be exact HTTPS origins, not paths or wildcards.")
        _ = value.port
    if any(not re.fullmatch(r"[a-z0-9.-]+", host) or ".." in host or host.startswith(".") for host in hosts):
        raise ValueError("Allowed hosts must be exact hostnames, without ports or wildcards.")
    return owner_key, origins, hosts


class SecurityBoundary:
    def __init__(self, app, store, origins, hosts, allow_local):
        self.app, self.store, self.origins, self.hosts, self.allow_local = app, store, origins, hosts, allow_local

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = scope.get("headers", [])
        values = lambda name: [v.decode("latin-1") for k, v in headers if k == name]
        origin_values, host_values = values(b"origin"), values(b"host")
        origin = origin_values[0] if len(origin_values) == 1 else ""
        common = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY"}

        async def error(code, status):
            extra = {**common}
            if origin in self.origins:
                extra.update({"Access-Control-Allow-Origin": origin, "Vary": "Origin"})
            await JSONResponse({"error": code}, status_code=status, headers=extra)(scope, receive, send)

        try:
            host = urlsplit("http://" + host_values[0]).hostname if len(host_values) == 1 else None
            if host not in self.hosts or any(x in host_values[0] for x in "/\\@ ;"):
                await error("invalid_host", 400)
                return
            peer = (scope.get("client") or ("", 0))[0]
            secure = scope.get("scheme") == "https" or self.allow_local and host in ("127.0.0.1", "localhost") and peer in ("127.0.0.1", "::1")
            if not secure:
                await error("https_required", 403)
                return
            if scope.get("query_string") or len(scope.get("path", "")) > 256:
                await error("invalid_request", 400)
                return
            if scope.get("path") != "/health" and origin not in self.origins:
                await error("origin_denied", 403)
                return
            self.store.rate(peer)
        except (ValueError, RelayError) as exc:
            await error(exc.code if isinstance(exc, RelayError) else "invalid_request", exc.status if isinstance(exc, RelayError) else 400)
            return
        if scope["method"] in ("POST", "PUT"):
            lengths = values(b"content-length")
            if len(lengths) != 1 or not re.fullmatch(r"[0-9]{1,6}", lengths[0]) or values(b"content-encoding") or values(b"transfer-encoding"):
                await error("invalid_request", 400)
                return
            if not 0 < int(lengths[0]) <= 4096:
                await error("body_too_large", 413)
                return
            if values(b"content-type") not in (["application/json"], ["application/json; charset=utf-8"]):
                await error("json_required", 415)
                return
            body = bytearray()
            try:
                while True:
                    message = await asyncio.wait_for(receive(), timeout=10)
                    if message["type"] == "http.disconnect":
                        return
                    body.extend(message.get("body", b""))
                    if len(body) > 4096:
                        await error("body_too_large", 413)
                        return
                    if not message.get("more_body"):
                        break
                if len(body) != int(lengths[0]):
                    raise ValueError("Invalid length")

                def unique(pairs):
                    result = {}
                    for key, value in pairs:
                        if key in result:
                            raise ValueError("Duplicate key")
                        result[key] = value
                    return result

                json.loads(body.decode("utf-8"), object_pairs_hook=unique, parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Non-finite number")))
            except (ValueError, UnicodeError, RecursionError, TimeoutError):
                await error("invalid_request", 400)
                return
            sent = False
            original_receive = receive

            async def replay():
                nonlocal sent
                if not sent:
                    sent = True
                    return {"type": "http.request", "body": bytes(body), "more_body": False}
                return await original_receive()

            receive = replay

        async def guarded_send(message):
            if message["type"] == "http.response.start":
                existing = list(message.get("headers", []))
                existing.extend((key.lower().encode(), value.encode()) for key, value in common.items())
                message = {**message, "headers": existing}
            await send(message)

        await self.app(scope, receive, guarded_send)


def create_app(owner_key=None, origins=None, hosts=None, allow_local=None, store=None):
    if allow_local is None:
        allow_local = os.environ.get("PUNTO_ALLOW_LOCAL_HTTP", "false").lower() == "true"
    owner_key, origins, hosts = configuration(owner_key, origins, hosts, allow_local)
    store = store or SessionStore(owner_key)
    @asynccontextmanager
    async def lifespan(app):
        async def expire_idle():
            while True:
                await asyncio.sleep(5)
                store.expire()
        cleaner = asyncio.create_task(expire_idle())
        try:
            yield
        finally:
            cleaner.cancel()
            with suppress(asyncio.CancelledError):
                await cleaner
            store.clear()

    api = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

    def token(request):
        values = request.headers.getlist("authorization")
        if len(values) != 1 or not re.fullmatch(r"Bearer [A-Za-z0-9_-]{43,128}", values[0]):
            raise RelayError("unauthorized", 401)
        return values[0][7:]

    @api.exception_handler(RelayError)
    async def relay_error(request, exc):
        return JSONResponse({"error": exc.code}, status_code=exc.status)

    @api.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse({"error": "invalid_request"}, status_code=422)

    @api.get("/health")
    def health():
        return {"ok": True}

    @api.post("/v1/sessions", status_code=201)
    def create(body: CreateSession, request: Request):
        return store.create(token(request), body.minutes)

    @api.get("/v1/invitations/{identifier}")
    def preview(identifier: str, request: Request):
        return store.preview(identifier, token(request))

    @api.post("/v1/invitations/{identifier}/accept")
    def accept(identifier: str, body: Consent, request: Request):
        return store.accept(identifier, token(request), body.consent)

    @api.put("/v1/sessions/{identifier}/position")
    def publish(identifier: str, body: Position, request: Request):
        return store.publish(identifier, token(request), body.model_dump())

    @api.get("/v1/sessions/{identifier}")
    def view(identifier: str, request: Request):
        return store.view(identifier, token(request))

    @api.delete("/v1/sessions/{identifier}")
    def revoke(identifier: str, request: Request):
        return store.revoke(identifier, token(request))

    cors = CORSMiddleware(api, allow_origins=origins, allow_credentials=False,
                          allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["Authorization", "Content-Type"], max_age=600)
    return SecurityBoundary(cors, store, origins, hosts, allow_local)
