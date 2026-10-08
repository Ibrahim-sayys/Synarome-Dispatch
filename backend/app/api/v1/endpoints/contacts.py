from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.core.permissions import normalize_role

router = APIRouter()


@router.get("/")
def list_contacts(current_user: CurrentUser):
    return {
        "message": "Contacts endpoint",
        "authenticated_as": current_user.username,
        "role": normalize_role(current_user.role),
    }


@router.post("/")
def create_contact(current_user: CurrentUser):
    return {
        "message": "Create contact endpoint",
        "authenticated_as": current_user.username,
        "role": normalize_role(current_user.role),
    }
