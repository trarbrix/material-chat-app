#!/usr/bin/env python3
"""Launch the bundled HTML in an isolated Chromium app window."""
import http.server
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
from urllib.parse import urlsplit

HOST = '127.0.0.1'
PORT = 45381  # Stable origin keeps browser-local settings across launches.
BROWSERS = ('chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome',
            'brave-browser', 'brave', 'microsoft-edge-stable', 'microsoft-edge')


def report_error(message):
    print('Material Chat: ' + message, file=sys.stderr)
    if shutil.which('zenity'):
        subprocess.run(['zenity', '--error', '--title=Material Chat', '--text', message], check=False)


def make_handler(html):
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            # This server serves one static file only; never accept DNS-rebinding hosts.
            if self.headers.get('Host') != f'{HOST}:{PORT}' or urlsplit(self.path).path not in ('/', '/index.html'):
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(html)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(html)

        def log_message(self, format, *args):
            pass
    return Handler


def main():
    browser = next((name for name in BROWSERS if shutil.which(name)), None)
    if not browser:
        report_error('Install Chromium, Google Chrome or Brave to run Material Chat.')
        return 1
    try:
        html = (Path(__file__).resolve().parent / 'variant-b.html').read_bytes()
        server = http.server.ThreadingHTTPServer((HOST, PORT), make_handler(html))
    except OSError as exc:
        report_error('Could not start the local app. Is Material Chat already running?\n' + str(exc))
        return 1
    data_home = Path(os.environ.get('XDG_DATA_HOME') or Path.home() / '.local' / 'share')
    profile = data_home / 'material-chat' / browser
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        profile.mkdir(parents=True, exist_ok=True)
        args = [browser, '--no-first-run', '--no-default-browser-check', '--disable-background-mode',
                '--class=MaterialChat', '--user-data-dir=' + str(profile),
                f'--app=http://{HOST}:{PORT}/index.html']
        return subprocess.call(args)
    except OSError as exc:
        report_error('Could not launch the browser.\n' + str(exc))
        return 1
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    sys.exit(main())
