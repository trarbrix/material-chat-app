"""Integration tests for the standalone copy-and-paste server file."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

SERVER = Path(__file__).resolve().parents[1] / 'server' / 'main_ready.py'


class ReadyServerTests(unittest.TestCase):
    def setUp(self):
        self.old_cwd = os.getcwd()
        self.temp = tempfile.TemporaryDirectory()
        os.chdir(self.temp.name)
        spec = importlib.util.spec_from_file_location('ready_server', SERVER)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.client = TestClient(self.module.app)

    def tearDown(self):
        self.client.close()
        self.module.engine.dispose()
        os.chdir(self.old_cwd)
        self.temp.cleanup()

    def register(self, tg):
        self.module.tg_codes[tg] = '1234'
        response = self.client.post('/api/profile/register', json={
            'tg_username': tg, 'password': 'secret', 'code': '1234'
        })
        self.assertEqual(response.status_code, 200)
        return {'Authorization': 'Bearer ' + response.json()['token']}

    def test_profiles_and_reactions_are_shared(self):
        alice = self.register('alice')
        bob = self.register('bob')
        data = {'nickname': 'Алиса', 'handle': 'alice_123', 'avatar': ''}
        self.assertEqual(self.client.put('/api/profile/me', headers=alice, json=data).status_code, 200)
        self.assertEqual(self.client.get('/api/profile/public/alice').json()['nickname'], 'Алиса')
        self.assertEqual(self.client.post('/api/profile/session', json={'identifier':'alice', 'password':'secret'}).status_code, 200)
        self.assertEqual(self.client.post('/api/messages', json={'chat_id':'global', 'sender':'alice', 'text':'Привет'}).status_code, 200)
        msg = self.client.get('/api/messages/global').json()[0]
        payload = {'chat_id':'global', 'message_id':str(msg['id']), 'emoji':'👍'}
        self.assertEqual(self.client.post('/api/reactions', json=payload).status_code, 401)
        self.assertEqual(self.client.post('/api/reactions', headers=alice, json=payload).status_code, 200)
        self.assertEqual(self.client.post('/api/reactions', headers=bob, json=payload).status_code, 200)
        items = self.client.get('/api/reactions?chat_id=global', headers=alice).json()['messages'][str(msg['id'])]
        self.assertEqual(items, [{'emoji':'👍', 'count':2, 'reacted':True}])

    def test_existing_telegram_flow_and_file_upload_remain_available(self):
        with patch.object(self.module, 'get_chat_id_by_username', return_value=123), \
             patch.object(self.module.requests, 'post') as post:
            post.return_value.status_code = 200
            self.assertEqual(self.client.post('/api/send_code', json={'tg_username':'alice'}).json()['status'], 'ok')
            code = self.module.tg_codes['alice']
            self.assertEqual(self.client.post('/api/verify_code', json={'tg_username':'alice', 'code':code}).json()['status'], 'ok')
        uploaded = self.client.post('/api/upload', files={'file': ('test.png', b'test', 'image/png')})
        self.assertEqual(uploaded.status_code, 200)
        self.assertIn('/uploads/', uploaded.json()['url'])


if __name__ == '__main__':
    unittest.main()
