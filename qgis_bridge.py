"""Narrow, local-only handoff of validated route snapshots to QGIS Desktop."""

import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

MAX_BYTES = 4 * 1024 * 1024
EXECUTABLE_NAMES = {"qgis-bin.exe", "qgis-ltr-bin.exe", "qgis.exe"}


class QgisError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def executable_path(value):
    path = Path(value)
    if not path.is_absolute() or path.name.lower() not in EXECUTABLE_NAMES or not path.is_file():
        raise ValueError("Choose an absolute path to an installed QGIS executable, not a script.")
    resolved = path.resolve()
    if resolved.name.lower() not in EXECUTABLE_NAMES:
        raise ValueError("The executable must resolve to a QGIS launcher.")
    return resolved


def find_qgis():
    if os.name != "nt":
        return None
    roots = [Path(value) for value in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")) if value]
    if os.environ.get("LOCALAPPDATA"):
        roots.append(Path(os.environ["LOCALAPPDATA"]) / "Programs")
    installs = [Path("C:/OSGeo4W"), Path("C:/OSGeo4W64")]
    for root in roots:
        installs.extend(sorted(root.glob("QGIS*"), reverse=True))
    for installation in installs:
        for name in ("qgis-ltr-bin.exe", "qgis-bin.exe", "qgis.exe"):
            candidate = installation / "bin" / name
            if candidate.is_file():
                return executable_path(candidate)
    return None


def canonical_snapshot(data):
    """Rebuild known fields only: no projects, data-source URLs, CRS or executable metadata."""
    if not isinstance(data, dict) or data.get("type") != "FeatureCollection":
        raise ValueError("Invalid collection")
    features = data.get("features")
    if not isinstance(features, list) or not 1 <= len(features) <= 10100:
        raise ValueError("Invalid features")
    points = pins = 0
    clean = []

    def numeric(value, bound):
        return type(value) in (int, float) and math.isfinite(value) and abs(value) <= bound

    def coordinate(value):
        if not isinstance(value, list) or len(value) != 2 or not numeric(value[0], 180) or not numeric(value[1], 90):
            raise ValueError("Invalid coordinates")
        return [value[0], value[1]]

    for feature in features:
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            raise ValueError("Invalid feature")
        geometry = feature.get("geometry")
        properties = feature.get("properties") or {}
        if not isinstance(geometry, dict) or not isinstance(properties, dict):
            raise ValueError("Invalid geometry")
        kind = geometry.get("type")
        source = properties.get("source")
        source = source if source in ("gps", "demo", "import", "manual") else "import"
        if kind == "Point" and properties.get("kind") == "waypoint":
            pins += 1
            name = properties.get("name", "Point")
            if pins > 100 or not isinstance(name, str) or len(name) > 80:
                raise ValueError("Invalid waypoint")
            name = re.sub(r"[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]", "", name).strip() or "Point"
            coords = coordinate(geometry.get("coordinates"))
            props = {"kind": "waypoint", "name": name, "source": source}
        elif kind in ("Point", "LineString"):
            values = [geometry.get("coordinates")] if kind == "Point" else geometry.get("coordinates")
            if not isinstance(values, list) or len(values) < (2 if kind == "LineString" else 1) or len(values) > 10000 - points:
                raise ValueError("Invalid route")
            points += len(values)
            coords = [coordinate(value) for value in values]
            props = {"kind": "route", "source": source}
            for key in ("timestamps", "accuracyMeters"):
                if key not in properties:
                    continue
                entries = properties[key]
                if not isinstance(entries, list) or len(entries) != len(values):
                    raise ValueError("Invalid metadata")
                for value in entries:
                    if value is None:
                        continue
                    if key == "accuracyMeters":
                        if not numeric(value, 20000000) or value < 0:
                            raise ValueError("Invalid accuracy")
                    else:
                        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z", value):
                            raise ValueError("Invalid time")
                        datetime.fromisoformat(value.replace("Z", "+00:00"))
                props[key] = list(entries)
            if kind == "Point":
                coords = coords[0]
        else:
            raise ValueError("Unsupported geometry")
        clean.append({"type": "Feature", "properties": props, "geometry": {"type": kind, "coordinates": coords}})
    return {"type": "FeatureCollection", "metadata": {"pointCount": points, "waypointCount": pins,
            "simulated": any(item["properties"]["source"] == "demo" for item in clean)}, "features": clean}


def snapshot_gpx(data):
    namespace = "http://www.topografix.com/GPX/1/1"
    ET.register_namespace("", namespace)
    tag = lambda name: f"{{{namespace}}}{name}"
    root = ET.Element(tag("gpx"), {"version": "1.1", "creator": "Punto"})
    name = "Punto - DEMO (simulated data)" if data["metadata"]["simulated"] else "Punto - local route"
    ET.SubElement(ET.SubElement(root, tag("metadata")), tag("name")).text = name
    track = None
    for feature in data["features"]:
        props, geometry = feature["properties"], feature["geometry"]
        if props["kind"] == "waypoint":
            lon, lat = geometry["coordinates"]
            point = ET.SubElement(root, tag("wpt"), {"lat": str(lat), "lon": str(lon)})
            ET.SubElement(point, tag("name")).text = props["name"]
            continue
        if track is None:
            track = ET.SubElement(root, tag("trk"))
            ET.SubElement(track, tag("name")).text = name
        segment = ET.SubElement(track, tag("trkseg"))
        coordinates = [geometry["coordinates"]] if geometry["type"] == "Point" else geometry["coordinates"]
        for index, (lon, lat) in enumerate(coordinates):
            point = ET.SubElement(segment, tag("trkpt"), {"lat": str(lat), "lon": str(lon)})
            timestamp = props.get("timestamps", [])[index] if "timestamps" in props else None
            if timestamp is not None:
                ET.SubElement(point, tag("time")).text = timestamp
    # GPX requires waypoint elements before track elements.
    root[:] = sorted(root, key=lambda child: 0 if child.tag == tag("metadata") else 1 if child.tag == tag("wpt") else 2)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


class QgisBridge:
    def __init__(self, executable=None, enabled=True, autodetect=True, launcher=None, now=None, temp_root=None):
        self.explicit = executable_path(executable) if executable is not None else None
        self.enabled = enabled
        self.autodetect = autodetect
        self.launcher = launcher or subprocess.Popen
        self.now = now or time.monotonic
        self.temp_root = temp_root
        self.lock = threading.Lock()
        self.active = {}
        self.last_open = -math.inf

    def _executable(self):
        if not self.enabled:
            return None
        if self.explicit is not None:
            return self.explicit if self.explicit.is_file() else None
        return find_qgis() if self.autodetect else None

    def status(self):
        available = self._executable() is not None
        return {"available": available, "reason": "ready" if available else "not_installed" if self.enabled else "disabled"}

    def open(self, data, format):
        if format not in ("geojson", "gpx"):
            raise QgisError("invalid_data")
        try:
            snapshot = canonical_snapshot(data)
        except (ValueError, TypeError, OverflowError, RecursionError):
            raise QgisError("invalid_data") from None
        with self.lock:
            executable = self._executable()
            if executable is None:
                raise QgisError("not_installed" if self.enabled else "disabled")
            if self.now() - self.last_open < 5:
                raise QgisError("rate_limit")
            if len(self.active) >= 3:
                raise QgisError("busy")
            self.last_open = self.now()
            folder = None
            try:
                folder = Path(tempfile.mkdtemp(prefix="punto-qgis-", dir=self.temp_root))
                folder.chmod(0o700)
                filename = folder / f"recorrido{'-DEMO' if snapshot['metadata']['simulated'] else ''}.{format}"
                body = snapshot_gpx(snapshot) if format == "gpx" else json.dumps(snapshot, ensure_ascii=False, allow_nan=False).encode("utf-8")
                if len(body) > MAX_BYTES:
                    raise QgisError("invalid_data")
                with filename.open("xb") as resource:
                    resource.write(body)
                filename.chmod(0o600)
                profile = folder / "settings"
                profile.mkdir(mode=0o700)
                environment = os.environ.copy()
                for key in ("PYQGIS_STARTUP", "PYTHONSTARTUP", "PYTHONPATH", "PYTHONHOME", "QGIS_CUSTOM_CONFIG_PATH"):
                    environment.pop(key, None)
                arguments = [str(executable), "--noplugins", "--noversioncheck", "--nocustomization",
                             "--profiles-path", str(profile), "--profile", "punto", "--", str(filename)]
                process = self.launcher(arguments, shell=False, cwd=str(executable.parent), env=environment,
                                        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                        close_fds=True, creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
                if process.poll() is not None:
                    raise QgisError("launch_failed")
                self.active[folder] = process
                threading.Thread(target=self._cleanup_after_exit, args=(process, folder), name="punto-qgis-cleanup", daemon=True).start()
            except Exception as error:
                if folder is not None:
                    self.active.pop(folder, None)
                    shutil.rmtree(folder, ignore_errors=True)
                if isinstance(error, QgisError):
                    raise
                raise QgisError("launch_failed") from None
        return {"opened": True, "format": format}

    def _cleanup_after_exit(self, process, folder):
        try:
            process.wait()
        finally:
            # Only the exact directory created for this process is removed.
            shutil.rmtree(folder, ignore_errors=True)
            with self.lock:
                self.active.pop(folder, None)
