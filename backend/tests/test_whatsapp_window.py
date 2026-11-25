import unittest
from datetime import datetime, timedelta, timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.database import Base
from app.models.incoming_message import IncomingMessage
from app.services.whatsapp_window import window_expiry


class WhatsAppWindowTests(unittest.TestCase):
    def test_exact_window_boundary_and_future_events(self):
        engine = create_engine('sqlite://')
        Base.metadata.create_all(engine)
        now = datetime(2026, 11, 23, 12, tzinfo=timezone.utc)
        with Session(engine) as db:
            db.add(IncomingMessage(whatsapp_message_id='old', sender_number='923001112222', message_type='text', timestamp=now - timedelta(hours=24)))
            db.add(IncomingMessage(whatsapp_message_id='future', sender_number='923001112222', message_type='text', timestamp=now + timedelta(hours=1)))
            db.commit()
            self.assertIsNone(window_expiry(db, '923001112222', now))
            db.add(IncomingMessage(whatsapp_message_id='new', sender_number='923001112222', message_type='text', timestamp=now - timedelta(hours=23)))
            db.commit()
            self.assertEqual(window_expiry(db, '923001112222', now), now + timedelta(hours=1))
            self.assertIsNone(window_expiry(db, '923009999999', now))
        engine.dispose()
