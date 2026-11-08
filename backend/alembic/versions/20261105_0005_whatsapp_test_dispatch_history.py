"""Keep WhatsApp test submissions in existing dispatch history.

Revision ID: 20261105_0005
Revises: 20261009_0004
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20261105_0005"
down_revision: Union[str, None] = "20261009_0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("dispatches", sa.Column("send_mode", sa.String(length=30), server_default="contact", nullable=False))
    op.add_column("dispatches", sa.Column("whatsapp_status", sa.String(length=30), nullable=True))
    op.add_column("dispatches", sa.Column("whatsapp_message_id", sa.String(length=512), nullable=True))
    op.add_column("dispatches", sa.Column("actual_recipient", sa.String(length=32), nullable=True))
    op.add_column("dispatches", sa.Column("original_filename", sa.String(length=255), nullable=True))
    op.add_column("dispatches", sa.Column("failure_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("dispatches", "failure_reason")
    op.drop_column("dispatches", "original_filename")
    op.drop_column("dispatches", "actual_recipient")
    op.drop_column("dispatches", "whatsapp_message_id")
    op.drop_column("dispatches", "whatsapp_status")
    op.drop_column("dispatches", "send_mode")
