"""Receive authenticated WhatsApp delivery updates from Meta."""
import hashlib
import hmac
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.dispatch import Dispatch

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
        statuses = [status for entry in entries for change in entry.get('changes', [])
                    for status in change.get('value', {}).get('statuses', [])]
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
    db.commit()
    # A callback can arrive before the send response saves its message ID. Ask Meta to retry.
    if unmatched and db.query(Dispatch.id).filter(Dispatch.whatsapp_status == 'pending').first():
        raise HTTPException(503, 'Send still being recorded; retry')
    return {'ok': True}
