"""Add user session version

Revision ID: 20261009_0003
Revises: 20261009_0002
Create Date: 2026-10-09 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261009_0003"
down_revision: Union[str, None] = "20261009_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("session_version", sa.Integer(), nullable=False, server_default="0"),
    )
    op.alter_column("users", "session_version", server_default=None)


def downgrade() -> None:
    op.drop_column("users", "session_version")
