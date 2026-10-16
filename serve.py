"""Serve only public GPS assets on a bounded, hardened localhost server."""

import argparse
import hmac
import importlib.util
import json
import re
import secrets
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


# Load our one private helper explicitly; keep Python isolated mode and avoid cwd imports.
_bridge_spec = importlib.util.spec_from_file_location("punto_qgis_bridge", Path(__file__).resolve().parent / "qgis_bridge.py")
_bridge_module = importlib.util.module_from_spec(_bridge_spec)
_bridge_spec.loader.exec_module(_bridge_module)


PUBLIC_FILES = {"/": ("index.html", "text/html; charset=utf-8")}
for filename in json.loads((Path(__file__).resolve().parent / "public-files.json").read_text(encoding="utf-8")):
    extension = filename.rsplit(".", 1)[-1]
    content_type = "text/plain" if filename.endswith("/LICENSE") else {"html": "text/html", "css": "text/css", "js": "application/javascript", "svg": "image/svg+xml", "png": "image/png", "webmanifest": "application/manifest+json"}[extension]
    PUBLIC_FILES["/" + filename] = (filename, content_type + ("" if extension == "png" else "; charset=utf-8"))


def safe_origin(value):
    """CSP sources must be explicit HTTP(S) origins, never wildcards or directives."""
    try:
        parsed = urlsplit(value)
        port = parsed.port
        if (not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment
                or parsed.path not in ("", "/") or any(char in value for char in " ;'\"\\\r\n\t*%<>")
                or not value.isascii()
                or parsed.scheme not in ("http", "https") or (port is not None and not 1 <= port <= 65535)
                or (parsed.scheme == "http" and parsed.hostname not in ("127.0.0.1", "localhost", "::1"))):
            raise ValueError
    except ValueError as error:
        raise argparse.ArgumentTypeError("Use an explicit HTTPS origin (HTTP is allowed only for loopback).") from error
    return f"{parsed.scheme}://{parsed.netloc}"


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, address, root, connect_origins=(), tile_origins=(), qgis_bridge=None, site_prefix="/"):
        self.root = Path(root).resolve()
        self.connect_origins = tuple(connect_origins)
        if not re.fullmatch(r"/(?:[A-Za-z0-9_-]+/)*", site_prefix):
            raise ValueError("The public site prefix must be a simple directory path ending in /.")
        self.site_prefix = site_prefix
        self.slots = threading.BoundedSemaphore(16)
        self.qgis = qgis_bridge if qgis_bridge is not None else _bridge_module.QgisBridge()
        self.qgis_token = secrets.token_urlsafe(32)
        self.csp = "; ".join([
            "default-src 'none'", "script-src 'self'", "script-src-attr 'none'",
            "style-src 'self'", "style-src-attr 'unsafe-inline'",
            "img-src 'self' data: https://tile.openstreetmap.org " + " ".join(tile_origins),
            "connect-src 'self' " + " ".join(connect_origins), "font-src 'self'", "manifest-src 'self'", "worker-src 'self'",
            "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'none'"
        ])
        super().__init__(address, PublicHandler)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


class PublicHandler(BaseHTTPRequestHandler):
    server_version = "Punto"
    sys_version = ""

    def setup(self):
        self.request.settimeout(5)
        super().setup()

    def handle(self):
        try:
            super().handle()
        except (ConnectionError, TimeoutError):
            # Reloading/closing a browser can cancel an otherwise valid response.
            pass

    def end_headers(self):
        for name, value in {
            "Content-Security-Policy": self.server.csp,
            "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
            "Referrer-Policy": "strict-origin-when-cross-origin",
            "Cross-Origin-Resource-Policy": "same-origin", "Cross-Origin-Opener-Policy": "same-origin",
            "Permissions-Policy": "geolocation=(self), camera=(), microphone=(), payment=(), usb=()",
            "Cache-Control": "no-store"
        }.items():
            self.send_header(name, value)
        super().end_headers()

    def send_error(self, code, message=None, explain=None):
        body = b"Request rejected.\n"
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if code == 405:
            self.send_header("Allow", "GET, HEAD")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def allowed_request(self):
        port = self.server.server_port
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if port == 80:
            hosts.update(("127.0.0.1", "localhost"))
        supplied = self.headers.get_all("Host", [])
        if len(supplied) != 1 or supplied[0].lower() not in hosts:
            self.send_error(421)
            return False
        origins = self.headers.get_all("Origin", [])
        if len(origins) > 1 or (origins and origins[0] not in {"http://" + host for host in hosts}):
            self.send_error(403)
            return False
        if self.headers.get("Sec-Fetch-Site") == "cross-site" and not (
                self.headers.get("Sec-Fetch-Mode") == "navigate" and self.headers.get("Sec-Fetch-Dest") == "document"):
            self.send_error(403)
            return False
        return True

    def do_GET(self):
        if not self.allowed_request():
            return
        if self.path == "/api/qgis/status":
            self.send_json(200, {**self.server.qgis.status(), "token": self.server.qgis_token})
            return
        try:
            parsed = urlsplit(self.path)
            path = unquote(parsed.path, errors="strict")
            if parsed.scheme or parsed.netloc or any(char in path for char in "\\%\x00\r\n"):
                self.send_error(400)
                return
            if not path.startswith(self.server.site_prefix):
                self.send_error(404)
                return
            path = "/" + path[len(self.server.site_prefix):]
            entry = PUBLIC_FILES.get(path)
            if entry is None:
                self.send_error(404)
                return
            target = self.server.root / entry[0]
            if target.resolve() != target or not target.is_file():
                self.send_error(404)
                return
            with target.open("rb") as resource:
                body = resource.read(2 * 1024 * 1024 + 1)
            if entry[1].startswith("text/html") and self.server.connect_origins:
                body = body.decode("utf-8").replace("connect-src 'self'", "connect-src 'self' " + " ".join(self.server.connect_origins)).encode("utf-8")
            if len(body) > 2 * 1024 * 1024:
                self.send_error(413)
                return
        except (OSError, ValueError):
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", entry[1])
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    do_HEAD = do_GET

    def send_json(self, status, data):
        body = json.dumps(data, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_POST(self):
        if not self.allowed_request():
            return
        if self.path != "/api/qgis/open":
            self.send_error(405)
            return
        origin = "http://" + self.headers["Host"].lower()
        tokens = self.headers.get_all("X-Punto-Token", [])
        if (self.headers.get_all("Origin", []) != [origin]
                or self.headers.get("Sec-Fetch-Site") not in (None, "same-origin")
                or len(tokens) != 1 or not tokens[0].isascii()
                or not hmac.compare_digest(tokens[0], self.server.qgis_token)):
            self.send_json(403, {"error": "forbidden"})
            return
        lengths = self.headers.get_all("Content-Length", [])
        if (self.headers.get_all("Transfer-Encoding", []) or self.headers.get("Content-Encoding")
                or len(lengths) != 1 or not re.fullmatch(r"[0-9]{1,10}", lengths[0])):
            self.send_json(400, {"error": "invalid_request"})
            return
        length = int(lengths[0])
        if not 0 < length <= _bridge_module.MAX_BYTES:
            self.send_json(413, {"error": "too_large"})
            return
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
            self.send_json(415, {"error": "invalid_request"})
            return

        def strict_object(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("Duplicate key")
                result[key] = value
            return result

        try:
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValueError("Incomplete request")
            payload = json.loads(body.decode("utf-8"), object_pairs_hook=strict_object)
            if not isinstance(payload, dict) or set(payload) != {"format", "data"}:
                raise ValueError("Invalid envelope")
            result = self.server.qgis.open(payload["data"], payload["format"])
        except (ValueError, TypeError, RecursionError, UnicodeError):
            self.send_json(400, {"error": "invalid_data"})
            return
        except OSError:
            self.send_json(408, {"error": "timeout"})
            return
        except _bridge_module.QgisError as error:
            status = 400 if error.code == "invalid_data" else 429 if error.code in ("rate_limit", "busy") else 503
            self.send_json(status, {"error": error.code})
            return
        self.send_json(202, result)

    def reject_method(self):
        self.send_error(405)

    do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_TRACE = do_CONNECT = reject_method

    def log_message(self, format, *args):
        # Never log coordinates, query strings, untrusted filenames, or headers.
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--connect-origin", action="append", type=safe_origin, default=[])
    parser.add_argument("--tile-origin", action="append", type=safe_origin, default=[])
    parser.add_argument("--qgis-path", help="Absolute path to an installed QGIS .exe launcher.")
    parser.add_argument("--disable-qgis", action="store_true", help="Disable all native QGIS opening.")
    parser.add_argument("--site-dir", type=Path, help="Serve an explicitly selected built public site directory on loopback.")
    parser.add_argument("--site-prefix", default="/", help="Optional subdirectory prefix for local GitHub Pages previews.")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("Port must be between 0 and 65535.")
    try:
        bridge = _bridge_module.QgisBridge(executable=args.qgis_path, enabled=not args.disable_qgis)
        server = LocalServer(("127.0.0.1", args.port), args.site_dir or Path(__file__).resolve().parent, args.connect_origin, args.tile_origin, bridge, args.site_prefix)
    except ValueError as error:
        parser.error(str(error))
    except OSError as error:
        print(f"Could not start the server: {error}")
        print("Choose another port: python serve.py --port 8081")
        return 1
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"Punto is running at {url}. Press Ctrl+C to stop.", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
