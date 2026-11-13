from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy import and_, extract, func, or_
from sqlalchemy.orm import Session, joinedload

from app.api.deps import CurrentUser, get_db
from app.models.dispatch import Dispatch
from app.models.dispatch_recipient import DispatchRecipient
from app.models.marketing_person import MarketingPerson
from app.models.user import User
from app.schemas.dispatch import DispatchHistoryPageResponse, DispatchResponse, DispatchStatsResponse, HistorySenderResponse

router = APIRouter()


def _local_seconds(timestamp, offset_minutes: int):
    """Time of day in the browser's local offset, for date-free time filters."""
    utc_seconds = extract("hour", timestamp) * 3600 + extract("minute", timestamp) * 60 + extract("second", timestamp)
    return (utc_seconds - offset_minutes * 60 + 86400) % 86400


def _time_seconds(value: time) -> int:
    return value.hour * 3600 + value.minute * 60 + value.second


def _utc_boundary(local_value: datetime, offset_minutes: int) -> datetime:
    return (local_value + timedelta(minutes=offset_minutes)).replace(tzinfo=timezone.utc)


def _successful_dispatches():
    """Show customer send attempts, accepted demos, and successful legacy sends."""
    return or_(
        Dispatch.send_mode.in_(["customer_dispatch", "customer_test"]),
        and_(Dispatch.send_mode == "whatsapp_test", Dispatch.whatsapp_status == "accepted"),
        and_(
            Dispatch.send_mode == "contact",
            Dispatch.recipients.any(DispatchRecipient.delivery_status == "sent"),
            ~Dispatch.recipients.any(or_(
                DispatchRecipient.delivery_status != "sent",
                DispatchRecipient.delivery_status.is_(None),
            )),
        ),
    )


@router.post("/send", status_code=status.HTTP_410_GONE)
async def send_dispatch(current_user: CurrentUser):
    """Prevent the former contact-targeted route from sending during test mode."""
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Contact dispatch sending is disabled in WhatsApp test mode. Use /api/v1/whatsapp/text or /media; only the configured test recipient is allowed.",
    )


@router.get("/senders", response_model=list[HistorySenderResponse])
def history_senders(current_user: CurrentUser, db: Session = Depends(get_db)):
    return db.query(User).filter(User.is_active.is_(True)).order_by(User.username.asc()).all()


def _history_query(
    db: Session, search: str | None, from_date: date | None, to_date: date | None,
    from_time: time | None, to_time: time | None, user_id: int | None,
    person_id: int | None, customer_id: int | None, dispatch_id: int | None,
    timezone_offset_minutes: int, recipient_customer_id: int | None = None,
):
    if dispatch_id is not None and dispatch_id < 1:
        raise HTTPException(status_code=422, detail="Invalid dispatch ID")
    if recipient_customer_id is not None and recipient_customer_id < 1:
        raise HTTPException(status_code=422, detail="Invalid recipient customer ID")
    if not -840 <= timezone_offset_minutes <= 840:
        raise HTTPException(status_code=422, detail="Invalid timezone offset")

    query = db.query(Dispatch).filter(_successful_dispatches())

    if search and search.strip():
        term = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{term}%"
        query = query.outerjoin(Dispatch.sender).outerjoin(Dispatch.recipients).outerjoin(DispatchRecipient.person)
        query = query.filter(
            or_(
                Dispatch.message_text.ilike(pattern, escape="\\"),
                Dispatch.actual_recipient.ilike(pattern, escape="\\"),
                Dispatch.whatsapp_message_id.ilike(pattern, escape="\\"),
                MarketingPerson.full_name.ilike(pattern, escape="\\"),
                MarketingPerson.phone_number.ilike(pattern, escape="\\"),
                Dispatch.customer_name.ilike(pattern, escape="\\"),
                Dispatch.marketing_person_name.ilike(pattern, escape="\\"),
                Dispatch.recipient_name.ilike(pattern, escape="\\"),
            )
        )

    if dispatch_id is not None:
        query = query.filter(Dispatch.id == dispatch_id)
    if user_id:
        query = query.filter(Dispatch.sender_id == user_id)
    if person_id:
        query = query.filter(or_(
            Dispatch.recipients.any(DispatchRecipient.person_id == person_id),
            Dispatch.recipient_marketing_person_id == person_id,
            and_(Dispatch.recipient_marketing_person_id.is_(None), Dispatch.marketing_person_id == person_id, Dispatch.recipient_kind.in_(["marketing_person", "test"])),
        ))
    if customer_id:
        query = query.filter(or_(Dispatch.customer_id == customer_id, Dispatch.recipient_customer_id == customer_id))
    if recipient_customer_id:
        query = query.filter(or_(
            Dispatch.recipient_customer_id == recipient_customer_id,
            and_(Dispatch.recipient_customer_id.is_(None), Dispatch.customer_id == recipient_customer_id,
                 Dispatch.recipient_kind.in_(["customer", "customer_test"])),
        ))

    if from_date:
        query = query.filter(Dispatch.timestamp >= _utc_boundary(datetime.combine(from_date, from_time or time.min), timezone_offset_minutes))

    if to_date:
        upper_local = datetime.combine(to_date, to_time) + timedelta(minutes=1) if to_time else datetime.combine(to_date + timedelta(days=1), time.min)
        query = query.filter(Dispatch.timestamp < _utc_boundary(upper_local, timezone_offset_minutes))

    if (from_time and not from_date) or (to_time and not to_date):
        # PostgreSQL sessions may use a timezone other than UTC; normalize before extracting.
        timestamp_for_time = func.timezone("UTC", Dispatch.timestamp) if db.get_bind().dialect.name == "postgresql" else Dispatch.timestamp
        seconds = _local_seconds(timestamp_for_time, timezone_offset_minutes)
        lower = _time_seconds(from_time) if from_time and not from_date else None
        upper = min(_time_seconds(to_time) + 60, 86400) if to_time and not to_date else None
        if lower is not None and upper is not None and lower >= upper:
            query = query.filter(or_(seconds >= lower, seconds < upper))
        elif lower is not None and upper is not None:
            query = query.filter(seconds >= lower, seconds < upper)
        elif lower is not None:
            query = query.filter(seconds >= lower)
        elif upper is not None:
            query = query.filter(seconds < upper)

    return query


def _history_items(query, page: int, page_size: int):
    return query.options(
        joinedload(Dispatch.sender),
        joinedload(Dispatch.recipients).joinedload(DispatchRecipient.person),
    ).distinct().order_by(Dispatch.timestamp.desc(), Dispatch.id.desc()).offset((page - 1) * page_size).limit(page_size).all()


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
    customer_id: int | None = None,
    recipient_customer_id: int | None = None,
    dispatch_id: int | None = None,
    timezone_offset_minutes: int = 0,
):
    query = _history_query(db, search, from_date, to_date, from_time, to_time, user_id, person_id,
                           customer_id, dispatch_id, timezone_offset_minutes, recipient_customer_id)
    return _history_items(query, 1, 100)


@router.get("/history/page", response_model=DispatchHistoryPageResponse)
def dispatch_history_page(
    current_user: CurrentUser,
    db: Session = Depends(get_db),
    search: str | None = Query(default=None, max_length=100),
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    from_time: time | None = Query(default=None),
    to_time: time | None = Query(default=None),
    user_id: int | None = Query(default=None, ge=1),
    person_id: int | None = Query(default=None, ge=1),
    customer_id: int | None = Query(default=None, ge=1),
    recipient_customer_id: int | None = None,
    dispatch_id: int | None = Query(default=None, ge=1),
    timezone_offset_minutes: int = 0,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    query = _history_query(db, search, from_date, to_date, from_time, to_time, user_id, person_id,
                           customer_id, dispatch_id, timezone_offset_minutes, recipient_customer_id)
    total = query.with_entities(func.count(func.distinct(Dispatch.id))).scalar() or 0
    return DispatchHistoryPageResponse(items=_history_items(query, page, page_size), total=total, page=page, page_size=page_size)


@router.get("/stats", response_model=DispatchStatsResponse)
def dispatch_stats(
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    today_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)

    total_dispatches = db.query(func.count(Dispatch.id)).scalar() or 0
    total_messages = (
        db.query(func.count(DispatchRecipient.id))
        .filter(DispatchRecipient.delivery_status != "demo_selected")
        .scalar()
        or 0
    )
    total_messages += (
        db.query(func.count(Dispatch.id))
        .filter(Dispatch.send_mode == "whatsapp_test")
        .scalar()
        or 0
    )
    total_messages += db.query(func.count(Dispatch.id)).filter(Dispatch.send_mode.in_(["customer_dispatch", "customer_test"])).scalar() or 0
    messages_sent = (
        db.query(func.count(DispatchRecipient.id))
        .filter(DispatchRecipient.delivery_status == "sent")
        .scalar()
        or 0
    )
    messages_sent += (
        db.query(func.count(Dispatch.id))
        .filter(Dispatch.send_mode == "whatsapp_test", Dispatch.whatsapp_status == "accepted")
        .scalar()
        or 0
    )
    messages_sent += db.query(func.count(Dispatch.id)).filter(Dispatch.send_mode.in_(["customer_dispatch", "customer_test"]), Dispatch.whatsapp_status == "accepted").scalar() or 0
    messages_failed = (
        db.query(func.count(DispatchRecipient.id))
        .filter(DispatchRecipient.delivery_status.in_(["failed", "not_configured"]))
        .scalar()
        or 0
    )
    messages_failed += (
        db.query(func.count(Dispatch.id))
        .filter(Dispatch.send_mode == "whatsapp_test", Dispatch.whatsapp_status == "failed")
        .scalar()
        or 0
    )
    messages_failed += db.query(func.count(Dispatch.id)).filter(Dispatch.send_mode.in_(["customer_dispatch", "customer_test"]), Dispatch.whatsapp_status == "failed").scalar() or 0

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
        .filter(DispatchRecipient.delivery_status != "demo_selected")
        .scalar()
        or 0
    )
    today_messages += (
        db.query(func.count(Dispatch.id))
        .filter(Dispatch.send_mode == "whatsapp_test", Dispatch.timestamp >= today_start)
        .scalar()
        or 0
    )
    today_messages += db.query(func.count(Dispatch.id)).filter(Dispatch.send_mode.in_(["customer_dispatch", "customer_test"]), Dispatch.timestamp >= today_start).scalar() or 0

    total_contacts = (
        db.query(func.count(MarketingPerson.id))
        .filter(MarketingPerson.is_deleted.is_(False))
        .scalar()
        or 0
    )
    active_contacts = (
        db.query(func.count(MarketingPerson.id))
        .filter(MarketingPerson.is_active.is_(True), MarketingPerson.is_deleted.is_(False))
        .scalar()
        or 0
    )

    delivery_rate = round((messages_sent / total_messages * 100), 1) if total_messages > 0 else 100.0

    recent_dispatches = (
        db.query(Dispatch)
        .filter(_successful_dispatches())
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
        media_type={
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".pdf": "application/pdf",
        }.get(path.suffix.lower(), "application/octet-stream"),
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
