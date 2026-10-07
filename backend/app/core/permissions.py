def has_role(user_role: str, allowed_roles: list[str]) -> bool:
    return user_role in allowed_roles
