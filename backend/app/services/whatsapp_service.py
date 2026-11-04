from pathlib import Path
from typing import Any

import httpx

from app.config import settings


class WhatsAppConfigurationError(RuntimeError):
    pass


class WhatsAppService:
    def __init__(self) -> None:
        self.api_url = settings.WHATSAPP_API_URL.rstrip("/")
        self.token = settings.WHATSAPP_API_TOKEN
        self.phone_number_id = settings.WHATSAPP_PHONE_NUMBER_ID
        self.dry_run = settings.WHATSAPP_DRY_RUN

    @property
    def is_configured(self) -> bool:
        return bool(self.api_url and self.token and self.phone_number_id)

    def send_text_message(self, phone_number: str, message: str) -> dict[str, Any]:
        if self.dry_run:
            return {"id": "dry-run", "status": "sent"}
        self._require_configuration()

        return self._post_message(
            {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": self._format_phone_number(phone_number),
                "type": "text",
                "text": {
                    "preview_url": False,
                    "body": message,
                },
            }
        )

    def send_document_message(
        self,
        phone_number: str,
        file_path: Path,
        filename: str,
        caption: str | None = None,
        content_type: str | None = None,
    ) -> dict[str, Any]:
        if self.dry_run:
            return {"id": "dry-run", "status": "sent"}
        self._require_configuration()

        media_id = self.upload_media(file_path, content_type)
        document: dict[str, Any] = {
            "id": media_id,
            "filename": filename,
        }
        if caption:
            document["caption"] = caption

        return self._post_message(
            {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": self._format_phone_number(phone_number),
                "type": "document",
                "document": document,
            }
        )

    def upload_media(self, file_path: Path, content_type: str | None = None) -> str:
        self._require_configuration()
        url = f"{self.api_url}/{self.phone_number_id}/media"

        with file_path.open("rb") as file:
            response = httpx.post(
                url,
                headers=self._headers(),
                data={"messaging_product": "whatsapp", "type": content_type or "application/octet-stream"},
                files={"file": (file_path.name, file, content_type or "application/octet-stream")},
                timeout=60,
            )

        self._raise_for_response(response)
        media_id = response.json().get("id")
        if not media_id:
            raise RuntimeError("WhatsApp media upload did not return a media id")
        return media_id

    def _post_message(self, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.api_url}/{self.phone_number_id}/messages"
        response = httpx.post(
            url,
            headers={**self._headers(), "Content-Type": "application/json"},
            json=payload,
            timeout=30,
        )
        self._raise_for_response(response)

        body = response.json()
        messages = body.get("messages") or []
        message_id = messages[0].get("id") if messages else None
        return {"id": message_id, "status": "sent", "response": body}

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    @staticmethod
    def _format_phone_number(phone_number: str) -> str:
        return phone_number.strip().removeprefix("+")

    def _require_configuration(self) -> None:
        if not self.is_configured:
            raise WhatsAppConfigurationError(
                "WhatsApp Cloud API is not configured. Set WHATSAPP_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID."
            )

    @staticmethod
    def _raise_for_response(response: httpx.Response) -> None:
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text
            raise RuntimeError(f"WhatsApp Cloud API request failed: {detail}") from exc
