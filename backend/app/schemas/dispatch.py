from datetime import datetime

from pydantic import BaseModel

from app.schemas.marketing_person import MarketingPersonResponse
from app.schemas.user import UserResponse


class DispatchRecipientResponse(BaseModel):
    id: int
    person_id: int
    delivery_status: str | None = None
    person: MarketingPersonResponse | None = None

    model_config = {
        "from_attributes": True
    }


class DispatchResponse(BaseModel):
    id: int
    sender_id: int
    file_path: str | None = None
    message_text: str | None = None
    send_mode: str = "contact"
    whatsapp_status: str | None = None
    whatsapp_message_id: str | None = None
    actual_recipient: str | None = None
    customer_id: int | None = None
    marketing_person_id: int | None = None
    recipient_kind: str | None = None
    customer_name: str | None = None
    marketing_person_name: str | None = None
    recipient_name: str | None = None
    recipient_customer_id: int | None = None
    recipient_marketing_person_id: int | None = None
    original_filename: str | None = None
    failure_reason: str | None = None
    timestamp: datetime | None = None
    sender: UserResponse | None = None
    recipients: list[DispatchRecipientResponse] = []

    model_config = {
        "from_attributes": True
    }


class DispatchHistoryPageResponse(BaseModel):
    items: list[DispatchResponse]
    total: int
    page: int
    page_size: int


class DispatchStatsResponse(BaseModel):
    total_dispatches: int
    total_messages: int
    messages_sent: int
    messages_failed: int
    today_dispatches: int
    today_messages: int
    total_contacts: int
    active_contacts: int
    delivery_rate: float
    recent_dispatches: list[DispatchResponse] = []


class HistorySenderResponse(BaseModel):
    id: int
    username: str

    model_config = {"from_attributes": True}
