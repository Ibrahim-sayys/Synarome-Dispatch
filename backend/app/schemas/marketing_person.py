from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.utils.validators import normalize_phone_number


class MarketingPersonCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    phone_number: str = Field(min_length=11, max_length=30)
    is_active: bool = True

    @field_validator("phone_number")
    @classmethod
    def validate_phone_number(cls, value: str) -> str:
        return normalize_phone_number(value)

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value: str) -> str:
        return value.strip()


class MarketingPersonUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=150)
    phone_number: str | None = Field(default=None, min_length=11, max_length=30)
    is_active: bool | None = None

    @field_validator("phone_number")
    @classmethod
    def validate_phone_number(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return normalize_phone_number(value)

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()


class MarketingPersonResponse(BaseModel):
    id: int
    full_name: str
    phone_number: str
    is_active: bool
    added_by: int | None = None
    suspended_by: int | None = None
    suspended_by_username: str | None = None

    model_config = ConfigDict(from_attributes=True)
