import hashlib
import hmac
import json
from unittest.mock import patch

import httpx
from tests.test_whatsapp import WhatsAppRouteTests
from app.config import settings
from app.models.dispatch import Dispatch


class WebhookTests(WhatsAppRouteTests):
    async def test_webhook_verification_and_status(self):
        record = Dispatch(sender_id=self.user.id, send_mode='whatsapp_test', whatsapp_status='accepted', whatsapp_message_id='wamid.1')
        self.db.add(record)
        self.db.commit()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=__import__('app.main', fromlist=['app']).app), base_url='http://test') as client:
            with patch.object(settings, 'WHATSAPP_APP_SECRET', 'secret'), patch.object(settings, 'WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'verify'):
                response = await client.get('/api/v1/whatsapp/webhook', params={'hub.mode': 'subscribe', 'hub.verify_token': 'verify', 'hub.challenge': '123'})
                self.assertEqual((response.status_code, response.text), (200, '123'))
                for status in ['delivered', 'read', 'sent']:
                    body = json.dumps({'object': 'whatsapp_business_account', 'entry': [{'changes': [{'value': {'statuses': [{'id': 'wamid.1', 'status': status}]}}]}]}).encode()
                    sig = hmac.new(b'secret', body, hashlib.sha256).hexdigest()
                    bad = await client.post('/api/v1/whatsapp/webhook', content=body, headers={'x-hub-signature-256': 'sha256=bad'})
                    self.assertEqual(bad.status_code, 403)
                    response = await client.post('/api/v1/whatsapp/webhook', content=body, headers={'x-hub-signature-256': 'sha256=' + sig})
                    self.assertEqual(response.status_code, 200)
                self.db.refresh(record)
                self.assertEqual(record.whatsapp_status, 'read')
