"""Track who suspended marketing persons

Revision ID: 20261009_0004
Revises: 20261009_0003
Create Date: 2026-10-09 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261009_0004"
down_revision: Union[str, None] = "20261009_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("marketing_persons", sa.Column("suspended_by", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "marketing_persons_suspended_by_fkey",
        "marketing_persons",
        "users",
        ["suspended_by"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("marketing_persons_suspended_by_fkey", "marketing_persons", type_="foreignkey")
    op.drop_column("marketing_persons", "suspended_by")
