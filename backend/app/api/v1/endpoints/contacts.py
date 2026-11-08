from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_db
from app.models.marketing_person import MarketingPerson
from app.schemas.marketing_person import (
    MarketingPersonCreate,
    MarketingPersonResponse,
    MarketingPersonUpdate,
)

router = APIRouter()


def build_contact_response(contact: MarketingPerson) -> MarketingPersonResponse:
    response = MarketingPersonResponse.model_validate(contact)
    response.suspended_by_username = (
        contact.suspended_by_user.username
        if contact.suspended_by_user
        else None
    )
    return response


@router.get("/", response_model=list[MarketingPersonResponse])
def list_contacts(
    current_user: CurrentUser,
    db: Session = Depends(get_db),
    search: str | None = Query(default=None, max_length=100),
    include_inactive: bool = False,
):
    query = db.query(MarketingPerson).filter(MarketingPerson.is_deleted.is_(False))

    if not include_inactive:
        query = query.filter(MarketingPerson.is_active.is_(True))

    if search:
        pattern = f"%{search.strip()}%"
        query = query.filter(
            or_(
                MarketingPerson.full_name.ilike(pattern),
                MarketingPerson.phone_number.ilike(pattern),
            )
        )

    return [
        build_contact_response(contact)
        for contact in query.order_by(MarketingPerson.full_name.asc()).all()
    ]


@router.post("/", response_model=MarketingPersonResponse, status_code=status.HTTP_201_CREATED)
def create_contact(
    payload: MarketingPersonCreate,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    existing_phone_contact = (
        db.query(MarketingPerson)
        .filter(MarketingPerson.phone_number == payload.phone_number)
        .first()
    )
    if existing_phone_contact:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Contact phone number already exists",
        )

    existing_name_contact = (
        db.query(MarketingPerson)
        .filter(MarketingPerson.is_deleted.is_(False), func.lower(MarketingPerson.full_name) == payload.full_name.strip().lower())
        .first()
    )
    if existing_name_contact:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Contact name already exists",
        )

    contact = MarketingPerson(
        full_name=payload.full_name.strip(),
        phone_number=payload.phone_number,
        is_active=payload.is_active,
        added_by=current_user.id,
        suspended_by=None if payload.is_active else current_user.id,
    )
    db.add(contact)
    db.commit()
    db.refresh(contact)

    return build_contact_response(contact)


@router.put("/{contact_id}", response_model=MarketingPersonResponse)
def update_contact(
    contact_id: int,
    payload: MarketingPersonUpdate,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    contact = db.get(MarketingPerson, contact_id)
    if not contact or contact.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contact not found",
        )

    if payload.phone_number and payload.phone_number != contact.phone_number:
        duplicate_contact = (
            db.query(MarketingPerson)
            .filter(MarketingPerson.phone_number == payload.phone_number)
            .first()
        )
        if duplicate_contact:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Contact phone number already exists",
            )

    if payload.full_name and payload.full_name.strip().lower() != contact.full_name.lower():
        duplicate_name_contact = (
            db.query(MarketingPerson)
            .filter(
                MarketingPerson.id != contact_id,
                MarketingPerson.is_deleted.is_(False),
                func.lower(MarketingPerson.full_name) == payload.full_name.strip().lower(),
            )
            .first()
        )
        if duplicate_name_contact:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Contact name already exists",
            )

    updates = payload.model_dump(exclude_unset=True)
    if "full_name" in updates:
        updates["full_name"] = updates["full_name"].strip()
    if "is_active" in updates:
        updates["suspended_by"] = None if updates["is_active"] else current_user.id
    for field, value in updates.items():
        setattr(contact, field, value)

    db.commit()
    db.refresh(contact)

    return build_contact_response(contact)


@router.delete("/{contact_id}", response_model=MarketingPersonResponse)
def delete_contact(
    contact_id: int,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    contact = db.get(MarketingPerson, contact_id)
    if not contact or contact.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contact not found",
        )

    contact.is_active = False
    contact.is_deleted = True
    db.commit()
    db.refresh(contact)

    return build_contact_response(contact)
