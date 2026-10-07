from sqlalchemy import Column, ForeignKey, Integer, String

from app.database import Base


class DispatchRecipient(Base):
    __tablename__ = "dispatch_recipients"

    id = Column(Integer, primary_key=True, index=True)
    dispatch_id = Column(Integer, ForeignKey("dispatches.id"), nullable=False)
    person_id = Column(Integer, ForeignKey("marketing_persons.id"), nullable=False)
    delivery_status = Column(String(50), default="pending")
