from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.api.deps import CurrentUser, get_db
from app.models.customer import Customer
from app.models.marketing_person import MarketingPerson
from app.schemas.customer import CustomerCreate, CustomerPage, CustomerResponse, CustomerUpdate

router = APIRouter()


def _active_marketing_person(db: Session, person_id: int) -> MarketingPerson:
    person = db.get(MarketingPerson, person_id)
    if not person or person.is_deleted or not person.is_active:
        raise HTTPException(status_code=422, detail="Choose an active marketing person.")
    return person


@router.get("/filters")
async def customer_filter_options(current_user: CurrentUser, db: Session = Depends(get_db)):
    cities = db.query(Customer.city).filter(
        Customer.is_deleted.is_(False), Customer.city.is_not(None), func.trim(Customer.city) != ""
    ).distinct().order_by(Customer.city).all()
    return {"cities": [city for (city,) in cities]}


@router.get("/", response_model=CustomerPage)
async def list_customers(
    current_user: CurrentUser,
    db: Session = Depends(get_db),
    search: str | None = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    marketing_person_id: int | None = Query(default=None, ge=1),
    city: str | None = Query(default=None, max_length=100),
    phone_status: Literal["all", "with_phone", "without_phone"] = "all",
):
    query = db.query(Customer).filter(Customer.is_deleted.is_(False))
    if marketing_person_id:
        query = query.filter(Customer.marketing_person_id == marketing_person_id)
    if city:
        query = query.filter(func.lower(Customer.city) == city.strip().lower())
    if phone_status == "with_phone":
        query = query.filter(Customer.phone_number.is_not(None), Customer.phone_number != "")
    elif phone_status == "without_phone":
        query = query.filter(or_(Customer.phone_number.is_(None), Customer.phone_number == ""))
    if search and search.strip():
        escaped = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        query = query.join(Customer.marketing_person).filter(or_(
            Customer.full_name.ilike(pattern, escape="\\"),
            Customer.phone_number.ilike(pattern, escape="\\"),
            Customer.city.ilike(pattern, escape="\\"),
            MarketingPerson.full_name.ilike(pattern, escape="\\"),
        ))
    total = query.count()
    items = query.options(joinedload(Customer.marketing_person)).order_by(Customer.full_name, Customer.id).offset((page - 1) * page_size).limit(page_size).all()
    return CustomerPage(items=items, total=total, page=page, page_size=page_size)


@router.post("/", response_model=CustomerResponse, status_code=status.HTTP_201_CREATED)
async def create_customer(payload: CustomerCreate, current_user: CurrentUser, db: Session = Depends(get_db)):
    _active_marketing_person(db, payload.marketing_person_id)
    customer = Customer(**payload.model_dump())
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


@router.put("/{customer_id}", response_model=CustomerResponse)
async def update_customer(customer_id: int, payload: CustomerUpdate, current_user: CurrentUser, db: Session = Depends(get_db)):
    customer = db.get(Customer, customer_id)
    if not customer or customer.is_deleted:
        raise HTTPException(status_code=404, detail="Customer not found.")
    _active_marketing_person(db, payload.marketing_person_id)
    for field, value in payload.model_dump().items():
        setattr(customer, field, value)
    db.commit()
    db.refresh(customer)
    return customer


@router.delete("/{customer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_customer(customer_id: int, current_user: CurrentUser, db: Session = Depends(get_db)):
    customer = db.get(Customer, customer_id)
    if not customer or customer.is_deleted:
        raise HTTPException(status_code=404, detail="Customer not found.")
    customer.is_deleted = True
    db.commit()
