#!/usr/bin/env python3
"""Serves option B's two origins for measure.mjs. Standard library only.

The host origin (default port 8101) stands in for the cloud: it sets a
session cookie on path "/" as @supabase/ssr sets the cloud's (SameSite=Lax,
not HttpOnly), plus a SameSite=None one to show what that attribute would
change, and answers /whoami with whatever cookie it was sent, so a program
that can read the answer learns the session. It serves the host page and
the packs (for the in-page baseline) twice: under /coi/ with COOP and COEP,
cross-origin isolated, and under /plain/ without.

The packs origin (default port 8102) serves run-frame.html, frame.js and
the packs, with what an embedded, isolated frame needs: COEP require-corp on
everything, CORP cross-origin on the frame page, and a CSP frame-ancestors
naming the hosts allowed to embed it. It never sets a cookie. Under a
first path segment omit-A+B it serves the same without some of those
headers, for the measurement of which are required.

Both answer on every interface's name the browser uses for them: the
measurements reach them as 127.0.0.1 and localhost (two sites) and as
app.yukibana.localhost and packs.yukibana.localhost (one site, two origins).

    python3 serve.py --packs ../../../app/static/packs [--host-port 8101] [--packs-port 8102]
"""

import argparse
import http.server
import json
import os
import threading
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
         ".json": "application/json", ".wasm": "application/wasm", ".txt": "text/plain"}
# The host's own files; everything else of this folder stays unserved.
HOST_FILES = {"host.html", "in-page.js", "framed.js", "stdin.js"}
FRAME_FILES = {"frame.js", "stdin.js"}
ISOLATION = {"Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp"}
COOKIES = [
    # What @supabase/ssr sets by default (path forced to "/" by session.ts).
    "sb-access-token=teacher-session-secret; Path=/; SameSite=Lax",
    "probe-none=none-cookie-secret; Path=/; SameSite=None; Secure",
]

log_lock = threading.Lock()
whoami_log = []


def file_response(handler, path, headers):
    try:
        with open(path, "rb") as f:
            body = f.read()
    except OSError:
        handler.send_error(404)
        return
    handler.send_response(200)
    handler.send_header("Content-Type", TYPES.get(os.path.splitext(path)[1], "application/octet-stream"))
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    for k, v in headers.items():
        handler.send_header(k, v)
    handler.end_headers()
    if handler.command != "HEAD":
        handler.wfile.write(body)


def under(root, rest):
    """The file `rest` names under `root`, or None for one outside it."""
    path = os.path.normpath(os.path.join(root, rest))
    return path if path.startswith(os.path.abspath(root) + os.sep) and os.path.isfile(path) else None


class Quiet(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    # Headers and body go out as two writes; on a kept-alive connection Nagle
    # and delayed ACK then hold the body for 40 ms, which measured as a 40 ms
    # slower run start on most runs, framed or not.
    disable_nagle_algorithm = True

    def log_message(self, *args):
        pass


def host_handler(packs):
    class Host(Quiet):
        def do_GET(self):
            url = urllib.parse.urlsplit(self.path)
            path = urllib.parse.unquote(url.path)
            if path == "/whoami":
                return self.whoami()
            if path == "/__log":
                with log_lock:
                    body = json.dumps(whoami_log).encode()
                    if "clear" in url.query:
                        whoami_log.clear()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            mode, _, rest = path.lstrip("/").partition("/")
            if mode not in ("coi", "plain"):
                return self.send_error(404)
            headers = dict(ISOLATION) if mode == "coi" else {}
            if rest.startswith("packs/"):
                found = under(packs, rest[len("packs/"):])
                return file_response(self, found, headers) if found else self.send_error(404)
            if rest not in HOST_FILES:
                return self.send_error(404)
            if rest == "host.html":
                return self.host_page(os.path.join(HERE, rest), headers)
            file_response(self, os.path.join(HERE, rest), headers)

        do_HEAD = do_GET

        def do_POST(self):
            if urllib.parse.urlsplit(self.path).path == "/whoami":
                return self.whoami()
            self.send_error(404)

        def host_page(self, path, headers):
            with open(path, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for cookie in COOKIES:
                self.send_header("Set-Cookie", cookie)
            for k, v in headers.items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def whoami(self):
            """Records who asked and with what, and answers with the cookie it got, without CORS headers."""
            length = int(self.headers.get("Content-Length") or 0)
            if length:
                self.rfile.read(length)
            cookie = self.headers.get("Cookie", "")
            entry = {
                "method": self.command,
                "probe": urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("probe", [""])[0],
                "cookie": cookie,
                "origin": self.headers.get("Origin"),
                "site": self.headers.get("Sec-Fetch-Site"),
                "mode": self.headers.get("Sec-Fetch-Mode"),
            }
            with log_lock:
                whoami_log.append(entry)
            body = f"you are: {cookie or 'nobody'}".encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            # Readable by a page on another origin only if it were here; it is not.
            self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
            self.end_headers()
            self.wfile.write(body)

    return Host


def packs_handler(packs, hosts):
    def frame_headers(omit):
        headers = {
            "Cross-Origin-Embedder-Policy": "require-corp",
            "Cross-Origin-Resource-Policy": "cross-origin",
            "Content-Security-Policy": "frame-ancestors " + " ".join(hosts),
        }
        if "frame-coep" in omit:
            del headers["Cross-Origin-Embedder-Policy"]
        if "frame-corp" in omit:
            del headers["Cross-Origin-Resource-Policy"]
        return headers

    def file_headers(omit):
        return {} if "files-coep" in omit else {"Cross-Origin-Embedder-Policy": "require-corp"}

    class Packs(Quiet):
        def do_GET(self):
            path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path).lstrip("/")
            # A first segment omit-A+B serves the same files without some of
            # the headers, so measure.mjs can show which ones are required:
            # frame-coep, frame-corp (on run-frame.html), files-coep (on the
            # frame's scripts and the packs).
            omit = set()
            if path.startswith("omit-"):
                first, _, path = path.partition("/")
                omit = set(first[len("omit-"):].split("+"))
            if path == "run-frame.html":
                with open(os.path.join(HERE, path), encoding="utf-8") as f:
                    body = f.read().replace("__HOSTS__", json.dumps(hosts)).encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                for k, v in frame_headers(omit).items():
                    self.send_header(k, v)
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(body)
                return
            if path in FRAME_FILES:
                return file_response(self, os.path.join(HERE, path), file_headers(omit))
            if path.startswith("packs/"):
                found = under(packs, path[len("packs/"):])
                return file_response(self, found, file_headers(omit)) if found else self.send_error(404)
            self.send_error(404)

        do_HEAD = do_GET

    return Packs


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--packs", default=os.path.join(HERE, "..", "..", "..", "app", "static", "packs"))
    parser.add_argument("--host-port", type=int, default=8101)
    parser.add_argument("--packs-port", type=int, default=8102)
    parser.add_argument("--hosts", default="http://127.0.0.1:8101,http://app.yukibana.localhost:8101",
                        help="host origins allowed to embed the frame, comma-separated")
    args = parser.parse_args()
    packs = os.path.abspath(args.packs)
    if not os.path.isfile(os.path.join(packs, "javascript", "runner.js")):
        parser.error(f"no javascript/runner.js under {packs}: build the javascript pack, or pass --packs")
    hosts = [h for h in args.hosts.split(",") if h]
    servers = [
        http.server.ThreadingHTTPServer(("127.0.0.1", args.host_port), host_handler(packs)),
        http.server.ThreadingHTTPServer(("127.0.0.1", args.packs_port), packs_handler(packs, hosts)),
    ]
    for server in servers[1:]:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"host http://127.0.0.1:{args.host_port}/coi/host.html  packs http://localhost:{args.packs_port}/run-frame.html", flush=True)
    servers[0].serve_forever()


if __name__ == "__main__":
    main()
