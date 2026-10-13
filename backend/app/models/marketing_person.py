from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, text
from sqlalchemy.orm import relationship

from app.database import Base


class MarketingPerson(Base):
    __tablename__ = "marketing_persons"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(150), nullable=False)
    phone_number = Column(String(30), nullable=False, unique=True)
    is_active = Column(Boolean, nullable=False, server_default=text("true"), default=True)
    added_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    suspended_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    suspended_by_user = relationship("User", foreign_keys=[suspended_by])
