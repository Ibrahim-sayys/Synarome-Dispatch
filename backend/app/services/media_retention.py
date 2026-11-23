"""Scheduled, bounded removal of stored dispatch attachments."""
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import case, func
from app.config import settings
from app.database import SessionLocal
from app.models.dispatch import Dispatch
from app.models.media_retention import MediaRetention

logger = logging.getLogger(__name__)


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


def candidates(db, cutoff):
    # Shared files must be old enough for every dispatch that references them.
    return (db.query(Dispatch.file_path, func.min(Dispatch.timestamp), func.max(Dispatch.timestamp))
            .filter(Dispatch.file_path.isnot(None)).group_by(Dispatch.file_path)
            .having(func.max(Dispatch.timestamp) <= cutoff)
            .having(func.sum(case((Dispatch.timestamp.is_(None), 1), else_=0)) == 0)
            .having(func.sum(case((Dispatch.whatsapp_status.in_(["pending", "unknown"]), 1), else_=0)) == 0)
            .all())


def tick(now=None):
    now = now or datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        schedule = db.query(MediaRetention).filter_by(id=1).with_for_update().one_or_none()
        if not schedule:
            return
        due = utc(schedule.next_run)
        if not schedule.notice_at and now >= due - timedelta(hours=24):
            schedule.notice_at = now
            schedule.cutoff_at = min(due, now) - timedelta(days=schedule.interval_days)
            if due < now + timedelta(hours=24):
                schedule.next_run = now + timedelta(hours=24)
            db.commit()
            return
        if not schedule.notice_at or now < utc(schedule.next_run) or now < utc(schedule.notice_at) + timedelta(hours=24):
            return
        root = Path(settings.UPLOAD_DIR).resolve()
        failed = False
        for file_path, _, _ in candidates(db, schedule.cutoff_at):
            references = db.query(Dispatch).filter(Dispatch.file_path == file_path).with_for_update().all()
            if not references or any(not row.timestamp or utc(row.timestamp) > utc(schedule.cutoff_at) or row.whatsapp_status in ("pending", "unknown") for row in references):
                continue
            path = Path(file_path)
            # Never follow links or remove files outside the upload directory.
            if path.is_symlink() or not path.resolve().is_relative_to(root) or path.resolve() == root:
                logger.error("Media cleanup skipped an unsafe path")
                failed = True
                continue
            try:
                path.unlink(missing_ok=True)
                db.query(Dispatch).filter(Dispatch.file_path == file_path).update({Dispatch.file_path: None}, synchronize_session=False)
            except OSError:
                logger.exception("Media cleanup could not remove an attachment")
                failed = True
        if not failed:
            schedule.notice_at = None
            schedule.cutoff_at = None
            schedule.next_run = now + timedelta(days=schedule.interval_days)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Media cleanup failed")
    finally:
        db.close()
