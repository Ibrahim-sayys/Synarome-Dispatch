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
    send_mode = Column(String(30), nullable=False, default="contact", server_default="contact")
    whatsapp_status = Column(String(30), nullable=True)
    whatsapp_message_id = Column(String(512), nullable=True)
    actual_recipient = Column(String(32), nullable=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    marketing_person_id = Column(Integer, ForeignKey("marketing_persons.id"), nullable=True)
    recipient_kind = Column(String(20), nullable=True)
    customer_name = Column(String(150), nullable=True)
    marketing_person_name = Column(String(150), nullable=True)
    recipient_name = Column(String(150), nullable=True)
    recipient_customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    recipient_marketing_person_id = Column(Integer, ForeignKey("marketing_persons.id"), nullable=True)
    original_filename = Column(String(255), nullable=True)
    failure_reason = Column(Text, nullable=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    sender = relationship("User")
    customer = relationship("Customer", foreign_keys=[customer_id])
    recipients = relationship("DispatchRecipient", back_populates="dispatch")
