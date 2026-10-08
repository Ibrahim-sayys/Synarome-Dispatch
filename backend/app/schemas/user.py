from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.user import UserRole


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=8, max_length=128)
    role: UserRole = UserRole.USER


class UserResponse(BaseModel):
    id: int
    username: str
    role: UserRole
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
