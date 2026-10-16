"""Generate deterministic, maskable PNG app icons without image dependencies."""

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def icon(size):
    rows = bytearray()
    background = (8, 127, 115)
    for y in range(size):
        rows.append(0)
        for x in range(size):
            coverage = 0
            for dx, dy in ((.25, .25), (.75, .25), (.25, .75), (.75, .75)):
                px, py = (x + dx) / size, (y + dy) / size
                head = (px - .5) ** 2 + (py - .405) ** 2 <= .175 ** 2
                tail = .43 <= py <= .75 and abs(px - .5) <= (.75 - py) * .49
                hole = (px - .5) ** 2 + (py - .405) ** 2 < .065 ** 2
                coverage += (head or tail) and not hole
            rows.extend(round(channel + (255 - channel) * coverage / 4) for channel in background)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    for dimension in (180, 192, 512):
        (ROOT / "assets" / f"icon-{dimension}.png").write_bytes(icon(dimension))
