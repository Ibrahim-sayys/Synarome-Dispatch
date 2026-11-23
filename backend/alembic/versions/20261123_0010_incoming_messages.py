"""Store incoming WhatsApp messages separately from dispatches."""
from alembic import op
import sqlalchemy as sa

revision = '20261123_0010'
down_revision = '20261122_0009'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('incoming_messages',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('whatsapp_message_id', sa.String(512), nullable=False, unique=True),
        sa.Column('sender_number', sa.String(32), nullable=False),
        sa.Column('sender_name', sa.String(255)),
        sa.Column('message_type', sa.String(40), nullable=False),
        sa.Column('message_text', sa.Text()),
        sa.Column('media_id', sa.String(512)),
        sa.Column('media_mime', sa.String(255)),
        sa.Column('media_filename', sa.String(255)),
        sa.Column('context_message_id', sa.String(512)),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False))
    op.create_index('ix_incoming_messages_sender_number', 'incoming_messages', ['sender_number'])
    op.create_index('ix_incoming_messages_timestamp', 'incoming_messages', ['timestamp'])


def downgrade():
    op.drop_table('incoming_messages')
