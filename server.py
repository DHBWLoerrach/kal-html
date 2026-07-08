#!/usr/bin/env python3
"""Lokaler Server für den DHBW-Kurskalender.

Liefert die statischen Dateien aus und proxyt /ics/<kurs> zum DHBW-Server,
weil dieser keine CORS-Header sendet. Start: python3 server.py [port]
"""
from __future__ import annotations

import http.server
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from functools import partial
from pathlib import Path

UPSTREAM = "https://webmail.dhbw-loerrach.de/owa/calendar/kal-{kurs}@dhbw-loerrach.de/Kalender/calendar.ics"
KURS_RE = re.compile(r"^[a-z]{3,6}\d{2}[a-z]?(?:-[a-z]{1,20})?$")
# Sekunden; muss zum FEED_TTL des Clients (app.js) passen, sonst bestimmt
# dieser Wert die effektive Aktualität. Schont trotzdem den DHBW-Server.
CACHE_TTL = 600
MAX_ICS_BYTES = 5 * 1024 * 1024  # 5 MB (verhindert zu große Kalenderdateien)
FETCH_LOCKS = [threading.Lock() for _ in range(64)]

_cache: dict[str, tuple[float, bytes]] = {}

# Lock-Striping über feste Buckets: derselbe Kurs landet immer auf demselben
# Lock, damit gleichzeitige Anfragen auf einen laufenden Upstream-Fetch warten.
# Unterschiedliche Kurse können sich dabei ein Lock teilen.
def _fetch_lock_for(kurs: str) -> threading.Lock:
    return FETCH_LOCKS[hash(kurs) % len(FETCH_LOCKS)]

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Statische Dateien bei jedem Abruf revalidieren lassen (If-Modified-Since
        # → 304), sonst zeigt der Browser nach Updates veraltetes JS/CSS.
        if not self.path.startswith("/ics/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/ics/"):
            self._serve_ics(self.path[len("/ics/"):].split("?", 1)[0])
        else:
            super().do_GET()

    def _serve_ics(self, raw: str) -> None:
        kurs = raw.lower().removesuffix(".ics")
        if not KURS_RE.match(kurs):
            return self._text(400, f"Ungültiges Kurskürzel: {raw!r}")

        cached = _cache.get(kurs)
        if cached and time.time() - cached[0] < CACHE_TTL:
            return self._ics(cached[1])

        lock = _fetch_lock_for(kurs)
        with lock:
            # Zwischen dem Check oben und dem Erhalt des Locks kann ein
            # anderer Thread den Kurs bereits gefetcht haben.
            cached = _cache.get(kurs)
            if cached and time.time() - cached[0] < CACHE_TTL:
                body = cached[1]
            else:
                body = self._fetch_ics(kurs)
                if body is None:
                    return
                _cache[kurs] = (time.time(), body)

        self._ics(body)

    def _fetch_ics(self, kurs: str) -> bytes | None:
        url = UPSTREAM.format(kurs=kurs)
        try:
            with urllib.request.urlopen(url, timeout=20) as resp:
                ctype = resp.headers.get("Content-Type", "").lower()
                # Der Server liefert für manche Fehlpfade HTML mit Status 200 —
                # nur text/calendar gilt als Treffer.
                if "text/calendar" not in ctype:
                    self._text(404, f"Kein Kalender für '{kurs}' gefunden")
                    return None

                body = resp.read(MAX_ICS_BYTES + 1)
                if len(body) > MAX_ICS_BYTES:
                    self._text(502, "Kalenderdatei ist zu groß")
                    return None
                return body
        except urllib.error.HTTPError as e:
            status = 404 if e.code == 404 else 502
            self._text(status, f"Kein Kalender für '{kurs}' (Upstream-Status {e.code})")
            return None
        except OSError as e:
            self._text(502, f"DHBW-Server nicht erreichbar: {e}")
            return None

    def _ics(self, body: bytes) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/calendar; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _text(self, status: int, message: str) -> None:
        body = message.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    try:
        port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    except ValueError:
        print("Port muss eine Zahl sein", file=sys.stderr)
        sys.exit(2)
    static_dir = Path(__file__).parent / "public"
    if not static_dir.is_dir():
        print(f"Statisches Verzeichnis fehlt: {static_dir}", file=sys.stderr)
        sys.exit(2)
    handler = partial(Handler, directory=str(static_dir))
    host = os.environ.get("HOST", "127.0.0.1")
    with http.server.ThreadingHTTPServer((host, port), handler) as httpd:
        print(f"Vorlesungsplan läuft auf http://{host}:{port}/")
        httpd.serve_forever()

if __name__ == "__main__":        
    main()
