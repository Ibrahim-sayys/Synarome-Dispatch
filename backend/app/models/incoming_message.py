from sqlalchemy import Column, DateTime, Integer, String, Text
from app.database import Base


class IncomingMessage(Base):
    __tablename__ = 'incoming_messages'
    id = Column(Integer, primary_key=True)
    whatsapp_message_id = Column(String(512), nullable=False, unique=True)
    sender_number = Column(String(32), nullable=False, index=True)
    sender_name = Column(String(255), nullable=True)
    message_type = Column(String(40), nullable=False)
    message_text = Column(Text, nullable=True)
    media_id = Column(String(512), nullable=True)
    media_mime = Column(String(255), nullable=True)
    media_filename = Column(String(255), nullable=True)
    context_message_id = Column(String(512), nullable=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
