"""Receive authenticated WhatsApp delivery updates from Meta."""
import hashlib
import hmac
import json
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.dispatch import Dispatch
from app.models.incoming_message import IncomingMessage

router = APIRouter()


@router.get('/webhook', response_class=PlainTextResponse)
def verify(request: Request):
    token = settings.WHATSAPP_WEBHOOK_VERIFY_TOKEN
    params = request.query_params
    if not token:
        raise HTTPException(503, 'Webhook verification is not configured')
    if params.get('hub.mode') != 'subscribe' or not hmac.compare_digest(params.get('hub.verify_token', ''), token):
        raise HTTPException(403, 'Verification failed')
    challenge = params.get('hub.challenge')
    if challenge is None:
        raise HTTPException(400, 'Missing challenge')
    return challenge


@router.post('/webhook')
async def receive(request: Request, db: Session = Depends(get_db)):
    secret = settings.WHATSAPP_APP_SECRET
    if not secret:
        raise HTTPException(503, 'Webhook signing secret is not configured')
    body = await request.body()
    expected = 'sha256=' + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(request.headers.get('x-hub-signature-256', ''), expected):
        raise HTTPException(403, 'Invalid signature')
    try:
        payload = json.loads(body)
        entries = payload['entry']
        if payload.get('object') != 'whatsapp_business_account' or not isinstance(entries, list):
            raise ValueError()
        values = [change.get('value', {}) for entry in entries for change in entry.get('changes', [])]
        statuses = [status for value in values for status in value.get('statuses', [])]
        if any(not isinstance(s, dict) for s in statuses):
            raise ValueError()
    except (ValueError, KeyError, TypeError, AttributeError):
        raise HTTPException(400, 'Invalid webhook payload')

    # Conditional updates prevent duplicate or out-of-order events from regressing status.
    previous = {
        'sent': ['accepted'],
        'delivered': ['accepted', 'sent'],
        'read': ['accepted', 'sent', 'delivered'],
        'failed': ['accepted', 'sent'],
    }
    unmatched = False
    for status in statuses:
        message_id, state = status.get('id'), status.get('status')
        if not isinstance(message_id, str) or not isinstance(state, str) or state not in previous:
            continue
        matched = db.query(Dispatch.id).filter(Dispatch.whatsapp_message_id == message_id).first()
        if not matched:
            unmatched = True
            continue
        db.query(Dispatch).filter(Dispatch.whatsapp_message_id == message_id,
                                  Dispatch.whatsapp_status.in_(previous[state])).update(
                                      {Dispatch.whatsapp_status: state}, synchronize_session=False)
    for value in values:
        metadata = value.get('metadata', {})
        if metadata.get('phone_number_id') != settings.WHATSAPP_PHONE_NUMBER_ID.strip():
            continue
        contacts = {item.get('wa_id'): (item.get('profile') or {}).get('name') for item in value.get('contacts', []) if isinstance(item, dict)}
        for message in value.get('messages', []):
            if not isinstance(message, dict):
                continue
            mid, number, kind = message.get('id'), message.get('from'), message.get('type')
            if not isinstance(mid, str) or not 1 <= len(mid) <= 512 or not isinstance(number, str) or not re.fullmatch(r'[1-9][0-9]{6,14}', number) or not isinstance(kind, str):
                continue
            try:
                when = datetime.fromtimestamp(int(message.get('timestamp')), timezone.utc)
            except (ValueError, TypeError, OverflowError, OSError):
                continue
            content = message.get(kind) if isinstance(message.get(kind), dict) else {}
            body = content.get('body') if kind == 'text' else content.get('caption')
            context = message.get('context') if isinstance(message.get('context'), dict) else {}
            data = dict(whatsapp_message_id=mid, sender_number=number, message_type=kind[:40],
                        sender_name=contacts.get(number)[:255] if isinstance(contacts.get(number), str) else None,
                        message_text=body if isinstance(body, str) else None,
                        media_id=content.get('id') if isinstance(content.get('id'), str) and len(content['id']) <= 512 else None,
                        media_mime=content.get('mime_type')[:255] if isinstance(content.get('mime_type'), str) else None,
                        media_filename=content.get('filename')[:255] if isinstance(content.get('filename'), str) else None,
                        context_message_id=context.get('id') if isinstance(context.get('id'), str) and len(context['id']) <= 512 else None,
                        timestamp=when)
            dialect = db.get_bind().dialect.name
            if dialect == 'postgresql':
                from sqlalchemy.dialects.postgresql import insert
            elif dialect == 'sqlite':
                from sqlalchemy.dialects.sqlite import insert
            else:
                raise HTTPException(503, 'Incoming message storage is unavailable')
            db.execute(insert(IncomingMessage).values(**data).on_conflict_do_nothing(index_elements=['whatsapp_message_id']))
    db.commit()
    # A callback can arrive before the send response saves its message ID. Ask Meta to retry.
    if unmatched and db.query(Dispatch.id).filter(Dispatch.whatsapp_status == 'pending').first():
        raise HTTPException(503, 'Send still being recorded; retry')
    return {'ok': True}
