import unittest
from datetime import datetime, timedelta, timezone
from tempfile import TemporaryDirectory
from unittest.mock import patch

import httpx
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_user, get_db
from app.config import settings
from app.database import Base
from app.main import app
from app.models.customer import Customer
from app.models.dispatch import Dispatch
from app.models.marketing_person import MarketingPerson
from app.models.incoming_message import IncomingMessage
from app.models.user import User, UserRole
from app.api.v1.endpoints.dispatch import dispatch_history
from app.services.whatsapp_service import PreparedMedia, WhatsAppError


class CustomerDispatchTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.addCleanup(engine.dispose)
        self.db = Session(engine)
        self.addCleanup(self.db.close)
        self.user = User(username="tester", password_hash="unused", role=UserRole.USER)
        self.john = MarketingPerson(full_name="John", phone_number="+923001112222")
        self.sara = MarketingPerson(full_name="Sara", phone_number="+923003334444")
        self.db.add_all([self.user, self.john, self.sara])
        patcher = patch.object(settings, 'WHATSAPP_TEST_RECIPIENT', '15551234567')
        patcher.start()
        self.addCleanup(patcher.stop)
        for index, number in enumerate(['923001112222', '923003334444', '923005556666', '923007778888', '15551234567', '15557654321']):
            self.db.add(IncomingMessage(whatsapp_message_id=f'window-fixture-{index}', sender_number=number,
                                        message_type='text', timestamp=datetime.now(timezone.utc)))
        self.db.commit()

        async def fake_user():
            return self.user

        async def fake_db():
            yield self.db

        app.dependency_overrides[get_current_user] = fake_user
        app.dependency_overrides[get_db] = fake_db

    def tearDown(self):
        app.dependency_overrides.clear()

    async def test_status_lookup_returns_current_receipt(self):
        record = Dispatch(sender_id=self.user.id, send_mode='customer_dispatch', whatsapp_status='read', whatsapp_message_id='wamid.read')
        self.db.add(record); self.db.commit()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            response = await client.post('/api/v1/dispatch/statuses', json={'ids': [record.id, -1]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]['whatsapp_status'], 'read')
        self.assertEqual(response.json()[0]['whatsapp_message_id'], 'wamid.read')

    async def test_text_requires_open_window_for_every_actual_recipient(self):
        customer = Customer(full_name='Ali', phone_number='03005556666', marketing_person_id=self.john.id)
        self.db.add(customer)
        self.db.query(IncomingMessage).filter(IncomingMessage.sender_number == '923005556666').update(
            {IncomingMessage.timestamp: datetime.now(timezone.utc) - timedelta(hours=25)})
        self.db.commit()
        calls = []
        class FakeService:
            recipient = '15551234567'
            def _configured(self, recipient): pass
            async def send_text(self, message, recipient):
                calls.append(recipient)
                return {'message_id': 'wamid.send'}
        with patch.object(settings, 'WHATSAPP_SEND_MODE', 'live'), patch('app.api.v1.endpoints.customer_dispatch.WhatsAppService', FakeService):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                selection = {'customer_id': customer.id, 'include_customer': True}
                status = await client.post('/api/v1/customer-dispatch/window-status', json=selection)
                self.assertEqual([r['open'] for r in status.json()['recipients']], [True, False])
                blocked = await client.post('/api/v1/customer-dispatch/text', json={**selection, 'message': 'Hello'})
                self.assertEqual(blocked.status_code, 409)
                self.assertEqual(calls, [])
                self.db.add(IncomingMessage(whatsapp_message_id='new-reply', sender_number='923005556666',
                                            message_type='text', timestamp=datetime.now(timezone.utc)))
                self.db.commit()
                self.assertTrue((await client.post('/api/v1/customer-dispatch/window-status', json=selection)).json()['all_open'])
                sent = await client.post('/api/v1/customer-dispatch/text', json={**selection, 'message': 'Hello'})
                self.assertEqual(sent.status_code, 200)
                self.assertEqual(calls, ['923001112222', '923005556666'])

    async def test_retry_text_rechecks_reply_window(self):
        self.db.query(IncomingMessage).delete()
        record = Dispatch(sender_id=self.user.id, send_mode='customer_dispatch', whatsapp_status='failed',
                          actual_recipient='923001112222', message_text='Hello')
        self.db.add(record); self.db.commit()
        with patch.object(settings, 'WHATSAPP_SEND_MODE', 'live'):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                response = await client.post(f'/api/v1/customer-dispatch/{record.id}/retry')
        self.assertEqual(response.status_code, 409)
        self.db.refresh(record)
        self.assertEqual(record.whatsapp_status, 'failed')

    async def test_manual_retry_only_resends_failed_destination(self):
        record = Dispatch(sender_id=self.user.id, send_mode="customer_dispatch", whatsapp_status="failed",
                          actual_recipient="923001112222", recipient_kind="marketing_person",
                          recipient_name="John", message_text="Original message", failure_reason="Rejected")
        self.db.add(record)
        self.db.commit()
        calls = []

        class FakeService:
            def _configured(self, recipient):
                pass

            async def send_text(self, message, recipient):
                calls.append((message, recipient))
                if len(calls) == 1:
                    raise WhatsAppError("Still rejected", 422)
                return {"message_id": "wamid.retry"}

        with patch.object(settings, "WHATSAPP_SEND_MODE", "live"), patch("app.api.v1.endpoints.customer_dispatch.WhatsAppService", FakeService):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                first = await client.post(f"/api/v1/customer-dispatch/{record.id}/retry")
                self.assertEqual((first.json()["status"], first.json()["error"]), ("failed", "Still rejected"))
                second = await client.post(f"/api/v1/customer-dispatch/{record.id}/retry")
                self.assertEqual(second.json()["status"], "accepted")
                third = await client.post(f"/api/v1/customer-dispatch/{record.id}/retry")
                self.assertEqual(third.status_code, 409)
        self.assertEqual(calls, [("Original message", "923001112222")] * 2)

    async def test_retry_reuses_original_attachment(self):
        with TemporaryDirectory() as directory:
            from pathlib import Path
            path = Path(directory) / "original.pdf"
            path.write_bytes(b"%PDF-test\n%%EOF")
            record = Dispatch(sender_id=self.user.id, send_mode="customer_dispatch", whatsapp_status="failed",
                              actual_recipient="923001112222", recipient_kind="marketing_person", recipient_name="John",
                              file_path=str(path), original_filename="bilty.pdf", message_text=None)
            self.db.add(record)
            self.db.commit()
            sent = []

            class FakeService:
                def _configured(self, recipient): pass
                async def prepare_file(self, upload, caption, recipient):
                    return PreparedMedia(await upload.read(), upload.filename, upload.content_type, "document", caption)
                def validate_media_template(self, prepared): pass
                async def send_template_file(self, prepared, recipient, recipient_name):
                    sent.append((prepared.data, prepared.filename, prepared.caption, recipient, recipient_name))
                    return {"message_id": "wamid.file"}

            with patch.object(settings, "WHATSAPP_SEND_MODE", "live"), patch.object(settings, "UPLOAD_DIR", directory), patch("app.api.v1.endpoints.customer_dispatch.WhatsAppService", FakeService):
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                    response = await client.post(f"/api/v1/customer-dispatch/{record.id}/retry")
            self.assertEqual(response.json()["status"], "accepted")
            self.assertEqual(sent, [(b"%PDF-test\n%%EOF", "bilty.pdf", None, "923001112222", "John")])

    async def test_customer_crud_search_and_reassignment(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            created = await client.post("/api/v1/customers/", json={
                "full_name": "Ali Traders", "phone_number": "", "city": "Lahore", "other_info": "Route A",
                "marketing_person_id": self.john.id,
            })
            self.assertEqual(created.status_code, 201)
            self.assertIsNone(created.json()["phone_number"])
            self.assertEqual(created.json()["marketing_person"]["full_name"], "John")
            customer_id = created.json()["id"]
            found = await client.get("/api/v1/customers/", params={"search": "Lahore"})
            self.assertEqual(found.json()["total"], 1)
            self.assertEqual(found.json()["items"][0]["id"], customer_id)
            updated = await client.put(f"/api/v1/customers/{customer_id}", json={
                "full_name": "Ali Traders", "phone_number": "923005556666", "city": None,
                "other_info": None, "marketing_person_id": self.sara.id,
            })
            self.assertEqual(updated.status_code, 200)
            self.assertEqual(updated.json()["marketing_person"]["full_name"], "Sara")
            deleted = await client.delete(f"/api/v1/customers/{customer_id}")
            self.assertEqual(deleted.status_code, 204)
            self.assertEqual((await client.get("/api/v1/customers/")).json()["total"], 0)

    async def test_live_send_routes_to_marketing_person_and_optional_customer(self):
        customer = Customer(full_name="Ali", phone_number="03005556666", marketing_person_id=self.john.id)
        self.db.add(customer)
        self.db.commit()
        calls = []

        class FakeService:
            recipient = "15551234567"

            def _configured(self, recipient):
                return None

            async def send_text(self, message, recipient):
                calls.append((message, recipient))
                return {"message_id": f"wamid.{len(calls)}", "status": "accepted"}

        with patch.object(settings, "WHATSAPP_SEND_MODE", "live"), patch("app.api.v1.endpoints.customer_dispatch.WhatsAppService", FakeService):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                first = await client.post("/api/v1/customer-dispatch/text", json={"customer_id": customer.id, "message": "Bilty ready"})
                second = await client.post("/api/v1/customer-dispatch/text", json={"customer_id": customer.id, "message": "Bilty copy", "include_customer": True})
        self.assertEqual(first.status_code, 200)
        self.assertEqual([item["recipient_kind"] for item in first.json()["results"]], ["marketing_person"])
        self.assertEqual(second.status_code, 200)
        self.assertEqual([item["recipient_kind"] for item in second.json()["results"]], ["marketing_person", "customer"])
        self.assertEqual(calls, [
            ("Bilty ready", "923001112222"), ("Bilty copy", "923001112222"), ("Bilty copy", "923005556666"),
        ])
        records = self.db.query(Dispatch).order_by(Dispatch.id).all()
        self.assertEqual([record.customer_name for record in records], ["Ali"] * 3)
        self.assertEqual([record.marketing_person_name for record in records], ["John"] * 3)
        filters = dict(search=None, from_date=None, to_date=None, from_time=None, to_time=None,
                       user_id=None, person_id=None, customer_id=None, dispatch_id=None, timezone_offset_minutes=0)
        self.assertEqual(len(dispatch_history(self.user, self.db, **{**filters, "customer_id": customer.id})), 3)
        self.assertEqual(len(dispatch_history(self.user, self.db, **{**filters, "person_id": self.john.id})), 2)
        customer.marketing_person_id = self.sara.id
        self.db.commit()
        self.assertEqual([record.marketing_person_name for record in records], ["John"] * 3)

    async def test_extra_recipients_send_once_each_and_are_searchable_in_history(self):
        ali = Customer(full_name="Ali", phone_number="03005556666", marketing_person_id=self.john.id)
        fatima = Customer(full_name="Fatima", phone_number="03007778888", marketing_person_id=self.sara.id)
        self.db.add_all([ali, fatima])
        self.db.commit()
        calls = []

        class FakeService:
            recipient = "15551234567"

            def _configured(self, recipient):
                return None

            async def send_text(self, message, recipient):
                calls.append(recipient)
                return {"message_id": f"wamid.{len(calls)}", "status": "accepted"}

        payload = {"customer_id": ali.id, "message": "Bilty", "include_customer": True,
                   "additional_marketing_person_ids": [self.sara.id, self.sara.id, self.john.id],
                   "additional_customer_ids": [fatima.id, fatima.id, ali.id]}
        with patch.object(settings, "WHATSAPP_SEND_MODE", "live"), patch("app.api.v1.endpoints.customer_dispatch.WhatsAppService", FakeService):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post("/api/v1/customer-dispatch/text", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(calls, ["923001112222", "923005556666", "923003334444", "923007778888"])
        self.assertEqual([item["recipient_name"] for item in response.json()["results"]], ["John", "Ali", "Sara", "Fatima"])
        records = self.db.query(Dispatch).order_by(Dispatch.id).all()
        self.assertEqual([record.recipient_customer_id for record in records], [None, ali.id, None, fatima.id])
        self.assertEqual([record.recipient_marketing_person_id for record in records], [self.john.id, None, self.sara.id, None])
        filters = dict(search=None, from_date=None, to_date=None, from_time=None, to_time=None,
                       user_id=None, person_id=None, customer_id=None, dispatch_id=None, timezone_offset_minutes=0)
        self.assertEqual(len(dispatch_history(self.user, self.db, **{**filters, "person_id": self.sara.id})), 1)
        self.assertEqual(len(dispatch_history(self.user, self.db, **{**filters, "customer_id": fatima.id})), 1)
        self.assertEqual([item.recipient_name for item in dispatch_history(self.user, self.db, **{**filters, "recipient_customer_id": ali.id})], ["Ali"])
        self.assertEqual([item.recipient_name for item in dispatch_history(self.user, self.db, **{**filters, "recipient_customer_id": fatima.id})], ["Fatima"])
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            customer_messages = await client.get("/api/v1/dispatch/history/page", params={"recipient_customer_id": ali.id})
        self.assertEqual(customer_messages.status_code, 200)
        self.assertEqual(customer_messages.json()["total"], 1)
        self.assertEqual(customer_messages.json()["items"][0]["recipient_name"], "Ali")

    async def test_customer_directory_filters_work_together(self):
        self.db.add_all([
            Customer(full_name="Ali", phone_number="03005556666", city="Lahore", marketing_person_id=self.john.id),
            Customer(full_name="No Phone", city="Lahore", marketing_person_id=self.john.id),
            Customer(full_name="Fatima", phone_number="03007778888", city="Karachi", marketing_person_id=self.sara.id),
        ])
        self.db.commit()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            options = await client.get("/api/v1/customers/filters")
            result = await client.get("/api/v1/customers/", params={"city": "LAHORE", "marketing_person_id": self.john.id, "phone_status": "without_phone"})
            no_phone = await client.get("/api/v1/customers/", params={"phone_status": "with_phone"})
        self.assertEqual(options.status_code, 200)
        self.assertEqual(options.json()["cities"], ["Karachi", "Lahore"])
        self.assertEqual(result.json()["total"], 1)
        self.assertEqual(result.json()["items"][0]["full_name"], "No Phone")
        self.assertEqual(no_phone.json()["total"], 2)

    async def test_test_mode_sends_every_extra_recipient_to_its_configured_number(self):
        ali = Customer(full_name="Ali", phone_number="03005556666", marketing_person_id=self.john.id)
        fatima = Customer(full_name="Fatima", phone_number="03007778888", marketing_person_id=self.sara.id)
        self.db.add_all([ali, fatima])
        self.db.commit()
        calls = []

        class FakeService:
            recipient = "15551234567"

            def _configured(self, recipient):
                return None

            async def send_text(self, message, recipient):
                calls.append(recipient)
                return {"message_id": f"wamid.{len(calls)}", "status": "accepted"}

        with patch.object(settings, "WHATSAPP_SEND_MODE", "test"), patch.object(settings, "WHATSAPP_CUSTOMER_TEST_RECIPIENT", "15557654321"), patch("app.api.v1.endpoints.customer_dispatch.WhatsAppService", FakeService):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post("/api/v1/customer-dispatch/text", json={
                    "customer_id": ali.id, "message": "Bilty", "include_customer": True,
                    "additional_marketing_person_ids": [self.sara.id], "additional_customer_ids": [fatima.id],
                })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(calls, ["15551234567", "15557654321", "15551234567", "15557654321"])
        self.assertEqual([item["recipient_kind"] for item in response.json()["results"]], ["test", "customer_test", "test", "customer_test"])

    async def test_phone_fields_reject_non_digit_characters(self):
        legacy = Customer(full_name="Legacy Customer", phone_number="+923001234567", marketing_person_id=self.john.id)
        self.db.add(legacy)
        self.db.commit()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            listed = await client.get("/api/v1/customers/")
            self.assertEqual(listed.status_code, 200)
            self.assertEqual(listed.json()["items"][0]["phone_number"], "+923001234567")
            for phone in ("+923001234567", "0300-1234567", "0300 1234567", "۰۳۰۰۱۲۳۴۵۶۷"):
                response = await client.post("/api/v1/customers/", json={"full_name": "Ali", "phone_number": phone, "marketing_person_id": self.john.id})
                self.assertEqual(response.status_code, 422, phone)
            response = await client.post("/api/v1/contacts/", json={"full_name": "Extra Person", "phone_number": "0300-1234567"})
            self.assertEqual(response.status_code, 422)

    async def test_test_mode_never_sends_customer_copy(self):
        customer = Customer(full_name="Ali", phone_number="+923005556666", marketing_person_id=self.john.id)
        self.db.add(customer)
        self.db.commit()
        calls = []

        class FakeService:
            recipient = "15551234567"

            def _configured(self, recipient):
                return None

            async def send_text(self, message, recipient):
                calls.append(recipient)
                return {"message_id": "wamid.test", "status": "accepted"}

        with patch.object(settings, "WHATSAPP_SEND_MODE", "test"), patch.object(settings, "WHATSAPP_CUSTOMER_TEST_RECIPIENT", ""), patch("app.api.v1.endpoints.customer_dispatch.WhatsAppService", FakeService):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                blocked = await client.post("/api/v1/customer-dispatch/text", json={"customer_id": customer.id, "message": "Copy", "include_customer": True})
                sent = await client.post("/api/v1/customer-dispatch/text", json={"customer_id": customer.id, "message": "Demo"})
        self.assertEqual(blocked.status_code, 422)
        self.assertEqual(sent.status_code, 200)
        self.assertEqual(sent.json()["results"][0]["recipient_kind"], "test")
        self.assertEqual(calls, ["15551234567"])

    async def test_test_mode_sends_optional_copy_to_second_configured_number(self):
        customer = Customer(full_name="Ali", phone_number=None, marketing_person_id=self.john.id)
        self.db.add(customer)
        self.db.commit()
        calls = []

        class FakeService:
            recipient = "15551234567"

            def _configured(self, recipient):
                return None

            async def send_text(self, message, recipient):
                calls.append(recipient)
                return {"message_id": f"wamid.{len(calls)}", "status": "accepted"}

        with patch.object(settings, "WHATSAPP_SEND_MODE", "test"), patch.object(settings, "WHATSAPP_CUSTOMER_TEST_RECIPIENT", "+15557654321"), patch("app.api.v1.endpoints.customer_dispatch.WhatsAppService", FakeService):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post("/api/v1/customer-dispatch/text", json={"customer_id": customer.id, "message": "Bilty", "include_customer": True})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls, ["15551234567", "15557654321"])
        self.assertEqual([item["recipient_kind"] for item in response.json()["results"]], ["test", "customer_test"])
        self.assertEqual([record.actual_recipient for record in self.db.query(Dispatch).order_by(Dispatch.id)], calls)

    async def test_test_mode_media_copy_uses_second_configured_number(self):
        customer = Customer(full_name="Ali", marketing_person_id=self.john.id)
        extra_customer = Customer(full_name="Fatima", phone_number="03007778888", marketing_person_id=self.sara.id)
        self.db.add_all([customer, extra_customer])
        self.db.query(IncomingMessage).delete()
        self.db.commit()
        calls = []

        class FakeService:
            recipient = "15551234567"

            def _configured(self, recipient):
                return None

            async def prepare_file(self, upload, caption, recipient):
                return PreparedMedia(b"%PDF-1.4\n%%EOF", "bilty.pdf", "application/pdf", "document", caption)

            def validate_media_template(self, prepared): pass

            async def send_template_file(self, prepared, recipient, recipient_name):
                calls.append((recipient, recipient_name))
                return {"message_id": f"wamid.media.{len(calls)}", "status": "accepted"}

        with TemporaryDirectory() as directory, patch.object(settings, "UPLOAD_DIR", directory), patch.object(settings, "WHATSAPP_SEND_MODE", "test"), patch.object(settings, "WHATSAPP_CUSTOMER_TEST_RECIPIENT", "+15557654321"), patch("app.api.v1.endpoints.customer_dispatch.WhatsAppService", FakeService):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post("/api/v1/customer-dispatch/media", data={
                    "customer_id": str(customer.id), "include_customer": "true",
                    "additional_marketing_person_ids": str(self.sara.id), "additional_customer_ids": str(extra_customer.id),
                }, files={"file": ("bilty.pdf", b"%PDF-1.4\n%%EOF", "application/pdf")})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls, [("15551234567", "John"), ("15557654321", "Ali"), ("15551234567", "Sara"), ("15557654321", "Fatima")])
        self.assertEqual(len(response.json()["results"]), 4)

    async def test_partial_failure_keeps_separate_destination_results(self):
        customer = Customer(full_name="Ali", phone_number="+923005556666", marketing_person_id=self.john.id)
        self.db.add(customer)
        self.db.commit()

        class FakeService:
            recipient = "15551234567"

            def _configured(self, recipient):
                return None

            async def send_text(self, message, recipient):
                if recipient == "923005556666":
                    raise WhatsAppError("Customer rejected", 422)
                return {"message_id": "wamid.marketing", "status": "accepted"}

        with patch.object(settings, "WHATSAPP_SEND_MODE", "live"), patch("app.api.v1.endpoints.customer_dispatch.WhatsAppService", FakeService):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post("/api/v1/customer-dispatch/text", json={"customer_id": customer.id, "message": "Bilty", "include_customer": True})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["status"] for item in response.json()["results"]], ["accepted", "failed"])
        self.assertEqual([record.whatsapp_status for record in self.db.query(Dispatch).order_by(Dispatch.id)], ["accepted", "failed"])

    async def test_missing_customer_phone_and_inactive_marketing_person_are_blocked(self):
        customer = Customer(full_name="Ali", marketing_person_id=self.john.id)
        self.db.add(customer)
        self.db.commit()
        with patch.object(settings, "WHATSAPP_SEND_MODE", "live"):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                missing_phone = await client.post("/api/v1/customer-dispatch/text", json={"customer_id": customer.id, "message": "Copy", "include_customer": True})
                self.john.is_active = False
                self.db.commit()
                inactive = await client.post("/api/v1/customer-dispatch/text", json={"customer_id": customer.id, "message": "Bilty"})
        self.assertEqual(missing_phone.status_code, 422)
        self.assertIn("no phone", missing_phone.json()["detail"])
        self.assertEqual(inactive.status_code, 422)
        self.assertEqual(self.db.query(Dispatch).count(), 0)
