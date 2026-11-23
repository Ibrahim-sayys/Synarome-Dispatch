"""Add the media cleanup schedule.

Revision ID: 20261122_0009
Revises: 20261110_0008
"""
from datetime import datetime, timedelta, timezone
from alembic import op
import sqlalchemy as sa

revision = "20261122_0009"
down_revision = "20261110_0008"
branch_labels = None
depends_on = None


def upgrade():
    table = op.create_table("media_retention",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("interval_days", sa.Integer, nullable=False),
        sa.Column("next_run", sa.DateTime(timezone=True), nullable=False),
        sa.Column("notice_at", sa.DateTime(timezone=True)),
        sa.Column("cutoff_at", sa.DateTime(timezone=True)))
    op.bulk_insert(table, [{"id": 1, "interval_days": 10, "next_run": datetime.now(timezone.utc) + timedelta(days=10)}])


def downgrade():
    op.drop_table("media_retention")
