from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.core.permissions import normalize_role

router = APIRouter()


@router.post("/send")
def send_dispatch(current_user: CurrentUser):
    return {
        "message": "Dispatch send endpoint",
        "authenticated_as": current_user.username,
        "role": normalize_role(current_user.role),
    }


@router.get("/history")
def dispatch_history(current_user: CurrentUser):
    return {
        "message": "Dispatch history endpoint",
        "authenticated_as": current_user.username,
        "role": normalize_role(current_user.role),
    }
