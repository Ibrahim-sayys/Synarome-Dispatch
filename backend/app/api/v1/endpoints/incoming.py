"""Incoming conversation messages matched to saved phone numbers."""
import re
from urllib.parse import urlsplit
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session
from app.api.deps import CurrentUser, get_db
from app.config import settings
from app.models.customer import Customer
from app.models.marketing_person import MarketingPerson
from app.models.dispatch import Dispatch
from app.models.incoming_message import IncomingMessage

router = APIRouter()


def normalized(number):
    value = (number or '').removeprefix('+')
    if value.startswith('0'):
        value = settings.WHATSAPP_DEFAULT_COUNTRY_CODE.strip().removeprefix('+') + value[1:]
    return value if re.fullmatch(r'[1-9][0-9]{6,14}', value) else None


def saved_number(db, kind, entity_id):
    model = Customer if kind == 'customer' else MarketingPerson
    entity = db.query(model).filter(model.id == entity_id, model.is_deleted.is_(False)).first()
    if not entity:
        raise HTTPException(404, 'Contact not found')
    number = normalized(entity.phone_number)
    if not number:
        return None
    return number


@router.get('')
def list_incoming(current_user: CurrentUser, db: Session = Depends(get_db),
                  person_id: int | None = Query(default=None, ge=1), customer_id: int | None = Query(default=None, ge=1),
                  conversation_customer_id: int | None = Query(default=None, ge=1)):
    if sum(x is not None for x in (person_id, customer_id, conversation_customer_id)) != 1:
        raise HTTPException(422, 'Select one conversation')
    if person_id:
        number = saved_number(db, 'person', person_id)
        query = db.query(IncomingMessage).filter(IncomingMessage.sender_number == number) if number else None
    else:
        customer = customer_id or conversation_customer_id
        number = saved_number(db, 'customer', customer)
        query = db.query(IncomingMessage).filter(IncomingMessage.sender_number == number) if number else None
        # A marketing person's explicit reply to a specific dispatch belongs to that customer conversation too.
        if conversation_customer_id:
            context_ids = db.query(Dispatch.whatsapp_message_id).filter(Dispatch.customer_id == customer, Dispatch.send_mode == 'customer_dispatch',
                Dispatch.whatsapp_message_id.isnot(None), Dispatch.actual_recipient.isnot(None)).all()
            contexts = [x[0] for x in context_ids]
            extra = db.query(IncomingMessage).filter(IncomingMessage.context_message_id.in_(contexts)).all() if contexts else []
            records = query.all() if query is not None else []
            by_context = {d.whatsapp_message_id: d for d in db.query(Dispatch).filter(Dispatch.whatsapp_message_id.in_(contexts)).all()} if contexts else {}
            for item in extra:
                original = by_context.get(item.context_message_id)
                if original and normalized(original.actual_recipient) == item.sender_number and item not in records:
                    records.append(item)
            return [serialize(item) for item in sorted(records, key=lambda x: (x.timestamp, x.id), reverse=True)]
    records = query.order_by(IncomingMessage.timestamp.desc(), IncomingMessage.id.desc()).all() if query is not None else []
    return [serialize(item) for item in records]


def serialize(item):
    extensions = {'image/jpeg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf'}
    suffix = extensions.get(item.media_mime, '')
    return {'id': -item.id, 'sender_id': None, 'direction': 'incoming', 'message_text': item.message_text,
            'incoming_type': item.message_type, 'incoming_media': bool(item.media_id), 'original_filename': item.media_filename,
            'file_path': ('incoming' + suffix) if item.media_id else None,
            'actual_recipient': item.sender_number, 'recipient_name': item.sender_name,
            'timestamp': item.timestamp, 'recipients': []}


@router.get('/{message_id}/file')
async def incoming_file(message_id: int, current_user: CurrentUser, db: Session = Depends(get_db)):
    message = db.get(IncomingMessage, message_id)
    if not message or not message.media_id or not re.fullmatch(r'[0-9]{1,100}', message.media_id):
        raise HTTPException(404, 'Attachment not available')
    token = settings.WHATSAPP_ACCESS_TOKEN.strip()
    version = settings.WHATSAPP_API_VERSION.strip()
    if not token or not re.fullmatch(r'v\d+\.\d+', version):
        raise HTTPException(503, 'WhatsApp credentials are not configured')
    headers = {'Authorization': f'Bearer {token}'}
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
            meta = await client.get(f'https://graph.facebook.com/{version}/{message.media_id}', headers=headers)
            meta.raise_for_status()
            url = meta.json().get('url', '')
            parsed = urlsplit(url)
            host = (parsed.hostname or '').lower()
            if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443) or not any(host == suffix or host.endswith('.' + suffix) for suffix in ('facebook.com', 'fbcdn.net', 'fbsbx.com')):
                raise ValueError('Invalid media URL')
            async with client.stream('GET', url, headers=headers) as result:
                result.raise_for_status()
                chunks = []
                length = 0
                async for chunk in result.aiter_bytes():
                    length += len(chunk)
                    if length > 100 * 1024 * 1024:
                        raise HTTPException(413, 'Attachment exceeds 100 MB')
                    chunks.append(chunk)
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        raise HTTPException(502, 'Could not retrieve this attachment from WhatsApp. It may no longer be available.')
    mime = message.media_mime if message.media_mime in ('image/jpeg', 'image/png', 'application/pdf') else 'application/octet-stream'
    return Response(content=b''.join(chunks), media_type=mime, headers={'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store'})
