"""Optional profile API for Material Chat's existing FastAPI backend.

Call install_profile_api(app, SessionLocal, engine, UserDB, tg_codes) after
creating the existing app, database models and tg_codes dictionary.
"""
import base64
import binascii
import hmac
import re
import secrets
import threading
import time

from fastapi import Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import Column, Integer, String, Text, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import declarative_base

ProfileBase = declarative_base()


class ChatProfile(ProfileBase):
    __tablename__ = "chat_profiles"
    user_id = Column(Integer, primary_key=True)
    nickname = Column(String(40), nullable=False, default="")
    handle = Column(String(32), unique=True, nullable=True)
    avatar = Column(Text, nullable=False, default="")


class ProfileLogin(BaseModel):
    identifier: str
    password: str


class ProfileRegistration(BaseModel):
    tg_username: str
    password: str
    code: str


class ProfileChanges(BaseModel):
    nickname: str = ""
    handle: str = ""
    avatar: str = ""


def validate_avatar(value):
    if not value:
        return ""
    if len(value) > 280_000:
        raise HTTPException(status_code=413, detail="Avatar is too large")
    match = re.fullmatch(r"data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)", value)
    if not match:
        raise HTTPException(status_code=400, detail="Unsupported avatar format")
    try:
        content = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="Invalid avatar")
    kind = match.group(1)
    valid = (kind == "png" and content.startswith(b"\x89PNG\r\n\x1a\n")) or \
        (kind == "jpeg" and content.startswith(b"\xff\xd8\xff")) or \
        (kind == "webp" and content.startswith(b"RIFF") and content[8:12] == b"WEBP")
    if not valid or len(content) > 200_000:
        raise HTTPException(status_code=400, detail="Invalid or oversized avatar")
    return value


def install_profile_api(app, SessionLocal, engine, UserDB, tg_codes):
    ProfileBase.metadata.create_all(bind=engine)
    # Sessions expire on server restart. No password is retained in a session.
    sessions = {}
    session_lock = threading.Lock()
    lifetime = 12 * 60 * 60

    def issue_token(user_id):
        token = secrets.token_urlsafe(32)
        now = time.time()
        with session_lock:
            for old, (_, expires) in list(sessions.items()):
                if expires <= now:
                    sessions.pop(old, None)
            sessions[token] = (user_id, now + lifetime)
        return token

    def user_id_for(authorization):
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Sign in again")
        token = authorization[7:]
        with session_lock:
            item = sessions.get(token)
            if item and item[1] <= time.time():
                sessions.pop(token, None)
                item = None
        if not item:
            raise HTTPException(status_code=401, detail="Session expired")
        return item[0]

    def serialize(profile):
        return {"nickname": profile.nickname or "", "handle": profile.handle or "", "avatar": profile.avatar or ""} if profile else {"nickname": "", "handle": "", "avatar": ""}

    @app.post("/api/profile/register")
    def register_with_code(data: ProfileRegistration):
        tg = data.tg_username.strip().lstrip("@")
        if not tg or not data.password or not data.code:
            raise HTTPException(status_code=400, detail="Missing fields")
        code = tg_codes.get(tg)
        if not code or not hmac.compare_digest(str(code).encode("utf-8"), str(data.code).strip().encode("utf-8")):
            raise HTTPException(status_code=400, detail="Invalid code")
        db = SessionLocal()
        try:
            if db.query(UserDB).filter(func.lower(UserDB.tg_username) == tg.lower()).first():
                raise HTTPException(status_code=409, detail="Account already exists")
            # The identifier is internal; a public handle can be chosen later.
            user = UserDB(username="u_" + secrets.token_hex(16), tg_username=tg, password=data.password)
            db.add(user)
            db.commit()
            db.refresh(user)
            tg_codes.pop(tg, None)
            return {"token": issue_token(user.id), "identifier": tg}
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=409, detail="Account already exists")
        finally:
            db.close()

    @app.post("/api/profile/session")
    def profile_session(data: ProfileLogin):
        identifier = data.identifier.strip().lstrip("@")
        db = SessionLocal()
        try:
            users = db.query(UserDB).filter((func.lower(UserDB.tg_username) == identifier.lower()) | (UserDB.username == identifier)).all()
            # Existing server stores plaintext passwords; compare without logging or retaining them.
            matches = [item for item in users if item.password and hmac.compare_digest(item.password.encode('utf-8'), data.password.encode('utf-8'))]
            # The old backend has two identifiers; never guess between accounts.
            if len(matches) != 1:
                raise HTTPException(status_code=401, detail="Incorrect or ambiguous credentials")
            return {"token": issue_token(matches[0].id)}
        finally:
            db.close()

    @app.get("/api/profile/me")
    def get_my_profile(authorization: str = Header(default="")):
        user_id = user_id_for(authorization)
        db = SessionLocal()
        try:
            return serialize(db.query(ChatProfile).filter(ChatProfile.user_id == user_id).first())
        finally:
            db.close()

    @app.put("/api/profile/me")
    def update_my_profile(data: ProfileChanges, authorization: str = Header(default="")):
        user_id = user_id_for(authorization)
        nickname = data.nickname.strip()
        handle = data.handle.strip().lstrip("@").lower()
        if len(nickname) > 40:
            raise HTTPException(status_code=400, detail="Nickname is too long")
        if handle and not re.fullmatch(r"[a-z][a-z0-9_]{2,31}", handle):
            raise HTTPException(status_code=400, detail="Invalid handle")
        avatar = validate_avatar(data.avatar)
        db = SessionLocal()
        try:
            profile = db.query(ChatProfile).filter(ChatProfile.user_id == user_id).first()
            if not profile:
                profile = ChatProfile(user_id=user_id)
                db.add(profile)
            profile.nickname = nickname
            profile.handle = handle or None
            profile.avatar = avatar
            db.commit()
            return serialize(profile)
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=409, detail="Handle already taken")
        finally:
            db.close()

    @app.get("/api/profile/public/{sender}")
    def public_profile(sender: str):
        if len(sender) > 100:
            raise HTTPException(status_code=400, detail="Invalid sender")
        db = SessionLocal()
        try:
            users = db.query(UserDB).filter((UserDB.username == sender) | (func.lower(UserDB.tg_username) == sender.lower())).all()
            # Legacy sender strings can refer to more than one account; do not misattribute them.
            return serialize(db.query(ChatProfile).filter(ChatProfile.user_id == users[0].id).first()) if len(users) == 1 else serialize(None)
        finally:
            db.close()
