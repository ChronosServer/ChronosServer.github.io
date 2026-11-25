import http.client
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from tools import dev_server
from tools.dev_server import make_server

dev_server.Handler.log_message = lambda *a, **k: None


class Upstream(BaseHTTPRequestHandler):
    seen = []

    def log_message(self, *a):
        pass

    def do_GET(self):
        Upstream.seen.append((self.path, dict(self.headers)))
        if self.headers.get("If-None-Match") == 'W/"abc"':
            self.send_response(304)
            self.send_header("ETag", 'W/"abc"')
            self.end_headers()
            return
        if self.path.startswith("/api/stats/player/nobody"):
            body, status = b'{"error":"not_found"}', 404
        else:
            body, status = b'{"ok":1}', 200
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("ETag", 'W/"abc"')
        self.send_header("Cache-Control", "public, max-age=60")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def serve(server):
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return t


class DevServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.up = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
        serve(cls.up)
        cls.tmp = tempfile.TemporaryDirectory()
        with open(os.path.join(cls.tmp.name, "index.html"), "w") as f:
            f.write("hi")
        cls.origin = "http://127.0.0.1:%d" % cls.up.server_address[1]
        cls.srv = make_server(0, cls.tmp.name, cls.origin)
        serve(cls.srv)
        cls.port = cls.srv.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        cls.up.shutdown()
        cls.up.server_close()
        cls.tmp.cleanup()

    def get(self, path, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port)
        c.request("GET", path, headers=headers or {})
        r = c.getresponse()
        body = r.read()
        c.close()
        return r, body

    def setUp(self):
        Upstream.seen.clear()

    def test_static_served(self):
        r, body = self.get("/")
        self.assertEqual(r.status, 200)
        self.assertEqual(body, b"hi")

    def test_proxy_passes_path_query_and_headers(self):
        r, body = self.get("/api/stats/meta?x=1")
        self.assertEqual(r.status, 200)
        self.assertEqual(body, b'{"ok":1}')
        self.assertEqual(r.getheader("ETag"), 'W/"abc"')
        self.assertEqual(r.getheader("Cache-Control"), "public, max-age=60")
        self.assertEqual(r.getheader("Content-Type"), "application/json")
        path, headers = Upstream.seen[-1]
        self.assertEqual(path, "/api/stats/meta?x=1")
        self.assertIn("Mozilla/5.0", headers["User-Agent"])
        self.assertEqual(headers["Host"], urlsplit(self.origin).netloc)

    def test_proxy_304(self):
        r, _ = self.get("/api/stats/meta", {"If-None-Match": 'W/"abc"'})
        self.assertEqual(r.status, 304)

    def test_upstream_error_status_passed(self):
        r, body = self.get("/api/stats/player/nobody")
        self.assertEqual(r.status, 404)
        self.assertEqual(body, b'{"error":"not_found"}')

    def test_non_stats_api_not_proxied(self):
        r, _ = self.get("/api/status")
        self.assertEqual(r.status, 404)
        self.assertEqual(Upstream.seen, [])


if __name__ == "__main__":
    unittest.main()
