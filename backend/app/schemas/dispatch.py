from datetime import datetime

from pydantic import BaseModel

from app.schemas.user import UserResponse


class DispatchResponse(BaseModel):
    id: int
    sender_id: int
    file_path: str | None = None
    message_text: str | None = None
    timestamp: datetime | None = None
    sender: UserResponse | None = None

    model_config = {
        "from_attributes": True
    }
