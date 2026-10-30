import unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Column, Integer, String, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import StaticPool
from server.profile_api import install_profile_api

Base = declarative_base()


class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True)
    tg_username = Column(String, unique=True)
    password = Column(String)


class ProfileTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)
        self.codes = {'Alice': '1234', 'Bob': '5678'}
        app = FastAPI()
        install_profile_api(app, self.db, engine, User, self.codes)
        self.client = TestClient(app)

    def register(self, tg, code, password='secret'):
        return self.client.post('/api/profile/register', json={'tg_username': tg, 'password': password, 'code': code})

    def test_registration_requires_code_and_creates_internal_identifier(self):
        self.assertEqual(self.register('Alice', 'wrong').status_code, 400)
        r = self.register('Alice', '1234')
        self.assertEqual(r.status_code, 200)
        self.assertNotIn('Alice', self.codes)
        with self.db() as db:
            user = db.query(User).one()
            self.assertTrue(user.username.startswith('u_'))
            self.assertEqual(user.tg_username, 'Alice')
        self.assertEqual(self.client.post('/api/profile/session', json={'identifier':'alice', 'password':'wrong'}).status_code, 401)
        self.assertEqual(self.client.post('/api/profile/session', json={'identifier':'alice', 'password':'secret'}).status_code, 200)

    def test_profile_permissions_uniqueness_and_public_visibility(self):
        alice = self.register('Alice','1234').json()['token']
        bob = self.register('Bob','5678').json()['token']
        self.assertEqual(self.client.put('/api/profile/me', json={}).status_code, 401)
        headers = {'Authorization': 'Bearer ' + alice}
        data = {'nickname':'Alice A', 'handle':'@Example_Name', 'avatar':''}
        r = self.client.put('/api/profile/me', headers=headers, json=data)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['handle'], 'example_name')
        public = self.client.get('/api/profile/public/alice').json()
        self.assertEqual(public['nickname'], 'Alice A')
        self.assertEqual(public['handle'], 'example_name')
        self.assertEqual(self.client.put('/api/profile/me', headers={'Authorization':'Bearer '+bob}, json=data).status_code, 409)
        self.assertEqual(self.client.put('/api/profile/me', headers=headers, json={'handle':'a!', 'nickname':'', 'avatar':''}).status_code, 400)
        self.assertEqual(self.client.put('/api/profile/me', headers=headers, json={'handle':'', 'nickname':'', 'avatar':'data:image/png;base64,PHN2Zz4='}).status_code, 400)
        self.assertEqual(self.client.put('/api/profile/me', headers=headers, json={'handle':'', 'nickname':'', 'avatar':''}).status_code, 200)
        self.assertEqual(self.client.get('/api/profile/me', headers=headers).json()['handle'], '')


if __name__ == '__main__':
    unittest.main()
