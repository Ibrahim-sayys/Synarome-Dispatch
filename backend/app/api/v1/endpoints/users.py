from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import CurrentUser, get_db
from app.core.permissions import can_manage_user_role, normalize_role, require_roles
from app.core.security import hash_password
from app.models.user import User, UserRole
from app.schemas.user import UserCreate, UserPasswordReset, UserResponse

router = APIRouter()


@router.get("/", response_model=list[UserResponse])
def list_users(
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    require_roles(current_user, [UserRole.SUPER_ADMIN, UserRole.MANAGER])

    return db.query(User).order_by(User.created_at.desc(), User.id.desc()).all()


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    require_roles(current_user, [UserRole.SUPER_ADMIN, UserRole.MANAGER])

    if not can_manage_user_role(current_user.role, payload.role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot create a user with that role",
        )

    existing_user = db.query(User).filter(User.username == payload.username).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already exists",
        )

    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return user


@router.post("/{user_id}/reset-password")
def reset_user_password(
    user_id: int,
    payload: UserPasswordReset,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
):
    require_roles(current_user, [UserRole.SUPER_ADMIN, UserRole.MANAGER])

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use change password for your own account",
        )

    if not can_manage_user_role(current_user.role, user.role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot reset this user's password",
        )

    user.password_hash = hash_password(payload.password)
    user.session_version += 1
    db.commit()

    return {"message": "Password reset."}
