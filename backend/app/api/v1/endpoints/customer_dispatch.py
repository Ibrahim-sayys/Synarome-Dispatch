"""Send a customer's bilty to their assigned marketing person, with an optional customer copy."""

import re
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, joinedload
from starlette.datastructures import Headers

from app.api.deps import CurrentUser, get_db
from app.config import settings
from app.models.customer import Customer
from app.models.dispatch import Dispatch
from app.models.marketing_person import MarketingPerson
from app.services.whatsapp_service import PreparedMedia, WhatsAppError, WhatsAppService
from app.services.whatsapp_window import window_expiry

router = APIRouter()


class RecipientSelection(BaseModel):
    customer_id: int = Field(ge=1)
    include_customer: bool = False
    additional_marketing_person_ids: list[int] = Field(default_factory=list, max_length=25)
    additional_customer_ids: list[int] = Field(default_factory=list, max_length=25)


class CustomerTextMessage(RecipientSelection):
    message: str = Field(min_length=1, max_length=4096)


@dataclass(frozen=True)
class Destination:
    kind: str
    name: str
    number: str
    customer_id: int | None = None
    marketing_person_id: int | None = None


class SendResult(BaseModel):
    record_id: int
    recipient_kind: str
    recipient_name: str
    actual_recipient: str
    status: str
    message_id: str | None = None
    error: str | None = None


class SendResponse(BaseModel):
    mode: str
    results: list[SendResult]


def _mode() -> str:
    mode = settings.WHATSAPP_SEND_MODE.strip().lower()
    if mode not in ("test", "live"):
        raise HTTPException(status_code=503, detail="WHATSAPP_SEND_MODE must be test or live.")
    return mode


def _number(phone: str) -> str:
    digits = phone.removeprefix("+")
    if digits.startswith("0"):
        country_code = settings.WHATSAPP_DEFAULT_COUNTRY_CODE.strip().removeprefix("+")
        if not re.fullmatch(r"[1-9]\d{0,3}", country_code):
            raise HTTPException(status_code=503, detail="Invalid default country code.")
        digits = country_code + digits[1:]
    if not re.fullmatch(r"[1-9]\d{6,14}", digits):
        raise HTTPException(status_code=422, detail="Recipient needs a valid international phone number.")
    return digits


def _destinations(
    db: Session, customer_id: int, include_customer: bool,
    additional_marketing_person_ids: list[int] | None = None,
    additional_customer_ids: list[int] | None = None,
):
    person_ids = list(dict.fromkeys(additional_marketing_person_ids or []))
    customer_ids = list(dict.fromkeys(additional_customer_ids or []))
    if len(person_ids) + len(customer_ids) > 25 or any(id_ < 1 for id_ in person_ids + customer_ids):
        raise HTTPException(status_code=422, detail="Select up to 25 valid additional recipients.")
    customer = db.query(Customer).options(joinedload(Customer.marketing_person)).filter(
        Customer.id == customer_id, Customer.is_deleted.is_(False)
    ).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found.")
    person = customer.marketing_person
    if not person or person.is_deleted or not person.is_active:
        raise HTTPException(status_code=422, detail="The assigned marketing person is inactive. Reassign the customer before sending.")
    destinations = [Destination("marketing_person", person.full_name, _number(person.phone_number), marketing_person_id=person.id)]
    if include_customer:
        if _mode() == "live" and not customer.phone_number:
            raise HTTPException(status_code=422, detail="This customer has no phone number for a customer copy.")
        destinations.append(Destination("customer", customer.full_name, _number(customer.phone_number) if customer.phone_number else "", customer_id=customer.id))
    person_ids = [id_ for id_ in person_ids if id_ != person.id]
    customer_ids = [id_ for id_ in customer_ids if id_ != customer.id]
    if person_ids:
        people = db.query(MarketingPerson).filter(MarketingPerson.id.in_(person_ids), MarketingPerson.is_deleted.is_(False), MarketingPerson.is_active.is_(True)).all()
        by_id = {item.id: item for item in people}
        if len(by_id) != len(person_ids):
            raise HTTPException(status_code=422, detail="An additional marketing person is missing or inactive.")
        destinations.extend(Destination("marketing_person", by_id[id_].full_name, _number(by_id[id_].phone_number), marketing_person_id=id_) for id_ in person_ids)
    if customer_ids:
        people = db.query(Customer).filter(Customer.id.in_(customer_ids), Customer.is_deleted.is_(False)).all()
        by_id = {item.id: item for item in people}
        if len(by_id) != len(customer_ids) or any(not by_id[id_].phone_number for id_ in customer_ids):
            raise HTTPException(status_code=422, detail="An additional customer is missing or has no phone number.")
        destinations.extend(Destination("customer", by_id[id_].full_name, _number(by_id[id_].phone_number), customer_id=id_) for id_ in customer_ids)
    if _mode() == "test" and any(item.kind == "customer" for item in destinations) and not settings.WHATSAPP_CUSTOMER_TEST_RECIPIENT.strip():
        raise HTTPException(status_code=422, detail="Set WHATSAPP_CUSTOMER_TEST_RECIPIENT to send customer test copies.")
    return customer, destinations


@router.get("/mode")
async def send_mode(current_user: CurrentUser):
    return {
        "mode": _mode(),
        "test_recipient": settings.WHATSAPP_TEST_RECIPIENT if _mode() == "test" else None,
        "customer_test_recipient": settings.WHATSAPP_CUSTOMER_TEST_RECIPIENT if _mode() == "test" else None,
    }


def _actual_destinations(destinations: list[Destination], mode: str) -> list[Destination]:
    return [Destination(
        'test' if d.kind == 'marketing_person' else 'customer_test', d.name,
        _number(settings.WHATSAPP_TEST_RECIPIENT.strip() if d.kind == 'marketing_person' else settings.WHATSAPP_CUSTOMER_TEST_RECIPIENT.strip()),
        d.customer_id, d.marketing_person_id,
    ) if mode == 'test' else d for d in destinations]


@router.post('/window-status')
def recipient_window_status(payload: RecipientSelection, current_user: CurrentUser, db: Session = Depends(get_db)):
    _, destinations = _destinations(db, payload.customer_id, payload.include_customer, payload.additional_marketing_person_ids, payload.additional_customer_ids)
    recipients = []
    for destination in _actual_destinations(destinations, _mode()):
        expiry = window_expiry(db, destination.number)
        recipients.append({'name': destination.name, 'number': destination.number, 'open': expiry is not None, 'expires_at': expiry})
    return {'all_open': all(item['open'] for item in recipients), 'recipients': recipients}


async def _send(
    db: Session, sender_id: int, customer: Customer, destinations: list[Destination],
    message: str | None, prepared: PreparedMedia | None = None, file_path: str | None = None,
) -> SendResponse:
    mode = _mode()
    service = WhatsAppService()
    try:
        service._configured(service.recipient if mode == "test" else destinations[0].number)
    except WhatsAppError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    actual_destinations = _actual_destinations(destinations, mode)
    if not prepared:
        closed = [d.name for d in actual_destinations if not window_expiry(db, d.number)]
        if closed:
            raise HTTPException(409, detail='Free-form messages require a reply in the last 24 hours from: ' + ', '.join(closed) + '. Use an approved attachment template instead.')
    results = []
    for destination in actual_destinations:
        kind, name, number = destination.kind, destination.name, destination.number
        record = Dispatch(
            sender_id=sender_id, customer_id=customer.id, marketing_person_id=customer.marketing_person_id,
            customer_name=customer.full_name, marketing_person_name=customer.marketing_person.full_name,
            recipient_name=name, recipient_customer_id=destination.customer_id,
            recipient_marketing_person_id=destination.marketing_person_id,
            recipient_kind=kind, actual_recipient=number, send_mode="customer_test" if mode == "test" else "customer_dispatch",
            message_text=message, file_path=file_path, original_filename=prepared.filename if prepared else None,
            whatsapp_status="pending",
        )
        try:
            db.add(record)
            db.commit()
            db.refresh(record)
        except SQLAlchemyError as exc:
            db.rollback()
            raise HTTPException(status_code=500, detail="Could not save dispatch record. No WhatsApp request was made for this destination.") from exc
        try:
            if not prepared and not window_expiry(db, number):
                raise WhatsAppError('The 24-hour reply window has closed. Use an approved attachment template.', 409)
            sent = await (service.send_template_file(prepared, number, name) if prepared else service.send_text(message or "", number))
            record.whatsapp_status = "accepted"
            record.whatsapp_message_id = sent["message_id"]
        except WhatsAppError as exc:
            record.whatsapp_status = "unknown" if exc.status_code == 504 else "failed"
            record.failure_reason = str(exc)
        try:
            db.commit()
        except SQLAlchemyError as exc:
            db.rollback()
            raise HTTPException(
                status_code=500,
                detail=f"WhatsApp result for dispatch #{record.id} could not be saved. Check Meta before retrying.",
            ) from exc
        results.append(SendResult(
            record_id=record.id, recipient_kind=kind, recipient_name=name, actual_recipient=number,
            status=record.whatsapp_status, message_id=record.whatsapp_message_id, error=record.failure_reason,
        ))
    return SendResponse(mode=mode, results=results)


@router.post("/text", response_model=SendResponse)
async def send_customer_text(payload: CustomerTextMessage, current_user: CurrentUser, db: Session = Depends(get_db)):
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=422, detail="Message cannot be empty.")
    customer, destinations = _destinations(db, payload.customer_id, payload.include_customer, payload.additional_marketing_person_ids, payload.additional_customer_ids)
    return await _send(db, current_user.id, customer, destinations, message)


@router.post("/{dispatch_id}/retry", response_model=SendResult)
async def retry_dispatch(dispatch_id: int, current_user: CurrentUser, db: Session = Depends(get_db)):
    record = db.get(Dispatch, dispatch_id)
    if not record or record.send_mode not in ("customer_dispatch", "customer_test"):
        raise HTTPException(404, "Dispatch not found.")
    if record.whatsapp_status != "failed":
        raise HTTPException(409, "Only failed dispatches can be retried.")
    if record.original_filename and not record.file_path:
        raise HTTPException(410, "The original attachment has been removed and cannot be retried.")
    if (record.send_mode == "customer_test") != (_mode() == "test"):
        raise HTTPException(409, "The sending mode has changed since this dispatch; send a new message instead.")
    number = _number(record.actual_recipient or "")
    if not record.file_path and not window_expiry(db, number):
        raise HTTPException(409, 'The 24-hour reply window has closed. Use an approved attachment template.')
    service = WhatsAppService()
    prepared = None
    try:
        service._configured(number)
        if record.file_path:
            path = Path(record.file_path).resolve()
            if not path.is_relative_to(Path(settings.UPLOAD_DIR).resolve()) or not path.is_file():
                raise HTTPException(404, "The original attachment is no longer available.")
            mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".pdf": "application/pdf"}.get(path.suffix.lower())
            with path.open("rb") as source:
                upload = UploadFile(file=source, filename=record.original_filename or path.name, headers=Headers({"content-type": mime or ""}))
                prepared = await service.prepare_file(upload, record.message_text, number)
                service.validate_media_template(prepared)
    except WhatsAppError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc

    claimed = db.query(Dispatch).filter(Dispatch.id == dispatch_id, Dispatch.whatsapp_status == "failed").update(
        {Dispatch.whatsapp_status: "pending", Dispatch.failure_reason: None, Dispatch.whatsapp_message_id: None}, synchronize_session=False
    )
    db.commit()
    if not claimed:
        raise HTTPException(409, "This dispatch is already being retried or has changed.")
    db.refresh(record)
    try:
        sent = await (service.send_template_file(prepared, number, record.recipient_name or "") if prepared else service.send_text(record.message_text or "", number))
        record.whatsapp_status = "accepted"
        record.whatsapp_message_id = sent["message_id"]
    except WhatsAppError as exc:
        record.whatsapp_status = "unknown" if exc.status_code == 504 else "failed"
        record.failure_reason = str(exc)
    db.commit()
    return SendResult(record_id=record.id, recipient_kind=record.recipient_kind or "", recipient_name=record.recipient_name or "",
                      actual_recipient=number, status=record.whatsapp_status, message_id=record.whatsapp_message_id, error=record.failure_reason)


@router.post("/media", response_model=SendResponse)
async def send_customer_media(
    current_user: CurrentUser, db: Session = Depends(get_db), file: UploadFile = File(...),
    customer_id: int = Form(...), include_customer: bool = Form(False), caption: str | None = Form(None),
    additional_marketing_person_ids: list[int] | None = Form(None), additional_customer_ids: list[int] | None = Form(None),
):
    path = None
    try:
        customer, destinations = _destinations(db, customer_id, include_customer, additional_marketing_person_ids, additional_customer_ids)
        service = WhatsAppService()
        recipient = service.recipient if _mode() == "test" else destinations[0].number
        prepared = await service.prepare_file(file, caption, recipient)
        service.validate_media_template(prepared)
        directory = Path(settings.UPLOAD_DIR)
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{uuid4().hex}{Path(prepared.filename).suffix.lower()}"
        path.write_bytes(prepared.data)
        return await _send(db, current_user.id, customer, destinations, prepared.caption or None, prepared, str(path))
    except WhatsAppError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    finally:
        await file.close()
