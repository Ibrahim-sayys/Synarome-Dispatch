from sqlalchemy import Boolean, Column, ForeignKey, Integer, String

from app.database import Base


class MarketingPerson(Base):
    __tablename__ = "marketing_persons"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(150), nullable=False)
    phone_number = Column(String(30), nullable=False, unique=True)
    is_active = Column(Boolean, default=True)
    added_by = Column(Integer, ForeignKey("users.id"), nullable=True)
