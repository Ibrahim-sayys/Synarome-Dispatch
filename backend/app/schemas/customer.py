from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.marketing_person import MarketingPersonResponse
from app.utils.validators import normalize_phone_number


class CustomerCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    phone_number: str | None = Field(default=None, max_length=30)
    city: str | None = Field(default=None, max_length=100)
    other_info: str | None = Field(default=None, max_length=2000)
    marketing_person_id: int = Field(ge=1)

    @field_validator("full_name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Customer name must contain at least 2 characters")
        return value

    @field_validator("phone_number")
    @classmethod
    def clean_phone(cls, value: str | None) -> str | None:
        return normalize_phone_number(value) if value and value.strip() else None

    @field_validator("city", "other_info")
    @classmethod
    def clean_optional(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


class CustomerUpdate(CustomerCreate):
    pass


class CustomerResponse(BaseModel):
    id: int
    full_name: str
    phone_number: str | None = None
    city: str | None = None
    other_info: str | None = None
    marketing_person_id: int
    marketing_person: MarketingPersonResponse

    model_config = ConfigDict(from_attributes=True)


class CustomerPage(BaseModel):
    items: list[CustomerResponse]
    total: int
    page: int
    page_size: int
