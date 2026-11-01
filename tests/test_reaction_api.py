import unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Column, Integer, String, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import StaticPool
from server.profile_api import install_profile_api
from server.reaction_api import install_reaction_api

Base = declarative_base()
class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True)
    tg_username = Column(String, unique=True)
    password = Column(String)
class Message(Base):
    __tablename__ = 'messages'
    id = Column(Integer, primary_key=True)
    chat_id = Column(String)

class ReactionTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)
        with self.db() as db:
            db.add_all([Message(id=7, chat_id='global'), Message(id=8, chat_id='elsewhere')]);db.commit()
        app = FastAPI()
        auth = install_profile_api(app, self.db, engine, User, {'Alice':'1234','Bob':'5678'})
        install_reaction_api(app, self.db, engine, Message, auth)
        self.client = TestClient(app)
        self.alice = self.client.post('/api/profile/register', json={'tg_username':'Alice','password':'secret','code':'1234'}).json()['token']
        self.bob = self.client.post('/api/profile/register', json={'tg_username':'Bob','password':'secret','code':'5678'}).json()['token']
        self.payload = {'chat_id':'global','message_id':'7','emoji':'👍','sender':'fake'}

    def post(self, token=None, **fields):
        headers = {'Authorization':'Bearer '+token} if token else {}
        return self.client.post('/api/reactions', headers=headers, json={**self.payload,**fields})

    def test_authenticated_toggle_and_shared_count(self):
        self.assertEqual(self.post().status_code, 401)
        self.assertEqual(self.post('invalid').status_code, 401)
        first = self.post(self.alice)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json(), {'reactions':[{'emoji':'👍','count':1,'reacted':True}]})
        second = self.post(self.bob)
        self.assertEqual(second.json()['reactions'][0]['count'], 2)
        public = self.client.get('/api/reactions', params={'chat_id':'global'}).json()
        self.assertEqual(public['messages']['7'], [{'emoji':'👍','count':2,'reacted':False}])
        self.assertNotIn('Alice', str(public)); self.assertNotIn('fake', str(public))
        mine = self.client.get('/api/reactions', params={'chat_id':'global'}, headers={'Authorization':'Bearer '+self.alice}).json()
        self.assertTrue(mine['messages']['7'][0]['reacted'])
        self.assertEqual(self.post(self.alice).json()['reactions'], [{'emoji':'👍','count':1,'reacted':False}])
        self.assertEqual(self.client.get('/api/reactions', params={'chat_id':'elsewhere'}).json(), {'messages':{}})

    def test_validation_and_cross_chat(self):
        self.assertEqual(self.post(self.alice, message_id='8').status_code, 404)
        self.assertEqual(self.post(self.alice, message_id='x').status_code, 400)
        self.assertEqual(self.post(self.alice, emoji='\n').status_code, 400)
        self.assertEqual(self.post(self.alice, emoji='x'*33).status_code, 400)
        self.assertEqual(self.client.get('/api/reactions',params={'chat_id':'global'}).json(), {'messages':{}})

if __name__ == '__main__': unittest.main()
