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
        self.env = patch.dict(os.environ, {'MATERIAL_CHAT_DATA_DIR':'', 'MATERIAL_CHAT_DATABASE_URL':'', 'MATERIAL_CHAT_BOT_TOKEN':'test-token'})
        self.env.start()
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
        self.env.stop()

    def register(self, tg):
        self.module.tg_codes[tg] = '1234'
        response = self.client.post('/api/profile/register', json={
            'tg_username': tg, 'password': 'secret', 'code': '1234'
        })
        self.assertEqual(response.status_code, 200)
        return {'Authorization': 'Bearer ' + response.json()['token']}

    def test_telegram_token_is_read_from_environment(self):
        self.assertEqual(self.module.BOT_TOKEN, 'test-token')

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

    def test_persistent_directory_survives_server_restart(self):
        data_dir = Path(self.temp.name) / 'persistent'
        os.environ['MATERIAL_CHAT_DATA_DIR'] = str(data_dir)
        spec = importlib.util.spec_from_file_location('ready_persistent_1', SERVER)
        first = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(first)
        client = TestClient(first.app)
        first.tg_codes['alice'] = '1234'
        r = client.post('/api/profile/register', json={'tg_username':'alice','password':'secret','code':'1234'})
        self.assertEqual(r.status_code, 200)
        headers = {'Authorization': 'Bearer ' + r.json()['token']}
        self.assertEqual(client.put('/api/profile/me', headers=headers, json={'nickname':'Алиса'}).status_code, 200)
        self.assertEqual(client.post('/api/messages', json={'chat_id':'global','sender':'alice','text':'Привет'}).status_code, 200)
        mid = client.get('/api/messages/global').json()[0]['id']
        self.assertEqual(client.post('/api/reactions', headers=headers, json={'chat_id':'global','message_id':str(mid),'emoji':'👍'}).status_code, 200)
        upload = client.post('/api/upload', files={'file': ('pic.png', b'content', 'image/png')}).json()['url']
        self.assertTrue((data_dir / 'material_chat.db').exists())
        self.assertEqual(len(list((data_dir / 'uploads').iterdir())), 1)
        client.close()
        first.engine.dispose()
        spec = importlib.util.spec_from_file_location('ready_persistent_2', SERVER)
        second = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(second)
        client = TestClient(second.app)
        try:
            login = client.post('/api/profile/session', json={'identifier':'alice','password':'secret'})
            self.assertEqual(login.status_code, 200)
            headers = {'Authorization': 'Bearer ' + login.json()['token']}
            self.assertEqual(client.get('/api/profile/me', headers=headers).json()['nickname'], 'Алиса')
            self.assertEqual(client.get('/api/messages/global').json()[0]['text'], 'Привет')
            self.assertEqual(client.get('/api/reactions?chat_id=global', headers=headers).json()['messages'][str(mid)][0]['count'], 1)
            self.assertEqual(client.get('/uploads/' + upload.rsplit('/',1)[-1]).content, b'content')
        finally:
            client.close()
            second.engine.dispose()

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
