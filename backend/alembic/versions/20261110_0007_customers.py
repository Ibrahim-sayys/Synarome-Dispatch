"""Add customers and customer-specific dispatch destinations.

Revision ID: 20261110_0007
Revises: 20261106_0006
"""
from alembic import op
import sqlalchemy as sa

revision = "20261110_0007"
down_revision = "20261106_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "customers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("full_name", sa.String(150), nullable=False),
        sa.Column("phone_number", sa.String(30), nullable=True),
        sa.Column("city", sa.String(100), nullable=True),
        sa.Column("other_info", sa.Text(), nullable=True),
        sa.Column("marketing_person_id", sa.Integer(), sa.ForeignKey("marketing_persons.id"), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.create_index("ix_customers_marketing_person_id", "customers", ["marketing_person_id"])
    op.create_index("ix_customers_full_name", "customers", ["full_name"])
    op.add_column("dispatches", sa.Column("customer_id", sa.Integer(), sa.ForeignKey("customers.id"), nullable=True))
    op.add_column("dispatches", sa.Column("marketing_person_id", sa.Integer(), sa.ForeignKey("marketing_persons.id"), nullable=True))
    op.add_column("dispatches", sa.Column("recipient_kind", sa.String(20), nullable=True))
    op.add_column("dispatches", sa.Column("customer_name", sa.String(150), nullable=True))
    op.add_column("dispatches", sa.Column("marketing_person_name", sa.String(150), nullable=True))
    op.create_index("ix_dispatches_customer_id", "dispatches", ["customer_id"])


def downgrade() -> None:
    op.drop_index("ix_dispatches_customer_id", table_name="dispatches")
    for column in ("marketing_person_name", "customer_name", "recipient_kind", "marketing_person_id", "customer_id"):
        op.drop_column("dispatches", column)
    op.drop_index("ix_customers_full_name", table_name="customers")
    op.drop_index("ix_customers_marketing_person_id", table_name="customers")
    op.drop_table("customers")
