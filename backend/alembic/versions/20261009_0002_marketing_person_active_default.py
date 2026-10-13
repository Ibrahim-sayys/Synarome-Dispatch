"""Make marketing person active flag required

Revision ID: 20261009_0002
Revises: 20261007_0001
Create Date: 2026-10-09 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261009_0002"
down_revision: Union[str, None] = "20261007_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE marketing_persons SET is_active = true WHERE is_active IS NULL")
    op.alter_column(
        "marketing_persons",
        "is_active",
        existing_type=sa.Boolean(),
        nullable=False,
        server_default=sa.text("true"),
    )


def downgrade() -> None:
    op.alter_column(
        "marketing_persons",
        "is_active",
        existing_type=sa.Boolean(),
        nullable=True,
        server_default=None,
    )
