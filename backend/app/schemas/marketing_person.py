from pydantic import BaseModel


class MarketingPersonCreate(BaseModel):
    full_name: str
    phone_number: str


class MarketingPersonResponse(BaseModel):
    id: int
    full_name: str
    phone_number: str
    is_active: bool

    model_config = {
        "from_attributes": True
    }
