import http.client
import json
import threading
import tempfile
from pathlib import Path
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from scanner_companion import make_handler, app_origin, load_origin, save_origin


class OriginValidationTest(unittest.TestCase):
    def test_normalizes_supported_urls_to_browser_origins(self):
        cases = {
            'https://bilty.example': 'https://bilty.example',
            'http://localhost:4200': 'http://localhost:4200',
            'http://127.0.0.1:1711/dispatch': 'http://127.0.0.1:1711',
            'http://[::1]:4200': 'http://[::1]:4200',
            'http://192.168.18.9:1711/dispatch': 'http://192.168.18.9:1711',
            'http://10.0.0.3:80/path?x=1': 'http://10.0.0.3',
            'http://172.31.2.1:1711': 'http://172.31.2.1:1711',
            'https://bilty.example:443/dispatch': 'https://bilty.example',
        }
        for url, expected in cases.items():
            with self.subTest(url=url):
                self.assertEqual(app_origin(url), expected)

    def test_local_origin_is_matched_exactly_by_bridge(self):
        origin = app_origin('http://192.168.18.9:1711/dispatch')
        handler_type = make_handler(origin)
        handler = handler_type.__new__(handler_type)
        handler.headers = {'Origin': 'http://192.168.18.9:1711', 'Host': '127.0.0.1:17653'}
        self.assertTrue(handler.allowed())
        handler.headers['Origin'] = 'http://192.168.18.9:1712'
        self.assertFalse(handler.allowed())
        handler.headers['Origin'] = 'http://192.168.18.10:1711'
        self.assertFalse(handler.allowed())

    def test_rejects_insecure_public_or_malformed_urls(self):
        for url in ('http://172.32.1.1:4200', 'http://localhost.evil.example',
                    'http://evil.example', 'http://8.8.8.8',
                    'http://user@localhost:4200', 'http://localhost:99999',
                    'http://localhost:abc', 'http://localhost:', 'file://localhost'):
            with self.subTest(url=url):
                self.assertIsNone(app_origin(url))


    def test_saved_origin_is_reused_and_invalid_settings_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'settings' / 'config.json'
            self.assertIsNone(load_origin(path))
            self.assertEqual(save_origin(path, 'https://bilty.example/dispatch'), 'https://bilty.example')
            self.assertEqual(load_origin(path), 'https://bilty.example')
            with self.assertRaises(ValueError):
                save_origin(path, 'http://public.example')
            self.assertEqual(load_origin(path), 'https://bilty.example')
            path.write_text('not json', encoding='utf-8')
            self.assertIsNone(load_origin(path))


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler('https://bilty.example'))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, path, origin='https://bilty.example', host='127.0.0.1:17653', body='{}'):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=2)
        connection.request('POST', path, body, {'Origin': origin, 'Host': host, 'Content-Type': 'application/json'})
        response = connection.getresponse()
        data = response.read()
        connection.close()
        return response.status, data

    @patch('scanner_companion.run_wia', return_value={'devices': [{'id': 'one', 'name': 'Office'}]})
    def test_trusted_origin_can_list_devices(self, run):
        status, data = self.request('/devices')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data)['devices'][0]['id'], 'one')
        run.assert_called_once_with('devices', '')

    @patch('scanner_companion.run_wia')
    def test_wrong_origin_or_host_cannot_access_scanner(self, run):
        for options in ({'origin': 'https://evil.example'}, {'host': 'evil.example:17653'}):
            self.assertEqual(self.request('/devices', **options)[0], 403)
        run.assert_not_called()

    @patch('scanner_companion.run_wia')
    def test_scan_requires_device_id(self, run):
        self.assertEqual(self.request('/scan')[0], 400)
        run.assert_not_called()

    @patch('scanner_companion.run_wia', return_value={'data': 'YWJj'})
    def test_scan_passes_the_selected_device(self, run):
        status, _ = self.request('/scan', body=json.dumps({'deviceId': 'scanner-1'}))
        self.assertEqual(status, 200)
        run.assert_called_once_with('scan', 'scanner-1')


if __name__ == '__main__':
    unittest.main()
