from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.core.permissions import normalize_role, require_roles
from app.models.user import UserRole

router = APIRouter()


@router.get("/")
def list_users(current_user: CurrentUser):
    require_roles(current_user, [UserRole.SUPER_ADMIN, UserRole.MANAGER])

    return {
        "message": "Users endpoint",
        "authenticated_as": current_user.username,
        "role": normalize_role(current_user.role),
    }
