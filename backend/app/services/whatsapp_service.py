"""Outgoing messages to Meta's single configured WhatsApp test recipient."""

import logging
from dataclasses import dataclass
from io import BytesIO
import re
from pathlib import PurePath
from typing import Any

import httpx
from fastapi import UploadFile
from PIL import Image, UnidentifiedImageError

from app.config import settings

logger = logging.getLogger(__name__)
IMAGE_LIMIT = 5 * 1024 * 1024
DOCUMENT_LIMIT = 100 * 1024 * 1024
TEXT_LIMIT = 4096
CAPTION_LIMIT = 1024


@dataclass(frozen=True)
class PreparedMedia:
    data: bytes
    filename: str
    mime: str
    kind: str
    caption: str


class WhatsAppError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


class WhatsAppService:
    def __init__(self, client: httpx.AsyncClient | None = None):
        self.client = client
        self.token = settings.WHATSAPP_ACCESS_TOKEN.strip()
        self.phone_id = settings.WHATSAPP_PHONE_NUMBER_ID.strip()
        self.recipient = settings.WHATSAPP_TEST_RECIPIENT.strip().removeprefix("+")
        version = settings.WHATSAPP_API_VERSION.strip()
        if not re.fullmatch(r"v\d+\.\d+", version):
            raise WhatsAppError("Invalid WHATSAPP_API_VERSION configuration.", 503)
        self.base_url = f"https://graph.facebook.com/{version}/{self.phone_id}"

    def _configured(self, recipient: str | None = None) -> None:
        if not self.token or not self.phone_id or not re.fullmatch(r"[1-9]\d{6,14}", recipient or self.recipient):
            raise WhatsAppError("WhatsApp credentials or recipient are missing or invalid. Check backend environment variables.", 503)
        if not self.phone_id.isdigit():
            raise WhatsAppError("Invalid WhatsApp phone number ID configuration.", 503)

    async def send_text(self, message: str, recipient: str | None = None) -> dict[str, str]:
        self._configured(recipient)
        message = message.strip()
        if not message or len(message) > TEXT_LIMIT:
            raise WhatsAppError(f"Message must contain 1 to {TEXT_LIMIT} characters.", 422)
        return await self._send("text", {"body": message, "preview_url": False}, recipient)

    async def send_file(self, upload: UploadFile, caption: str | None = None) -> dict[str, str]:
        prepared = await self.prepare_file(upload, caption)
        return await self.send_prepared_file(prepared)

    async def prepare_file(self, upload: UploadFile, caption: str | None = None, recipient: str | None = None) -> PreparedMedia:
        self._configured(recipient)
        caption = (caption or "").strip()
        if len(caption) > CAPTION_LIMIT:
            raise WhatsAppError(f"Caption cannot exceed {CAPTION_LIMIT} characters.", 422)
        filename = self._safe_filename(upload.filename)
        suffix = PurePath(filename).suffix.lower()
        mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".pdf": "application/pdf"}.get(suffix)
        if not mime or upload.content_type != mime:
            raise WhatsAppError("Use a JPG, PNG, or PDF file with the matching file type.", 415)
        limit = DOCUMENT_LIMIT if mime == "application/pdf" else IMAGE_LIMIT
        data = await upload.read(limit + 1)
        if len(data) > limit:
            raise WhatsAppError(f"File exceeds the {limit // (1024 * 1024)} MB WhatsApp limit.", 413)
        if not self._valid_content(data, mime):
            raise WhatsAppError("File contents do not match a valid JPG, PNG, or PDF.", 415)
        return PreparedMedia(data, filename, mime, "document" if mime == "application/pdf" else "image", caption)

    async def send_prepared_file(self, prepared: PreparedMedia, recipient: str | None = None) -> dict[str, str]:
        self._configured(recipient)
        response = await self._post("media", data={"messaging_product": "whatsapp", "type": prepared.mime}, files={"file": (prepared.filename, prepared.data, prepared.mime)}, timeout=90)
        media_id = response.get("id")
        if not isinstance(media_id, str) or not media_id:
            raise WhatsAppError("Meta accepted the upload but returned no media ID.")
        media: dict[str, str] = {"id": media_id}
        if prepared.caption:
            media["caption"] = prepared.caption
        if prepared.kind == "document":
            media["filename"] = prepared.filename
        return await self._send(prepared.kind, media, recipient)

    def validate_media_template(self, prepared: PreparedMedia) -> tuple[str, str, str]:
        prefix = "IMAGE" if prepared.kind == "image" else "DOCUMENT"
        name = getattr(settings, f"WHATSAPP_{prefix}_TEMPLATE_NAME").strip()
        language = getattr(settings, f"WHATSAPP_{prefix}_TEMPLATE_LANGUAGE").strip()
        parameter_name = getattr(settings, f"WHATSAPP_{prefix}_TEMPLATE_NAME_PARAMETER").strip()
        if not name or not language or name.startswith("replace_with_") or language.startswith("replace_with_"):
            raise WhatsAppError(f"Configure the approved {prefix.lower()} template name and language in the backend environment.", 503)
        if prepared.caption:
            raise WhatsAppError("The attachment template contains a recipient name only. Remove the typed message before sending the attachment.", 422)
        if parameter_name and not re.fullmatch(r"[a-z][a-z0-9_]*", parameter_name):
            raise WhatsAppError(
                f"Invalid WHATSAPP_{prefix}_TEMPLATE_NAME_PARAMETER: leave it empty for {{{{1}}}}, "
                "or enter the exact lowercase variable name without braces (for example customer_name).", 503
            )
        return name, language, parameter_name

    async def send_template_file(self, prepared: PreparedMedia, recipient: str | None = None, recipient_name: str = "") -> dict[str, str]:
        self._configured(recipient)
        name, language, parameter_name = self.validate_media_template(prepared)
        recipient_name = recipient_name.strip()
        if not recipient_name:
            raise WhatsAppError("The recipient needs a name for the WhatsApp template.", 422)
        response = await self._post("media", data={"messaging_product": "whatsapp", "type": prepared.mime},
                                    files={"file": (prepared.filename, prepared.data, prepared.mime)}, timeout=90)
        media_id = response.get("id")
        if not isinstance(media_id, str) or not media_id:
            raise WhatsAppError("Meta accepted the upload but returned no media ID.")
        media = {"id": media_id}
        if prepared.kind == "document":
            media["filename"] = prepared.filename
        components: list[dict[str, Any]] = [{"type": "header", "parameters": [{"type": prepared.kind, prepared.kind: media}]}]
        parameter = {"type": "text", "text": recipient_name}
        if parameter_name:
            parameter["parameter_name"] = parameter_name
        components.append({"type": "body", "parameters": [parameter]})
        return await self._send("template", {"name": name, "language": {"code": language}, "components": components}, recipient)

    async def _send(self, kind: str, content: dict[str, Any], recipient: str | None = None) -> dict[str, str]:
        response = await self._post("messages", json={"messaging_product": "whatsapp", "recipient_type": "individual", "to": recipient or self.recipient, "type": kind, kind: content}, timeout=30)
        messages = response.get("messages")
        message_id = messages[0].get("id") if isinstance(messages, list) and messages and isinstance(messages[0], dict) else None
        if not isinstance(message_id, str) or not message_id:
            raise WhatsAppError("Meta returned an unexpected message response. Check Meta logs before retrying.")
        return {"message_id": message_id, "status": "accepted"}

    async def _post(self, resource: str, **kwargs: Any) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {self.token}"}
        try:
            if self.client is None:
                async with httpx.AsyncClient() as client:
                    response = await client.post(f"{self.base_url}/{resource}", headers=headers, **kwargs)
            else:
                response = await self.client.post(f"{self.base_url}/{resource}", headers=headers, **kwargs)
        except httpx.TimeoutException as exc:
            logger.warning("WhatsApp %s timed out", resource)
            raise WhatsAppError("Meta did not respond in time. Check the message in WhatsApp before retrying.", 504) from exc
        except httpx.RequestError as exc:
            logger.warning("WhatsApp %s connectivity failure: %s", resource, type(exc).__name__)
            raise WhatsAppError("Could not connect to Meta. Check internet access and try again.", 502) from exc
        if response.is_error:
            try:
                error = response.json().get("error", {})
                code = error.get("code") if isinstance(error, dict) else None
            except (ValueError, TypeError, AttributeError):
                code = None
            logger.warning("WhatsApp %s failed: HTTP %s, Meta code %s", resource, response.status_code, code)
            if code == 131047:
                raise WhatsAppError("The WhatsApp customer-service window is closed for this recipient. Check the recipient conversation before retrying.", 409)
            if response.status_code in (401, 403) or code in (190, 200):
                raise WhatsAppError("Meta rejected the access token. Refresh WHATSAPP_ACCESS_TOKEN and restart the backend.", 502)
            if code in (131030, 131026):
                raise WhatsAppError("Meta could not send to this recipient. Check the phone number and WhatsApp recipient eligibility.", 422)
            raise WhatsAppError(f"Meta rejected the WhatsApp {resource} request (HTTP {response.status_code}, code {code or 'unknown'}).")
        try:
            body = response.json()
        except ValueError as exc:
            raise WhatsAppError("Meta returned an unreadable response. Check Meta logs before retrying.") from exc
        if not isinstance(body, dict):
            raise WhatsAppError("Meta returned an unexpected response. Check Meta logs before retrying.")
        return body

    @staticmethod
    def _safe_filename(name: str | None) -> str:
        filename = (name or "").replace("\\", "/").split("/")[-1]
        filename = re.sub(r"[^A-Za-z0-9._ -]", "_", filename).strip(" .")[:180]
        if not filename or filename.startswith("."):
            raise WhatsAppError("Choose a file with a valid filename.", 422)
        return filename

    @staticmethod
    def _valid_content(data: bytes, mime: str) -> bool:
        if mime == "image/jpeg":
            expected = "JPEG"
            signature_valid = len(data) > 4 and data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9")
        if mime == "image/png":
            expected = "PNG"
            signature_valid = len(data) > 24 and data.startswith(b"\x89PNG\r\n\x1a\n") and b"IEND" in data[-20:]
        if mime == "application/pdf":
            return data.startswith(b"%PDF-") and b"%%EOF" in data[-1024:]
        if not signature_valid:
            return False
        try:
            with Image.open(BytesIO(data)) as image:
                if image.format != expected:
                    return False
                image.verify()
            return True
        except (UnidentifiedImageError, OSError, ValueError, SyntaxError):
            return False
