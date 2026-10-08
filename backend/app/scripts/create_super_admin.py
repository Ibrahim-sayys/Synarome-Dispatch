import argparse
import getpass
import sys

from sqlalchemy.exc import SQLAlchemyError

from app.core.security import hash_password
from app.database import SessionLocal
from app.models.user import User, UserRole


def create_super_admin(username: str, password: str) -> User:
    db = SessionLocal()

    try:
        existing_user = db.query(User).filter(User.username == username).first()
        if existing_user:
            raise ValueError(f"User '{username}' already exists.")

        user = User(
            username=username,
            password_hash=hash_password(password),
            role=UserRole.SUPER_ADMIN,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Create the first super admin user.")
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", help="Omit to enter it securely.")
    args = parser.parse_args()

    password = args.password or getpass.getpass("Password: ")
    if len(password) < 8:
        print("Password must be at least 8 characters.", file=sys.stderr)
        return 1

    try:
        user = create_super_admin(args.username, password)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except SQLAlchemyError as exc:
        print(f"Database error: {exc}", file=sys.stderr)
        return 1

    print(f"Created super admin '{user.username}' with id {user.id}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
