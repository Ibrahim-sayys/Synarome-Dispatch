"""Archive deleted contacts and users while keeping dispatch history.

Revision ID: 20261106_0006
Revises: 20261105_0005
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261106_0006"
down_revision: Union[str, None] = "20261105_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("marketing_persons", sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("users", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")))


def downgrade() -> None:
    op.drop_column("users", "is_active")
    op.drop_column("marketing_persons", "is_deleted")
