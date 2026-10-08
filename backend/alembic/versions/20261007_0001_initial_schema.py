"""Initial database schema

Revision ID: 20261007_0001
Revises:
Create Date: 2026-10-07 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261007_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    user_role = sa.Enum("SUPER_ADMIN", "MANAGER", "USER", name="userrole")

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=100), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", user_role, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("username"),
    )
    op.create_index(op.f("ix_users_id"), "users", ["id"], unique=False)
    op.create_index(op.f("ix_users_username"), "users", ["username"], unique=False)

    op.create_table(
        "marketing_persons",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("full_name", sa.String(length=150), nullable=False),
        sa.Column("phone_number", sa.String(length=30), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("added_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["added_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("phone_number"),
    )
    op.create_index(op.f("ix_marketing_persons_id"), "marketing_persons", ["id"], unique=False)

    op.create_table(
        "dispatches",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sender_id", sa.Integer(), nullable=False),
        sa.Column("file_path", sa.String(length=500), nullable=True),
        sa.Column("message_text", sa.Text(), nullable=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_dispatches_id"), "dispatches", ["id"], unique=False)

    op.create_table(
        "dispatch_recipients",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("dispatch_id", sa.Integer(), nullable=False),
        sa.Column("person_id", sa.Integer(), nullable=False),
        sa.Column("delivery_status", sa.String(length=50), nullable=True),
        sa.ForeignKeyConstraint(["dispatch_id"], ["dispatches.id"]),
        sa.ForeignKeyConstraint(["person_id"], ["marketing_persons.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_dispatch_recipients_id"), "dispatch_recipients", ["id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_dispatch_recipients_id"), table_name="dispatch_recipients")
    op.drop_table("dispatch_recipients")
    op.drop_index(op.f("ix_dispatches_id"), table_name="dispatches")
    op.drop_table("dispatches")
    op.drop_index(op.f("ix_marketing_persons_id"), table_name="marketing_persons")
    op.drop_table("marketing_persons")
    op.drop_index(op.f("ix_users_username"), table_name="users")
    op.drop_index(op.f("ix_users_id"), table_name="users")
    op.drop_table("users")
    sa.Enum(name="userrole").drop(op.get_bind(), checkfirst=True)
