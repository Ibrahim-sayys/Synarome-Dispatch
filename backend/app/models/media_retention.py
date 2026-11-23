from sqlalchemy import Column, DateTime, Integer
from app.database import Base


class MediaRetention(Base):
    __tablename__ = "media_retention"
    id = Column(Integer, primary_key=True)
    interval_days = Column(Integer, nullable=False, default=10)
    next_run = Column(DateTime(timezone=True), nullable=False)
    notice_at = Column(DateTime(timezone=True), nullable=True)
    cutoff_at = Column(DateTime(timezone=True), nullable=True)
