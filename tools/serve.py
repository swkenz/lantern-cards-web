"""Serves Lantern Cards locally without caching, so edits show up on reload.

Usage: python tools/serve.py [port] [--lan]   then open http://localhost:5173
--lan also accepts phones on the same Wi-Fi (open http://<this PC's IP>:<port> on the phone).
"""
import http.server
import os
import sys
from functools import partial

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript", ".glb": "model/gltf-binary"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else 5173
    host = "0.0.0.0" if "--lan" in sys.argv else "127.0.0.1"
    server = http.server.ThreadingHTTPServer((host, port), partial(Handler, directory=ROOT))
    print(f"Lantern Cards: http://localhost:{port}" + ("  (also on the local network)" if host == "0.0.0.0" else ""), flush=True)
    server.serve_forever()
