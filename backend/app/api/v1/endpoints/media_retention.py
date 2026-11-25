from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.api.deps import CurrentUser, get_db
from app.core.permissions import require_roles
from app.models.media_retention import MediaRetention
from app.models.user import UserRole
from app.services.media_retention import candidates, utc

router = APIRouter()


class RetentionUpdate(BaseModel):
    interval_days: int = Field(ge=2, le=3650)


def admin(user):
    require_roles(user, [UserRole.SUPER_ADMIN])


@router.get("")
def get_retention(current_user: CurrentUser, db: Session = Depends(get_db)):
    admin(current_user)
    schedule = db.get(MediaRetention, 1)
    if not schedule:
        raise HTTPException(503, "Media retention has not been installed; run database migrations.")
    rows = candidates(db, schedule.cutoff_at) if schedule.notice_at else []
    dates = [utc(value) for _, first, last in rows for value in (first, last) if value]
    return {"interval_days": schedule.interval_days, "next_run": utc(schedule.next_run),
            "notice_at": utc(schedule.notice_at), "cutoff_at": utc(schedule.cutoff_at),
            "file_count": len(rows), "oldest": min(dates) if dates else None, "newest": max(dates) if dates else None}


@router.put("")
def update_retention(payload: RetentionUpdate, current_user: CurrentUser, db: Session = Depends(get_db)):
    admin(current_user)
    schedule = db.query(MediaRetention).filter_by(id=1).with_for_update().one_or_none()
    if not schedule:
        raise HTTPException(503, "Media retention has not been installed; run database migrations.")
    schedule.interval_days = payload.interval_days
    schedule.next_run = datetime.now(timezone.utc) + timedelta(days=payload.interval_days)
    schedule.notice_at = None
    schedule.cutoff_at = None
    db.commit()
    return get_retention(current_user, db)
