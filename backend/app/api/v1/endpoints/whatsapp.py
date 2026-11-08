"""Authenticated sends to Meta's single test recipient, recorded in dispatch history."""

import logging
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_db
from app.config import settings
from app.models.dispatch import Dispatch
from app.models.dispatch_recipient import DispatchRecipient
from app.models.marketing_person import MarketingPerson
from app.services.whatsapp_service import WhatsAppError, WhatsAppService

router = APIRouter()
logger = logging.getLogger(__name__)


class TextMessage(BaseModel):
    message: str = Field(min_length=1, max_length=4096)
    demo_contact_ids: list[int] = Field(default_factory=list)


class AcceptedMessage(BaseModel):
    message_id: str
    status: str
    record_id: int


def _http_error(exc: WhatsAppError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


def _selected_contact_ids(db: Session, ids: list[int]) -> list[int]:
    unique_ids = list(dict.fromkeys(ids))
    if any(contact_id < 1 for contact_id in unique_ids):
        raise HTTPException(status_code=422, detail="Select valid demo contacts.")
    if not unique_ids:
        return []
    found = {
        contact.id for contact in db.query(MarketingPerson)
        .filter(MarketingPerson.id.in_(unique_ids), MarketingPerson.is_active.is_(True), MarketingPerson.is_deleted.is_(False)).all()
    }
    if len(found) != len(unique_ids):
        raise HTTPException(status_code=422, detail="A selected demo contact is missing or inactive. Refresh the contact list.")
    return unique_ids


def _create_record(
    db: Session,
    sender_id: int,
    service: WhatsAppService,
    contact_ids: list[int],
    message: str | None,
    file_path: str | None = None,
    filename: str | None = None,
) -> Dispatch:
    record = Dispatch(
        sender_id=sender_id,
        message_text=message,
        file_path=file_path,
        original_filename=filename,
        send_mode="whatsapp_test",
        whatsapp_status="pending",
        actual_recipient=service.recipient,
    )
    try:
        db.add(record)
        db.flush()
        for contact_id in contact_ids:
            db.add(DispatchRecipient(
                dispatch_id=record.id,
                person_id=contact_id,
                delivery_status="demo_selected",
            ))
        db.commit()
        db.refresh(record)
    except SQLAlchemyError as exc:
        db.rollback()
        logger.error("Could not create WhatsApp test history record: %s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Could not save the test send. No WhatsApp request was made.") from exc
    return record


async def _submit(db: Session, record: Dispatch, operation) -> dict[str, str | int]:
    try:
        result = await operation
    except WhatsAppError as exc:
        record.whatsapp_status = "unknown" if exc.status_code == 504 else "failed"
        record.failure_reason = str(exc)
        try:
            db.commit()
        except SQLAlchemyError as db_exc:
            db.rollback()
            logger.error("Could not update failed WhatsApp test record %s: %s", record.id, type(db_exc).__name__)
        raise _http_error(exc) from exc

    record.whatsapp_status = "accepted"
    record.whatsapp_message_id = result["message_id"]
    try:
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        logger.error("Meta accepted WhatsApp test record %s but history update failed: %s", record.id, type(exc).__name__)
        raise HTTPException(
            status_code=500,
            detail=f"Meta accepted message {result['message_id']}, but history could not be updated. Check before retrying.",
        ) from exc
    return {**result, "record_id": record.id}


@router.post("/text", response_model=AcceptedMessage)
async def send_text(payload: TextMessage, current_user: CurrentUser, db: Session = Depends(get_db)):
    service = WhatsAppService()
    try:
        service._configured()
        message = payload.message.strip()
        if not message:
            raise WhatsAppError("Message cannot be empty.", 422)
    except WhatsAppError as exc:
        raise _http_error(exc) from exc
    contact_ids = _selected_contact_ids(db, payload.demo_contact_ids)
    record = _create_record(db, current_user.id, service, contact_ids, message)
    return await _submit(db, record, service.send_text(message))


@router.post("/media", response_model=AcceptedMessage)
async def send_media(
    current_user: CurrentUser,
    db: Session = Depends(get_db),
    file: UploadFile = File(...),
    caption: str | None = Form(default=None),
    demo_contact_ids: list[int] | None = Form(default=None),
):
    path: Path | None = None
    record: Dispatch | None = None
    try:
        service = WhatsAppService()
        prepared = await service.prepare_file(file, caption)
        contact_ids = _selected_contact_ids(db, demo_contact_ids or [])
        directory = Path(settings.UPLOAD_DIR)
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{uuid4().hex}{Path(prepared.filename).suffix.lower()}"
        path.write_bytes(prepared.data)
        record = _create_record(db, current_user.id, service, contact_ids, prepared.caption or None, str(path), prepared.filename)
        return await _submit(db, record, service.send_prepared_file(prepared))
    except WhatsAppError as exc:
        raise _http_error(exc) from exc
    except HTTPException:
        if path and path.exists() and record is None:
            path.unlink()
        raise
    except OSError as exc:
        if path and path.exists() and record is None:
            path.unlink()
        logger.error("Could not save WhatsApp test attachment: %s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="Could not save the test attachment. No WhatsApp request was made.") from exc
    finally:
        await file.close()
