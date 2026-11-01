"""Optional shared-reaction endpoints for the legacy Material Chat server.

Install the profile API first and pass its returned token verifier here. The
legacy message API still needs its own access-control and privacy fixes.
"""
from collections import defaultdict
import unicodedata

from fastapi import Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import Column, Integer, String, UniqueConstraint
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import declarative_base

ReactionBase = declarative_base()


class ChatReaction(ReactionBase):
    __tablename__ = "chat_reactions"
    id = Column(Integer, primary_key=True)
    chat_id = Column(String(200), nullable=False, index=True)
    message_id = Column(Integer, nullable=False, index=True)
    user_id = Column(Integer, nullable=False)
    emoji = Column(String(64), nullable=False)
    __table_args__ = (UniqueConstraint("message_id", "user_id", "emoji", name="uq_chat_reaction"),)


class ReactionRequest(BaseModel):
    chat_id: str
    message_id: str
    emoji: str


def install_reaction_api(app, SessionLocal, engine, MessageDB, user_id_for):
    if not callable(user_id_for):
        raise ValueError("A profile session verifier is required")
    ReactionBase.metadata.create_all(bind=engine)

    def grouped(rows, viewer):
        result = defaultdict(lambda: defaultdict(lambda: {"count": 0, "reacted": False}))
        for row in rows:
            item = result[str(row.message_id)][row.emoji]
            item["count"] += 1
            if viewer is not None and row.user_id == viewer:
                item["reacted"] = True
        return {mid: [{"emoji": emoji, **data} for emoji, data in groups.items()] for mid, groups in result.items()}

    @app.get('/api/reactions')
    def get_reactions(chat_id: str, authorization: str = Header(default="")):
        if not chat_id or len(chat_id) > 200:
            raise HTTPException(status_code=400, detail="Invalid chat")
        viewer = None
        if authorization:
            try:
                viewer = user_id_for(authorization)
            except HTTPException as exc:
                if exc.status_code != 401:
                    raise
        db = SessionLocal()
        try:
            rows = db.query(ChatReaction).filter(ChatReaction.chat_id == chat_id).all()
            return {"messages": grouped(rows, viewer)}
        finally:
            db.close()

    @app.post('/api/reactions')
    def toggle_reaction(data: ReactionRequest, authorization: str = Header(default="")):
        viewer = user_id_for(authorization)
        emoji = data.emoji.strip()
        if not data.chat_id or len(data.chat_id) > 200 or not data.message_id.isascii() or not data.message_id.isdigit() or len(data.message_id) > 18:
            raise HTTPException(status_code=400, detail="Invalid message")
        if not emoji or len(emoji) > 32 or any(unicodedata.category(c) == 'Cc' for c in emoji):
            raise HTTPException(status_code=400, detail="Invalid reaction")
        msg_id = int(data.message_id)
        db = SessionLocal()
        try:
            message = db.query(MessageDB).filter(MessageDB.id == msg_id, MessageDB.chat_id == data.chat_id).first()
            if not message:
                raise HTTPException(status_code=404, detail="Message not found")
            existing = db.query(ChatReaction).filter_by(message_id=msg_id, user_id=viewer, emoji=emoji).first()
            if existing:
                db.delete(existing)
            else:
                db.add(ChatReaction(chat_id=data.chat_id, message_id=msg_id, user_id=viewer, emoji=emoji))
            db.commit()
            rows = db.query(ChatReaction).filter_by(chat_id=data.chat_id, message_id=msg_id).all()
            return {"reactions": grouped(rows, viewer).get(str(msg_id), [])}
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=409, detail="Reaction changed; try again")
        finally:
            db.close()
