"""Record each logical recipient of a customer dispatch.

Revision ID: 20261110_0008
Revises: 20261110_0007
"""
from alembic import op
import sqlalchemy as sa

revision = "20261110_0008"
down_revision = "20261110_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("dispatches", sa.Column("recipient_name", sa.String(150), nullable=True))
    op.add_column("dispatches", sa.Column("recipient_customer_id", sa.Integer(), sa.ForeignKey("customers.id"), nullable=True))
    op.add_column("dispatches", sa.Column("recipient_marketing_person_id", sa.Integer(), sa.ForeignKey("marketing_persons.id"), nullable=True))
    op.create_index("ix_dispatches_recipient_customer_id", "dispatches", ["recipient_customer_id"])
    op.create_index("ix_dispatches_recipient_marketing_person_id", "dispatches", ["recipient_marketing_person_id"])


def downgrade() -> None:
    op.drop_index("ix_dispatches_recipient_marketing_person_id", table_name="dispatches")
    op.drop_index("ix_dispatches_recipient_customer_id", table_name="dispatches")
    op.drop_column("dispatches", "recipient_marketing_person_id")
    op.drop_column("dispatches", "recipient_customer_id")
    op.drop_column("dispatches", "recipient_name")
