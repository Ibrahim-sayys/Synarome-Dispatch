import io
import json
from tempfile import SpooledTemporaryFile, TemporaryDirectory
import unittest
from unittest.mock import patch

import httpx
from fastapi import UploadFile
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_user, get_db
from app.api.v1.endpoints.dispatch import dispatch_history
from app.config import settings
from app.database import Base
from app.main import app
from app.models.dispatch import Dispatch
from app.models.dispatch_recipient import DispatchRecipient
from app.models.marketing_person import MarketingPerson
from app.models.user import User, UserRole
from app.services import whatsapp_service as module
from app.services.whatsapp_service import WhatsAppError, WhatsAppService


def image_bytes(fmt: str) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (2, 2), "red").save(buffer, format=fmt)
    return buffer.getvalue()


def upload_file(filename: str, mime: str, data: bytes) -> UploadFile:
    stream = SpooledTemporaryFile(max_size=max(len(data) + 1, 1024))
    stream.write(data)
    stream.seek(0)
    return UploadFile(filename=filename, file=stream, headers={"content-type": mime})


class WhatsAppServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.patches = [
            patch.object(settings, "WHATSAPP_ACCESS_TOKEN", "fake-token"),
            patch.object(settings, "WHATSAPP_PHONE_NUMBER_ID", "123456"),
            patch.object(settings, "WHATSAPP_TEST_RECIPIENT", "+15551234567"),
            patch.object(settings, "WHATSAPP_API_VERSION", "v26.0"),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()

    async def _service(self, handler):
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        self.addAsyncCleanup(client.aclose)
        return WhatsAppService(client)

    async def test_text_uses_only_configured_recipient_and_bearer_token(self):
        def handler(request):
            self.assertEqual(request.url.path, "/v26.0/123456/messages")
            self.assertEqual(request.headers["authorization"], "Bearer fake-token")
            payload = json.loads(request.content)
            self.assertEqual(payload["to"], "15551234567")
            self.assertEqual(payload["type"], "text")
            self.assertEqual(payload["text"]["body"], "Bilty BLT-1025 dispatched")
            return httpx.Response(200, json={"messages": [{"id": "wamid.text"}]})

        result = await (await self._service(handler)).send_text(" Bilty BLT-1025 dispatched ")
        self.assertEqual(result, {"message_id": "wamid.text", "status": "accepted"})

    async def test_explicit_recipient_is_used_for_live_customer_dispatch(self):
        def handler(request):
            self.assertEqual(json.loads(request.content)["to"], "923001112222")
            return httpx.Response(200, json={"messages": [{"id": "wamid.live"}]})

        result = await (await self._service(handler)).send_text("Bilty", "923001112222")
        self.assertEqual(result["message_id"], "wamid.live")

    async def test_image_upload_then_one_captioned_message(self):
        paths = []

        def handler(request):
            paths.append(request.url.path)
            if request.url.path.endswith("/media"):
                self.assertIn(b"image/png", request.content)
                return httpx.Response(200, json={"id": "media-1"})
            payload = json.loads(request.content)
            self.assertEqual(payload["type"], "image")
            self.assertEqual(payload["image"], {"id": "media-1", "caption": "Bilty image"})
            return httpx.Response(200, json={"messages": [{"id": "wamid.image"}]})

        upload = upload_file("bilty.png", "image/png", image_bytes("PNG"))
        self.addCleanup(upload.file.close)
        result = await (await self._service(handler)).send_file(upload, "Bilty image")
        self.assertEqual(result["message_id"], "wamid.image")
        self.assertEqual(paths, ["/v26.0/123456/media", "/v26.0/123456/messages"])

    async def test_media_uses_explicit_live_recipient(self):
        def handler(request):
            if request.url.path.endswith("/media"):
                return httpx.Response(200, json={"id": "media-live"})
            self.assertEqual(json.loads(request.content)["to"], "923001112222")
            return httpx.Response(200, json={"messages": [{"id": "wamid.live-media"}]})

        service = await self._service(handler)
        upload = upload_file("bilty.png", "image/png", image_bytes("PNG"))
        self.addCleanup(upload.file.close)
        prepared = await service.prepare_file(upload, "Copy", "923001112222")
        result = await service.send_prepared_file(prepared, "923001112222")
        self.assertEqual(result["message_id"], "wamid.live-media")

    async def test_pdf_uses_safe_filename_and_no_duplicate_text(self):
        calls = []

        def handler(request):
            calls.append(request.url.path)
            if request.url.path.endswith("/media"):
                self.assertIn(b"invoice.pdf", request.content)
                return httpx.Response(200, json={"id": "media-2"})
            payload = json.loads(request.content)
            self.assertEqual(payload["type"], "document")
            self.assertEqual(payload["document"], {"id": "media-2", "caption": "PDF", "filename": "invoice.pdf"})
            return httpx.Response(200, json={"messages": [{"id": "wamid.pdf"}]})

        upload = upload_file("../invoice.pdf", "application/pdf", b"%PDF-1.4\n%%EOF")
        self.addCleanup(upload.file.close)
        await (await self._service(handler)).send_file(upload, "PDF")
        self.assertEqual(len(calls), 2)

    async def test_validation_blocks_bad_type_content_and_size_before_network(self):
        service = await self._service(lambda request: self.fail("Network should not be called"))
        cases = [
            ("bad.webp", "image/webp", b"bad", 415),
            ("fake.png", "image/png", b"not a png", 415),
            ("bad.pdf", "application/pdf", b"not a pdf", 415),
        ]
        for filename, mime, data, status in cases:
            with self.subTest(filename=filename):
                upload = upload_file(filename, mime, data)
                self.addCleanup(upload.file.close)
                with self.assertRaises(WhatsAppError) as raised:
                    await service.send_file(upload)
                self.assertEqual(raised.exception.status_code, status)
        with patch.object(module, "IMAGE_LIMIT", 3):
            upload = upload_file("large.png", "image/png", image_bytes("PNG"))
            self.addCleanup(upload.file.close)
            with self.assertRaises(WhatsAppError) as raised:
                await service.send_file(upload)
            self.assertEqual(raised.exception.status_code, 413)

    async def test_missing_credentials_meta_errors_and_malformed_response(self):
        with patch.object(settings, "WHATSAPP_ACCESS_TOKEN", ""):
            with self.assertRaises(WhatsAppError) as raised:
                await WhatsAppService().send_text("hello")
            self.assertEqual(raised.exception.status_code, 503)

        for code, expected in [(190, 502), (131030, 422), (131047, 409)]:
            with self.subTest(code=code):
                service = await self._service(lambda request: httpx.Response(400, json={"error": {"code": code, "message": "secret details"}}))
                with self.assertRaises(WhatsAppError) as raised:
                    await service.send_text("hello")
                self.assertEqual(raised.exception.status_code, expected)
                self.assertNotIn("secret details", str(raised.exception))

        service = await self._service(lambda request: httpx.Response(200, json={"messages": []}))
        with self.assertRaises(WhatsAppError):
            await service.send_text("hello")

    async def test_media_upload_failure_and_timeout(self):
        upload = upload_file("a.png", "image/png", image_bytes("PNG"))
        self.addCleanup(upload.file.close)
        service = await self._service(lambda request: httpx.Response(500, json={"error": {"code": 1}}))
        with self.assertRaises(WhatsAppError) as raised:
            await service.send_file(upload)
        self.assertIn("media", str(raised.exception))

        def timeout(request):
            raise httpx.ReadTimeout("timeout")

        service = await self._service(timeout)
        with self.assertRaises(WhatsAppError) as raised:
            await service.send_text("hello")
        self.assertEqual(raised.exception.status_code, 504)


class WhatsAppRouteTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.addCleanup(engine.dispose)
        self.db = Session(engine)
        self.addCleanup(self.db.close)
        self.user = User(username="tester", password_hash="unused", role=UserRole.USER)
        self.db.add(self.user)
        self.db.add_all([
            MarketingPerson(full_name="ABC Traders", phone_number="15550000001", is_active=True),
            MarketingPerson(full_name="Ibrahim", phone_number="15550000002", is_active=True),
        ])
        self.db.commit()

        async def fake_user():
            return self.user
        async def fake_db():
            yield self.db
        app.dependency_overrides[get_current_user] = fake_user
        app.dependency_overrides[get_db] = fake_db

    def tearDown(self):
        app.dependency_overrides.clear()

    async def test_route_translates_error_and_legacy_route_is_disabled(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            with patch.object(settings, "WHATSAPP_ACCESS_TOKEN", ""):
                response = await client.post("/api/v1/whatsapp/text", json={"message": "hello"})
            legacy = await client.post("/api/v1/dispatch/send")
        self.assertEqual(response.status_code, 503)
        self.assertIn("missing", response.json()["detail"])
        self.assertEqual(legacy.status_code, 410)

    async def test_media_route_rejects_unsupported_file(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            with patch.object(settings, "WHATSAPP_ACCESS_TOKEN", "token"), patch.object(settings, "WHATSAPP_PHONE_NUMBER_ID", "123"), patch.object(settings, "WHATSAPP_TEST_RECIPIENT", "15551234567"):
                response = await client.post("/api/v1/whatsapp/media", files={"file": ("bad.gif", b"GIF89a", "image/gif")})
        self.assertEqual(response.status_code, 415)

    async def test_text_route_returns_meta_acceptance_without_recipient_or_token(self):
        existing = Dispatch(sender_id=self.user.id, message_text="Existing dispatch")
        self.db.add(existing)
        self.db.flush()
        self.db.add(DispatchRecipient(dispatch_id=existing.id, person_id=2, delivery_status="sent"))
        self.db.commit()

        class FakeService:
            recipient = "15551234567"

            def _configured(self):
                return None

            async def send_text(self, message):
                self.message = message
                return {"message_id": "wamid.route", "status": "accepted"}

        with patch("app.api.v1.endpoints.whatsapp.WhatsAppService", FakeService):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post("/api/v1/whatsapp/text", json={"message": "hello", "demo_contact_ids": [1, 2]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["message_id"], "wamid.route")
        history = dispatch_history(self.user, self.db, None, None, None, None, None, None, None)
        contact_history = dispatch_history(self.user, self.db, None, None, None, None, None, None, 1)
        self.assertEqual(len(history), 2)
        self.assertEqual(len(contact_history), 1)
        self.assertEqual({item.id for item in history}, {existing.id, response.json()["record_id"]})
        test_record = next(item for item in history if item.id == response.json()["record_id"])
        self.assertEqual(test_record.whatsapp_status, "accepted")
        self.assertEqual(test_record.sender.username, "tester")
        record = self.db.get(Dispatch, response.json()["record_id"])
        self.assertEqual(record.send_mode, "whatsapp_test")
        self.assertEqual(record.whatsapp_status, "accepted")
        self.assertEqual(record.actual_recipient, "15551234567")
        self.assertEqual(record.whatsapp_message_id, "wamid.route")
        recipients = self.db.query(DispatchRecipient).filter_by(dispatch_id=record.id).all()
        self.assertEqual({recipient.person_id for recipient in recipients}, {1, 2})
        self.assertEqual({recipient.delivery_status for recipient in recipients}, {"demo_selected"})

    async def test_meta_failure_is_retained_but_hidden_from_history(self):
        class FailingService:
            recipient = "15551234567"

            def _configured(self):
                return None

            async def send_text(self, message):
                raise WhatsAppError("Window closed", 409)

        with patch("app.api.v1.endpoints.whatsapp.WhatsAppService", FailingService):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post("/api/v1/whatsapp/text", json={"message": "hello"})
        self.assertEqual(response.status_code, 409)
        record = self.db.query(Dispatch).one()
        self.assertEqual(record.whatsapp_status, "failed")
        self.assertEqual(record.failure_reason, "Window closed")
        self.assertEqual(dispatch_history(self.user, self.db, None, None, None, None, None, None, None), [])

    async def test_image_record_keeps_file_for_existing_history_download(self):
        class FakeService(WhatsAppService):
            async def send_prepared_file(self, prepared):
                return {"message_id": "wamid.image", "status": "accepted"}

        with TemporaryDirectory() as directory, patch.object(settings, "UPLOAD_DIR", directory), patch.object(settings, "WHATSAPP_ACCESS_TOKEN", "token"), patch.object(settings, "WHATSAPP_PHONE_NUMBER_ID", "123456"), patch.object(settings, "WHATSAPP_TEST_RECIPIENT", "15551234567"), patch("app.api.v1.endpoints.whatsapp.WhatsAppService", FakeService):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post("/api/v1/whatsapp/media", data={"caption": "Bilty image", "demo_contact_ids": "1"}, files={"file": ("bilty.png", image_bytes("PNG"), "image/png")})
            self.assertEqual(response.status_code, 200)
            record = self.db.get(Dispatch, response.json()["record_id"])
            self.assertEqual(record.original_filename, "bilty.png")
            self.assertEqual(record.message_text, "Bilty image")
            self.assertEqual(record.whatsapp_status, "accepted")
            from pathlib import Path
            self.assertEqual(Path(record.file_path).read_bytes(), image_bytes("PNG"))

    async def test_route_requires_application_authentication(self):
        app.dependency_overrides.clear()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/whatsapp/text", json={"message": "hello"})
        self.assertEqual(response.status_code, 401)
