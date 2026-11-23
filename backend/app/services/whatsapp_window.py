"""Customer-service window based on authenticated incoming WhatsApp events."""
from datetime import datetime, timedelta, timezone
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.models.incoming_message import IncomingMessage


def window_expiry(db: Session, number: str, now: datetime | None = None) -> datetime | None:
    now = now or datetime.now(timezone.utc)
    last = db.query(func.max(IncomingMessage.timestamp)).filter(
        IncomingMessage.sender_number == number,
        IncomingMessage.timestamp <= now,
        IncomingMessage.timestamp > now - timedelta(hours=24),
    ).scalar()
    if not last:
        return None
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return last + timedelta(hours=24)
