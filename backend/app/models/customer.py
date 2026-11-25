from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Text, text
from sqlalchemy.orm import relationship

from app.database import Base


class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True)
    full_name = Column(String(150), nullable=False)
    phone_number = Column(String(30), nullable=True)
    city = Column(String(100), nullable=True)
    other_info = Column(Text, nullable=True)
    marketing_person_id = Column(Integer, ForeignKey("marketing_persons.id"), nullable=False, index=True)
    is_deleted = Column(Boolean, nullable=False, server_default=text("false"), default=False)

    marketing_person = relationship("MarketingPerson")
