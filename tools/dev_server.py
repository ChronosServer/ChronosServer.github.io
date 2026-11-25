"""Local dev server: serves _site/ and forwards /api/stats/* to the live API."""
import argparse
import functools
import os
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

DEFAULT_ORIGIN = "https://www.chronosmc.com"
PREFIX = "/api/stats/"
# Cloudflare rejects Python's default User-Agent.
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")
COPY_BACK = ("Content-Type", "ETag", "Cache-Control")


class Handler(SimpleHTTPRequestHandler):
    origin = DEFAULT_ORIGIN

    def do_GET(self):
        if self.path.startswith(PREFIX):
            self.proxy()
        else:
            super().do_GET()

    def do_HEAD(self):
        if self.path.startswith(PREFIX):
            self.send_error(405)
        else:
            super().do_HEAD()

    def proxy(self):
        req = urllib.request.Request(self.origin + self.path, method="GET")
        req.add_header("User-Agent", UA)
        req.add_header("Host", urlsplit(self.origin).netloc)
        req.add_header("Accept", self.headers.get("Accept", "*/*"))
        inm = self.headers.get("If-None-Match")
        if inm:
            req.add_header("If-None-Match", inm)
        try:
            resp = urllib.request.urlopen(req, timeout=30)
        except urllib.error.HTTPError as e:
            resp = e
        except (urllib.error.URLError, OSError) as e:
            self.send_error(502, "Upstream unreachable: %s" % e)
            return
        status = resp.status if hasattr(resp, "status") else resp.code
        try:
            body = b"" if status == 304 else resp.read()
        finally:
            resp.close()
        self.send_response(status)
        for name in COPY_BACK:
            value = resp.headers.get(name)
            if value:
                self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def make_server(port, site_dir, origin):
    handler = type("BoundHandler", (Handler,), {"origin": origin.rstrip("/")})
    handler = functools.partial(handler, directory=site_dir)
    return ThreadingHTTPServer(("127.0.0.1", port), handler)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=4000)
    args = ap.parse_args()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    origin = os.environ.get("STATS_API_ORIGIN", DEFAULT_ORIGIN)
    srv = make_server(args.port, os.path.join(root, "_site"), origin)
    print("Chronos dev server: http://localhost:%d  (API -> %s)" % (args.port, origin), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
