import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

path = Path(__file__).resolve().parents[1] / 'launcher.py'
spec = importlib.util.spec_from_file_location('launcher', path)
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

class LauncherTests(unittest.TestCase):
    def test_local_app_server_and_browser_arguments(self):
        def browser_call(args):
            self.assertIn('--disable-background-mode', args)
            self.assertNotIn('--no-sandbox', args)
            url = args[-1][len('--app='):]
            with urlopen(url, timeout=3) as response:
                self.assertEqual(response.read(), html)
                self.assertEqual(response.headers['Content-Type'], 'text/html; charset=utf-8')
            for request in (Request(url, headers={'Host': 'attacker.example'}), Request(url + '/../../etc/passwd')):
                with self.assertRaises(HTTPError) as error:
                    urlopen(request, timeout=3)
                self.assertEqual(error.exception.code, 404)
            return 0
        html = b'hello from local app'
        with tempfile.TemporaryDirectory() as tmp:
            temp = Path(tmp)
            (temp / 'variant-b.html').write_bytes(html)
            # The launcher resolves the HTML next to its own source.
            with patch.object(launcher, '__file__', str(temp / 'launcher.py')), \
                 patch.object(launcher.shutil, 'which', side_effect=lambda x: '/bin/chromium' if x == 'chromium' else None), \
                 patch.object(launcher.subprocess, 'call', side_effect=browser_call), \
                 patch.dict(os.environ, {'XDG_DATA_HOME': tmp}):
                self.assertEqual(launcher.main(), 0)
                self.assertTrue((temp / 'material-chat' / 'chromium').is_dir())

    def test_browser_missing_reports_error(self):
        with patch.object(launcher.shutil, 'which', return_value=None), patch.object(launcher, 'report_error') as error:
            self.assertEqual(launcher.main(), 1)
            error.assert_called_once()

if __name__ == '__main__':
    unittest.main()
