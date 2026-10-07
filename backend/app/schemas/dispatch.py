from pydantic import BaseModel


class DispatchResponse(BaseModel):
    id: int
    sender_id: int
    file_path: str | None = None
    message_text: str | None = None

    model_config = {
        "from_attributes": True
    }
