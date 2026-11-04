from datetime import date, datetime, time, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.api.deps import CurrentUser, get_db
from app.models.dispatch import Dispatch
from app.models.dispatch_recipient import DispatchRecipient
from app.models.marketing_person import MarketingPerson
from app.schemas.dispatch import DispatchResponse, DispatchStatsResponse
from app.services.file_service import save_upload_file
from app.services.whatsapp_service import WhatsAppConfigurationError, WhatsAppService
from app.utils.validators import is_allowed_file

router = APIRouter()


@router.post("/send", response_model=DispatchResponse, status_code=status.HTTP_201_CREATED)
def send_dispatch(
    current_user: CurrentUser,
    db: Session = Depends(get_db),
    recipient_ids: list[int] = Form(...),
    message_text: str | None = Form(default=None),
    file: UploadFile | None = File(default=None),
):
    if not recipient_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Select at least one recipient",
        )

    message = message_text.strip() if message_text else None
    if not message and not file:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide a message or a file",
        )

    if file and file.content_type and not is_allowed_file(file.content_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File type is not allowed",
        )

    contacts = (
        db.query(MarketingPerson)
        .filter(
            MarketingPerson.id.in_(recipient_ids),
            MarketingPerson.is_active.is_(True),
        )
        .order_by(MarketingPerson.full_name.asc())
        .all()
    )
    found_ids = {contact.id for contact in contacts}
    missing_ids = [recipient_id for recipient_id in recipient_ids if recipient_id not in found_ids]
    if missing_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Recipients are inactive or not found: {', '.join(str(item) for item in missing_ids)}",
        )

    saved_file_path: Path | None = save_upload_file(file) if file else None
    dispatch = Dispatch(
        sender_id=current_user.id,
        file_path=str(saved_file_path) if saved_file_path else None,
        message_text=message,
    )
    db.add(dispatch)
    db.flush()

    whatsapp = WhatsAppService()
    for contact in contacts:
        recipient = DispatchRecipient(
            dispatch_id=dispatch.id,
            person_id=contact.id,
            delivery_status="pending",
        )
        db.add(recipient)

        try:
            if saved_file_path and file:
                whatsapp.send_document_message(
                    phone_number=contact.phone_number,
                    file_path=saved_file_path,
                    filename=file.filename or saved_file_path.name,
                    caption=message,
                    content_type=file.content_type,
                )
            else:
                whatsapp.send_text_message(contact.phone_number, message or "")
            recipient.delivery_status = "sent"
        except WhatsAppConfigurationError:
            recipient.delivery_status = "not_configured"
        except Exception:
            recipient.delivery_status = "failed"

    db.commit()
    db.refresh(dispatch)

    return _get_dispatch(db, dispatch.id)


@router.get("/history", response_model=list[DispatchResponse])
def dispatch_history(
    current_user: CurrentUser,
    db: Session = Depends(get_db),
    search: str | None = Query(default=None, max_length=100),
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    from_time: time | None = Query(default=None),
    to_time: time | None = Query(default=None),
    user_id: int | None = Query(default=None, ge=1),
    person_id: int | None = Query(default=None, ge=1),
):
    query = db.query(Dispatch).options(
        joinedload(Dispatch.sender),
        joinedload(Dispatch.recipients).joinedload(DispatchRecipient.person),
    )

    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.outerjoin(Dispatch.sender).outerjoin(Dispatch.recipients).outerjoin(DispatchRecipient.person)
        query = query.filter(
            or_(
                Dispatch.message_text.ilike(pattern),
                MarketingPerson.full_name.ilike(pattern),
                MarketingPerson.phone_number.ilike(pattern),
            )
        )

    if user_id:
        query = query.filter(Dispatch.sender_id == user_id)
    if person_id:
        query = query.filter(Dispatch.recipients.any(DispatchRecipient.person_id == person_id))

    if from_date:
        query = query.filter(Dispatch.timestamp >= datetime.combine(from_date, from_time or time.min))
    elif from_time:
        query = query.filter(func.time(Dispatch.timestamp) >= from_time.strftime("%H:%M:%S"))

    if to_date:
        query = query.filter(Dispatch.timestamp <= datetime.combine(to_date, to_time or time.max))
    elif to_time:
        query = query.filter(func.time(Dispatch.timestamp) <= to_time.strftime("%H:%M:%S"))

    return query.distinct().order_by(Dispatch.timestamp.desc(), Dispatch.id.desc()).limit(100).all()


@router.get("/stats", response_model=DispatchStatsResponse)
def dispatch_stats(
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    today_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)

    total_dispatches = db.query(func.count(Dispatch.id)).scalar() or 0
    total_messages = db.query(func.count(DispatchRecipient.id)).scalar() or 0
    messages_sent = (
        db.query(func.count(DispatchRecipient.id))
        .filter(DispatchRecipient.delivery_status == "sent")
        .scalar()
        or 0
    )
    messages_failed = (
        db.query(func.count(DispatchRecipient.id))
        .filter(DispatchRecipient.delivery_status.in_(["failed", "not_configured"]))
        .scalar()
        or 0
    )

    today_dispatches = (
        db.query(func.count(Dispatch.id))
        .filter(Dispatch.timestamp >= today_start)
        .scalar()
        or 0
    )
    today_messages = (
        db.query(func.count(DispatchRecipient.id))
        .join(Dispatch, DispatchRecipient.dispatch_id == Dispatch.id)
        .filter(Dispatch.timestamp >= today_start)
        .scalar()
        or 0
    )

    total_contacts = db.query(func.count(MarketingPerson.id)).scalar() or 0
    active_contacts = (
        db.query(func.count(MarketingPerson.id))
        .filter(MarketingPerson.is_active.is_(True))
        .scalar()
        or 0
    )

    delivery_rate = round((messages_sent / total_messages * 100), 1) if total_messages > 0 else 100.0

    recent_dispatches = (
        db.query(Dispatch)
        .options(
            joinedload(Dispatch.sender),
            joinedload(Dispatch.recipients).joinedload(DispatchRecipient.person),
        )
        .order_by(Dispatch.timestamp.desc(), Dispatch.id.desc())
        .limit(5)
        .all()
    )

    return DispatchStatsResponse(
        total_dispatches=total_dispatches,
        total_messages=total_messages,
        messages_sent=messages_sent,
        messages_failed=messages_failed,
        today_dispatches=today_dispatches,
        today_messages=today_messages,
        total_contacts=total_contacts,
        active_contacts=active_contacts,
        delivery_rate=delivery_rate,
        recent_dispatches=recent_dispatches,
    )


@router.get("/{dispatch_id}/file")
def download_dispatch_file(
    dispatch_id: int,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    dispatch = db.get(Dispatch, dispatch_id)
    if not dispatch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispatch not found")

    if not dispatch.file_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispatch has no file")

    path = Path(dispatch.file_path)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File is missing from storage")

    return FileResponse(
        path,
        filename=path.name,
        media_type="application/octet-stream",
    )


def _get_dispatch(db: Session, dispatch_id: int) -> Dispatch:
    dispatch = (
        db.query(Dispatch)
        .options(
            joinedload(Dispatch.sender),
            joinedload(Dispatch.recipients).joinedload(DispatchRecipient.person),
        )
        .filter(Dispatch.id == dispatch_id)
        .first()
    )
    if not dispatch:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dispatch not found",
        )
    return dispatch
