import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
from app.models.dispatch import Dispatch
from app.models.media_retention import MediaRetention
from app.models.user import User, UserRole
from app.services.media_retention import tick
from app.config import settings
from app.api.v1.endpoints.media_retention import RetentionUpdate, get_retention, update_retention
from fastapi import HTTPException


class MediaRetentionTests(unittest.TestCase):
    def test_only_super_admin_can_change_schedule(self):
        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine)
        factory = sessionmaker(bind=engine)
        with factory() as db:
            admin = User(username="admin", password_hash="x", role=UserRole.SUPER_ADMIN)
            manager = User(username="manager", password_hash="x", role=UserRole.MANAGER)
            db.add_all([admin, manager, MediaRetention(id=1, interval_days=10, next_run=datetime.now(timezone.utc),
                                                       notice_at=datetime.now(timezone.utc), cutoff_at=datetime.now(timezone.utc))])
            db.commit()
            with self.assertRaises(HTTPException) as error:
                update_retention(RetentionUpdate(interval_days=30), manager, db)
            self.assertEqual(error.exception.status_code, 403)
            result = update_retention(RetentionUpdate(interval_days=30), admin, db)
            self.assertEqual(result["interval_days"], 30)
            self.assertIsNone(result["notice_at"])
            self.assertGreater(result["next_run"], datetime.now(timezone.utc) + timedelta(days=29))
        engine.dispose()

    def test_notice_restart_and_shared_file_cleanup(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        factory = sessionmaker(bind=engine)
        now = datetime(2026, 11, 22, tzinfo=timezone.utc)
        with TemporaryDirectory() as directory, patch("app.services.media_retention.SessionLocal", factory), patch.object(settings, "UPLOAD_DIR", directory):
            old = Path(directory) / "old.pdf"
            shared = Path(directory) / "shared.pdf"
            pending = Path(directory) / "pending.pdf"
            for path in (old, shared, pending): path.write_bytes(b"attachment")
            with factory() as db:
                user = User(username="admin", password_hash="x", role=UserRole.SUPER_ADMIN)
                db.add(user); db.flush()
                def add(path, age, status="accepted"):
                    db.add(Dispatch(sender_id=user.id, send_mode="customer_dispatch", file_path=str(path),
                                    timestamp=now - timedelta(days=age), whatsapp_status=status, message_text="kept"))
                add(old, 30); add(old, 20)
                add(shared, 30); add(shared, 2)
                add(pending, 30, "pending")
                db.add(MediaRetention(id=1, interval_days=10, next_run=now - timedelta(days=1)))
                db.commit()
            tick(now)
            tick(now + timedelta(hours=23))
            self.assertTrue(old.exists())
            tick(now + timedelta(hours=24))
            self.assertFalse(old.exists())
            self.assertTrue(shared.exists())
            self.assertTrue(pending.exists())
            with factory() as db:
                records = db.query(Dispatch).order_by(Dispatch.id).all()
                self.assertEqual([r.file_path for r in records[:2]], [None, None])
                self.assertEqual(records[0].message_text, "kept")
                self.assertIsNone(db.get(MediaRetention, 1).notice_at)
        engine.dispose()
