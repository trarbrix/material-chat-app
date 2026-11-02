"""Exercise the standalone server against a disposable PostgreSQL database in CI."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

SERVER = Path(__file__).resolve().parents[1] / 'server' / 'main_ready.py'
TEST_URL = os.environ.get('MATERIAL_CHAT_TEST_POSTGRES_URL', '')


@unittest.skipUnless(TEST_URL, 'PostgreSQL test server not configured')
class PostgreSQLServerTests(unittest.TestCase):
    def setUp(self):
        # The isolated database is created only on an explicitly configured test server.
        self.name = 'material_chat_test_' + uuid4().hex
        self.admin = create_engine(TEST_URL, isolation_level='AUTOCOMMIT')
        with self.admin.connect() as conn:
            conn.exec_driver_sql('CREATE DATABASE "' + self.name + '"')
        self.old_cwd = os.getcwd()
        self.temp = tempfile.TemporaryDirectory()
        os.chdir(self.temp.name)
        url = make_url(TEST_URL).set(database=self.name).render_as_string(hide_password=False)
        # Exercise the common provider URL, not just the explicit psycopg dialect.
        url = url.replace('postgresql+psycopg://', 'postgres://', 1)
        self.env = patch.dict(os.environ, {'MATERIAL_CHAT_DATABASE_URL':url, 'MATERIAL_CHAT_DATA_DIR':''})
        self.env.start()
        self.engines = []

    def tearDown(self):
        for engine in self.engines:
            engine.dispose()
        self.env.stop()
        os.chdir(self.old_cwd)
        self.temp.cleanup()
        with self.admin.connect() as conn:
            conn.exec_driver_sql('DROP DATABASE "' + self.name + '"')
        self.admin.dispose()

    def load_app(self, name):
        spec = importlib.util.spec_from_file_location(name, SERVER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.engines.append(module.engine)
        return module, TestClient(module.app)

    def test_profiles_messages_and_reactions_survive_restart(self):
        server, client = self.load_app('ready_postgres_1')
        server.tg_codes['alice'] = '1234'
        response = client.post('/api/profile/register', json={'tg_username':'alice', 'password':'secret', 'code':'1234'})
        self.assertEqual(response.status_code, 200)
        headers = {'Authorization':'Bearer ' + response.json()['token']}
        self.assertEqual(client.put('/api/profile/me', headers=headers, json={'nickname':'Алиса'}).status_code, 200)
        self.assertEqual(client.post('/api/messages', json={'chat_id':'global','sender':'alice','text':'Привет'}).status_code, 200)
        mid = client.get('/api/messages/global').json()[0]['id']
        self.assertEqual(client.post('/api/reactions', headers=headers, json={'chat_id':'global','message_id':str(mid),'emoji':'👍'}).status_code, 200)
        client.close()
        server.engine.dispose()
        again, client = self.load_app('ready_postgres_2')
        try:
            response = client.post('/api/profile/session', json={'identifier':'alice','password':'secret'})
            self.assertEqual(response.status_code, 200)
            headers = {'Authorization':'Bearer ' + response.json()['token']}
            self.assertEqual(client.get('/api/profile/me', headers=headers).json()['nickname'], 'Алиса')
            self.assertEqual(client.get('/api/messages/global').json()[0]['text'], 'Привет')
            self.assertEqual(client.get('/api/reactions?chat_id=global', headers=headers).json()['messages'][str(mid)][0]['count'], 1)
        finally:
            client.close()


if __name__ == '__main__':
    unittest.main()
