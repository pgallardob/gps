"""Check the public relay without credentials, location data, or redirects."""

import http.client
import json
import os
import time
from urllib.parse import urlsplit


RELAY_HOST = "gps-lj9l.onrender.com"
MAX_RESPONSE_BYTES = 4096


class HealthCheckError(Exception):
    pass


def health_url(value):
    """Only the configured project's public HTTPS origin is a valid CI target."""
    try:
        if not isinstance(value, str) or not value.isascii() or any(char.isspace() for char in value):
            raise ValueError
        parsed = urlsplit(value)
        if (parsed.scheme != "https" or parsed.hostname != RELAY_HOST
                or parsed.port not in (None, 443) or parsed.username is not None or parsed.password is not None
                or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
            raise ValueError
    except ValueError:
        raise HealthCheckError("Set PUNTO_SHARING_API_URL to the project's public HTTPS origin.") from None
    return f"https://{RELAY_HOST}/health"


def probe(url, timeout=90):
    """The entry point validates the target; loopback fixtures reuse this HTTP path."""
    parsed = urlsplit(url)
    connection_type = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    connection = connection_type(parsed.hostname, parsed.port, timeout=timeout)
    try:
        connection.request("GET", parsed.path, headers={
            "Accept": "application/json", "Cache-Control": "no-cache", "User-Agent": "PuntoHealthCheck/1.0"
        })
        response = connection.getresponse()
        # http.client does not follow redirects or keep a cookie jar.
        if response.status != 200:
            raise HealthCheckError(f"Health endpoint returned HTTP {response.status}.")
        content_type = (response.getheader("Content-Type") or "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            raise HealthCheckError("Health endpoint did not return JSON.")
        body = response.read(MAX_RESPONSE_BYTES + 1)
        if len(body) > MAX_RESPONSE_BYTES:
            raise HealthCheckError("Health response exceeded the size limit.")
        try:
            data = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeError):
            raise HealthCheckError("Health response contained invalid JSON.") from None
        if not isinstance(data, dict) or set(data) != {"ok"} or data["ok"] is not True:
            raise HealthCheckError("Health response did not confirm readiness.")
    except (OSError, http.client.HTTPException):
        raise HealthCheckError("Health connection failed or timed out.") from None
    finally:
        connection.close()


def check_health(url, attempts=2, timeout=90, retry_delay=5, report=print):
    for attempt in range(1, attempts + 1):
        try:
            probe(url, timeout)
            report("Relay health check passed.")
            return True
        except HealthCheckError as error:
            report(f"Attempt {attempt}/{attempts} failed: {error}")
            if attempt < attempts:
                time.sleep(retry_delay)
    report("Relay health check failed.")
    return False


def main():
    try:
        url = health_url(os.environ.get("PUNTO_SHARING_API_URL", ""))
    except HealthCheckError as error:
        print(error)
        return 2
    return 0 if check_health(url) else 1


if __name__ == "__main__":
    raise SystemExit(main())
