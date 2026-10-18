#!/usr/bin/env python3
"""Deterministic local Nominatim/OSRM-compatible provider for API contract tests."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
import json
import os


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        encoded = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/search":
            query = parse_qs(parsed.query).get("q", [""])[0]
            if "provider failure" in query.lower():
                return self._send(503, {"error": "test_provider_unavailable"})
            if "missing place" in query.lower():
                return self._send(200, [])
            if "bad coordinates" in query.lower():
                return self._send(200, [{"lat": "NaN", "lon": "77.35", "display_name": "Invalid"}])
            if "unreachable destination" in query.lower():
                latitude, longitude = "28.54", "77.37"
            elif any(word in query.lower() for word in ("destination", "dropoff", "drop-off")):
                latitude, longitude = "28.54", "77.36"
            else:
                latitude, longitude = "28.53", "77.35"
            return self._send(200, [{
                "lat": latitude, "lon": longitude,
                "display_name": "Mock " + query[:200],
            }])
        if parsed.path.startswith("/route/v1/driving/"):
            if "77.37" in self.path:
                return self._send(200, {"code": "NoRoute", "routes": []})
            return self._send(200, {
                "code": "Ok",
                "routes": [{"distance": 2500.2, "duration": 600.1}],
            })
        return self._send(404, {"error": "not_found"})

    def log_message(self, _format, *_args):
        return


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("MOCK_PROVIDER_PORT", "8090"))), Handler)
    server.serve_forever()
