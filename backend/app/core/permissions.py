from fastapi import HTTPException, status

from app.models.user import User, UserRole


def normalize_role(role: UserRole | str) -> str:
    return role.value if isinstance(role, UserRole) else str(role)


def has_role(user_role: UserRole | str, allowed_roles: list[UserRole | str]) -> bool:
    role_value = normalize_role(user_role)
    allowed_values = [normalize_role(role) for role in allowed_roles]
    return role_value in allowed_values


def require_roles(user: User, allowed_roles: list[UserRole | str]) -> None:
    if not has_role(user.role, allowed_roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to perform this action",
        )


def can_manage_user_role(actor_role: UserRole | str, target_role: UserRole | str) -> bool:
    actor = normalize_role(actor_role)
    target = normalize_role(target_role)

    if actor == UserRole.SUPER_ADMIN.value:
        return target in {UserRole.MANAGER.value, UserRole.USER.value}

    if actor == UserRole.MANAGER.value:
        return target == UserRole.USER.value

    return False
