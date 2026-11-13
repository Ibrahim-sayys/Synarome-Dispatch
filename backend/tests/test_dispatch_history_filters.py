from datetime import date, datetime, time, timezone
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints.dispatch import dispatch_history, dispatch_history_page, dispatch_stats, history_senders
from app.database import Base
from app.models.dispatch import Dispatch
from app.models.dispatch_recipient import DispatchRecipient
from app.models.marketing_person import MarketingPerson
from app.models.user import User, UserRole


class DispatchHistoryFilterTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.addCleanup(engine.dispose)
        self.db = Session(engine)
        self.addCleanup(self.db.close)
        self.alice = User(username="alice", password_hash="unused", role=UserRole.USER)
        self.bob = User(username="bob", password_hash="unused", role=UserRole.USER)
        self.charlie = User(username="charlie", password_hash="unused", role=UserRole.USER)
        self.deleted = User(username="deleted", password_hash="unused", role=UserRole.USER, is_active=False)
        self.abc = MarketingPerson(full_name="ABC Traders", phone_number="15550000001")
        self.xyz = MarketingPerson(full_name="XYZ Logistics", phone_number="15550000002")
        self.db.add_all([self.alice, self.bob, self.charlie, self.deleted, self.abc, self.xyz])
        self.db.flush()

        self.first = self._record(self.alice, self.abc, datetime(2026, 11, 6, 7, 30, tzinfo=timezone.utc), "Bilty Alpha", "15551234567")
        self.late = self._record(self.alice, self.xyz, datetime(2026, 11, 6, 18, 45, tzinfo=timezone.utc), "Invoice 50% paid", "15559876543")
        self.early = self._record(self.alice, self.xyz, datetime(2026, 11, 7, 0, 15, tzinfo=timezone.utc), "Night message")
        self.last = self._record(self.bob, self.abc, datetime(2026, 11, 7, 8, 0, tzinfo=timezone.utc), "Bilty Beta")
        self.db.commit()

    def _record(self, sender, person, timestamp, message, actual_recipient=None):
        record = Dispatch(sender_id=sender.id, timestamp=timestamp, message_text=message, actual_recipient=actual_recipient)
        self.db.add(record)
        self.db.flush()
        self.db.add(DispatchRecipient(dispatch_id=record.id, person_id=person.id, delivery_status="sent"))
        return record

    def history(self, **filters):
        options = dict(search=None, from_date=None, to_date=None, from_time=None, to_time=None,
                       user_id=None, person_id=None, dispatch_id=None, timezone_offset_minutes=-300)
        options.update(filters)
        return dispatch_history(self.alice, self.db, **options)

    def ids(self, **filters):
        return {record.id for record in self.history(**filters)}

    def test_sender_options_include_active_users_with_no_dispatches(self):
        senders = history_senders(self.alice, self.db)
        self.assertEqual([sender.username for sender in senders], ["alice", "bob", "charlie"])
        self.assertEqual(self.ids(user_id=self.charlie.id), set())
        self.assertEqual(self.ids(user_id=self.bob.id), {self.last.id})

    def test_search_matches_text_contact_number_and_literal_wildcards(self):
        self.assertEqual(self.ids(search="  bilty  "), {self.first.id, self.last.id})
        self.assertEqual(self.ids(search="ABC Traders"), {self.first.id, self.last.id})
        self.assertEqual(self.ids(search="15551234567"), {self.first.id})
        self.assertEqual(self.ids(search="50%"), {self.late.id})
        self.assertEqual(self.ids(search="_"), set())

    def test_paged_history_returns_twenty_per_page_with_filtered_total(self):
        for index in range(45):
            self._record(self.alice, self.abc, datetime(2026, 11, 8, 8, index % 60, tzinfo=timezone.utc), f"Batch {index}")
        self.db.commit()
        filters = dict(search="Batch", from_date=None, to_date=None, from_time=None, to_time=None,
                       user_id=None, person_id=None, customer_id=None, dispatch_id=None, timezone_offset_minutes=0)
        pages = [dispatch_history_page(self.alice, self.db, **filters, page=number, page_size=20) for number in (1, 2, 3)]
        self.assertEqual([len(result.items) for result in pages], [20, 20, 5])
        self.assertEqual([result.total for result in pages], [45, 45, 45])
        self.assertEqual(len({record.id for result in pages for record in result.items}), 45)
        full_page = dispatch_history_page(self.alice, self.db, **filters, page=1, page_size=100)
        self.assertEqual(len(full_page.items), 45)
        self.assertEqual(full_page.total, 45)

    def test_local_date_boundaries_include_entire_last_day(self):
        self.assertEqual(self.ids(from_date=date(2026, 11, 7)), {self.early.id, self.last.id})
        self.assertEqual(self.ids(to_date=date(2026, 11, 6)), {self.first.id, self.late.id})
        self.assertEqual(self.ids(from_date=date(2026, 11, 6), to_date=date(2026, 11, 6)), {self.first.id, self.late.id})

    def test_date_and_time_boundaries_use_local_minutes(self):
        self.assertEqual(self.ids(from_date=date(2026, 11, 6), from_time=time(23, 45)), {self.late.id, self.early.id, self.last.id})
        self.assertEqual(self.ids(to_date=date(2026, 11, 6), to_time=time(12, 30)), {self.first.id})
        self.assertEqual(self.ids(from_date=date(2026, 11, 6), from_time=time(12, 30), to_date=date(2026, 11, 6), to_time=time(23, 45)), {self.first.id, self.late.id})

    def test_time_only_filters_and_overnight_range(self):
        self.assertEqual(self.ids(from_time=time(12, 30)), {self.first.id, self.late.id, self.last.id})
        self.assertEqual(self.ids(to_time=time(5, 15)), {self.early.id})
        self.assertEqual(self.ids(from_time=time(12, 30), to_time=time(13, 0)), {self.first.id, self.last.id})
        self.assertEqual(self.ids(from_time=time(23, 30), to_time=time(5, 15)), {self.late.id, self.early.id})

    def test_contact_sender_search_and_specific_record_filters_combine(self):
        self.assertEqual(self.ids(person_id=self.abc.id), {self.first.id, self.last.id})
        self.assertEqual(self.ids(person_id=self.abc.id, user_id=self.bob.id, search="Beta"), {self.last.id})
        self.assertEqual(self.ids(dispatch_id=self.early.id), {self.early.id})
        self.assertEqual(self.ids(dispatch_id=self.early.id, user_id=self.bob.id), set())

    def test_invalid_specific_record_and_timezone_are_rejected(self):
        for filters in ({"dispatch_id": 0}, {"timezone_offset_minutes": 900}):
            with self.subTest(filters=filters):
                with self.assertRaises(HTTPException) as raised:
                    self.history(**filters)
                self.assertEqual(raised.exception.status_code, 422)

    def test_failed_pending_and_partially_failed_records_are_hidden(self):
        failed_legacy = self._record(self.alice, self.abc, datetime(2026, 11, 7, 9, 0, tzinfo=timezone.utc), "Failed legacy")
        failed_legacy.recipients[0].delivery_status = "failed"
        partial_legacy = self._record(self.alice, self.abc, datetime(2026, 11, 7, 9, 10, tzinfo=timezone.utc), "Partial legacy")
        self.db.add(DispatchRecipient(dispatch_id=partial_legacy.id, person_id=self.xyz.id, delivery_status="failed"))
        empty_legacy = Dispatch(sender_id=self.alice.id, message_text="No recipients", timestamp=datetime(2026, 11, 7, 9, 20, tzinfo=timezone.utc))
        failed_test = Dispatch(sender_id=self.alice.id, send_mode="whatsapp_test", whatsapp_status="failed", message_text="Rejected by Meta", timestamp=datetime(2026, 11, 7, 9, 30, tzinfo=timezone.utc))
        unknown_test = Dispatch(sender_id=self.alice.id, send_mode="whatsapp_test", whatsapp_status="unknown", message_text="Timed out", timestamp=datetime(2026, 11, 7, 9, 40, tzinfo=timezone.utc))
        accepted_test = Dispatch(sender_id=self.alice.id, send_mode="whatsapp_test", whatsapp_status="accepted", message_text="Accepted by Meta", timestamp=datetime(2026, 11, 7, 9, 50, tzinfo=timezone.utc))
        self.db.add_all([empty_legacy, failed_test, unknown_test, accepted_test])
        self.db.commit()

        expected = {self.first.id, self.late.id, self.early.id, self.last.id, accepted_test.id}
        self.assertEqual(self.ids(), expected)
        self.assertEqual(self.ids(search="Failed legacy"), set())
        self.assertEqual(self.ids(dispatch_id=failed_test.id), set())
        self.assertEqual({record.id for record in dispatch_stats(self.alice, self.db).recent_dispatches}, expected)
        self.assertIsNotNone(self.db.get(Dispatch, failed_test.id))
