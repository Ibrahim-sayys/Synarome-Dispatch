from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class Dispatch(Base):
    __tablename__ = "dispatches"

    id = Column(Integer, primary_key=True, index=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    file_path = Column(String(500), nullable=True)
    message_text = Column(Text, nullable=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    sender = relationship("User")
    recipients = relationship("DispatchRecipient", back_populates="dispatch")
