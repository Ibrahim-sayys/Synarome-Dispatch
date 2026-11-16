"""Local Windows scanner bridge. Run only on the computer connected to the scanner."""
import argparse
import ipaddress
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

PORT = 17653
MAX_BODY = 16_384
LOCK = threading.Lock()
SCRIPT = Path(__file__).with_name('wia.ps1')


def run_wia(action, device_id=''):
    env = dict(os.environ, BILTY_SCANNER_DEVICE=device_id)
    result = subprocess.run(
        ['powershell.exe', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass',
         '-File', str(SCRIPT), action], capture_output=True, text=True, encoding='utf-8',
        errors='replace', timeout=180, env=env, check=False,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
    )
    if result.returncode:
        raise RuntimeError('Windows could not access the scanner. Check its connection and WIA driver.')
    return json.loads(result.stdout)


def make_handler(origin):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass  # Never log device IDs, or document data.

        def allowed(self):
            return (self.headers.get('Origin') == origin and
                    self.headers.get('Host') in (f'127.0.0.1:{PORT}', f'localhost:{PORT}'))

        def reply(self, status, value):
            payload = json.dumps(value).encode('utf-8')
            self.send_response(status)
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_OPTIONS(self):
            if not self.allowed():
                self.send_error(403)
                return
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()

        def do_POST(self):
            if not self.allowed():
                self.send_error(403)
                return
            if self.path not in ('/devices', '/scan'):
                self.reply(404, {'error': 'Unknown request.'})
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if length < 2 or length > MAX_BODY:
                    raise ValueError('Invalid request size.')
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError('Invalid request.')
                device_id = body.get('deviceId', '')
                if not isinstance(device_id, str) or len(device_id) > 4096:
                    raise ValueError('Invalid scanner.')
                if self.path == '/scan' and not device_id:
                    raise ValueError('Choose a scanner.')
                if not LOCK.acquire(blocking=False):
                    self.reply(409, {'error': 'The scanner is busy.'})
                    return
                try:
                    result = run_wia('devices' if self.path == '/devices' else 'scan', device_id)
                finally:
                    LOCK.release()
                self.reply(200, result)
            except (ValueError, TypeError, json.JSONDecodeError):
                self.reply(400, {'error': 'Invalid scanner request.'})
            except (RuntimeError, subprocess.TimeoutExpired, OSError):
                self.reply(503, {'error': 'Scanner unavailable or timed out. Check the scanner and its Windows driver.'})

    return Handler


def app_origin(url):
    """Return the browser origin for an HTTPS or local/private IPv4 HTTP URL."""
    try:
        if any(ord(char) <= 32 or ord(char) == 127 for char in url):
            return None
        parsed = urlsplit(url)
        port = parsed.port
        host = parsed.hostname
        if (parsed.scheme not in ('http', 'https') or not host
                or parsed.username is not None or parsed.password is not None
                or parsed.netloc.endswith(':')):
            return None
        if parsed.scheme == 'http' and host not in ('localhost', '127.0.0.1', '::1'):
            try:
                address = ipaddress.IPv4Address(host)
            except ipaddress.AddressValueError:
                return None
            networks = ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')
            if not any(address in ipaddress.IPv4Network(network) for network in networks):
                return None
        # Browser Origin headers exclude path, query and fragment, and default ports.
        hostname = f'[{host}]' if ':' in host else host.encode('idna').decode('ascii')
        default_port = 443 if parsed.scheme == 'https' else 80
        suffix = f':{port}' if port is not None and port != default_port else ''
        return f'{parsed.scheme}://{hostname}{suffix}'
    except (ValueError, UnicodeError):
        return None


def config_path():
    return Path(os.environ.get('APPDATA', str(Path.home()))) / 'SynaromeScanner' / 'config.json'


def load_origin(path):
    try:
        config = json.loads(path.read_text(encoding='utf-8'))
        return app_origin(config['origin']) if isinstance(config, dict) and isinstance(config.get('origin'), str) else None
    except (OSError, ValueError, KeyError):
        return None


def save_origin(path, origin):
    normalized = app_origin(origin)
    if not normalized:
        raise ValueError('Enter a valid HTTPS address or a supported local address.')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({'origin': normalized}, indent=2), encoding='utf-8')
    return normalized


def prompt_origin(current=''):
    import tkinter as tk
    from tkinter import messagebox, simpledialog
    root = tk.Tk()
    root.withdraw()
    try:
        while True:
            value = simpledialog.askstring('Synarome Scanner Setup',
                'Enter the website address you use to open Synarome Dispatch:',
                initialvalue=current, parent=root)
            if value is None:
                return None
            origin = app_origin(value.strip())
            if origin:
                return origin
            messagebox.showerror('Invalid address', 'Enter a valid HTTPS address or a supported local address.', parent=root)
    finally:
        root.destroy()


def main():
    parser = argparse.ArgumentParser(description='Synarome Windows scanner companion')
    parser.add_argument('--origin', help='Save the app URL or origin')
    parser.add_argument('--configure', action='store_true', help='Change the saved website address')
    args = parser.parse_args()
    if sys.platform != 'win32':
        parser.error('The scanner companion requires Windows and a WIA scanner driver.')
    path = config_path()
    origin = load_origin(path)
    if args.origin:
        try:
            origin = save_origin(path, args.origin)
        except (ValueError, OSError) as error:
            parser.error(str(error))
    elif args.configure or not origin:
        chosen = prompt_origin(origin or '')
        if chosen is None:
            return
        try:
            origin = save_origin(path, chosen)
        except OSError as error:
            parser.error(f'Could not save the website address: {error}')
    try:
        server = ThreadingHTTPServer(('127.0.0.1', PORT), make_handler(origin))
    except OSError as error:
        parser.error(f'Could not start the scanner companion. Is it already running? {error}')
    print('Synarome scanner companion is running. Leave this window open.', flush=True)
    print('Allowed website:', origin, flush=True)
    print('Close this window to stop the scanner companion.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
