import hashlib
import hmac
import json
from unittest.mock import patch

import httpx
from tests.test_whatsapp import WhatsAppRouteTests
from app.config import settings
from app.models.dispatch import Dispatch
from app.models.incoming_message import IncomingMessage
from app.models.customer import Customer
from app.models.marketing_person import MarketingPerson


class WebhookTests(WhatsAppRouteTests):
    async def test_dispatch_conversation_includes_assigned_marketing_messages(self):
        from datetime import datetime, timezone
        person = self.db.query(MarketingPerson).filter_by(phone_number='15550000001').one()
        customer = Customer(full_name='Customer', phone_number='15550000002', marketing_person_id=person.id)
        self.db.add(customer)
        self.db.add_all([
            IncomingMessage(whatsapp_message_id='marketing-message', sender_number=person.phone_number,
                            message_type='text', message_text='General reply', timestamp=datetime.now(timezone.utc)),
            IncomingMessage(whatsapp_message_id='unrelated-message', sender_number='15550000003',
                            message_type='text', message_text='Unrelated', timestamp=datetime.now(timezone.utc)),
        ])
        self.db.commit()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=__import__('app.main', fromlist=['app']).app), base_url='http://test') as client:
            response = await client.get('/api/v1/incoming', params={'conversation_customer_id': customer.id})
            self.assertEqual(response.status_code, 200)
            self.assertEqual([item['message_text'] for item in response.json()], ['General reply'])
            response = await client.get('/api/v1/incoming', params={'customer_id': customer.id})
            self.assertEqual(response.json(), [])

    async def test_incoming_media_is_fetched_from_meta_and_rejects_untrusted_urls(self):
        from datetime import datetime, timezone
        message = IncomingMessage(whatsapp_message_id='wamid.inbound.image', sender_number='15550000001',
                                  message_type='image', media_id='123456', media_mime='image/jpeg',
                                  timestamp=datetime.now(timezone.utc))
        self.db.add(message)
        self.db.commit()
        calls = []
        url = ['https://lookaside.fbsbx.com/file']
        def handler(request):
            calls.append((request.url.host, request.headers.get('authorization')))
            if request.url.host == 'graph.facebook.com':
                return httpx.Response(200, json={'url': url[0]})
            return httpx.Response(200, content=b'image bytes')
        real_client = httpx.AsyncClient
        async with real_client(transport=httpx.ASGITransport(app=__import__('app.main', fromlist=['app']).app), base_url='http://test') as client:
            with patch.object(settings, 'WHATSAPP_ACCESS_TOKEN', 'test-token'), patch('app.api.v1.endpoints.incoming.httpx.AsyncClient', side_effect=lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs)):
                response = await client.get(f'/api/v1/incoming/{message.id}/file')
                self.assertEqual(response.content, b'image bytes')
                self.assertEqual(calls, [('graph.facebook.com', 'Bearer test-token'), ('lookaside.fbsbx.com', 'Bearer test-token')])
                calls.clear()
                url[0] = 'https://example.com/steal-token'
                response = await client.get(f'/api/v1/incoming/{message.id}/file')
                self.assertEqual(response.status_code, 502)
                self.assertEqual([host for host, _ in calls], ['graph.facebook.com'])

    async def test_received_messages_are_stored_once_and_matched_to_shared_numbers(self):
        person = self.db.query(MarketingPerson).filter_by(phone_number='15550000001').one()
        self.db.add_all([Customer(full_name='First', phone_number='15550000001', marketing_person_id=person.id),
                         Customer(full_name='Second', phone_number='15550000001', marketing_person_id=person.id)])
        self.db.commit()
        customers = self.db.query(Customer).order_by(Customer.id).all()
        payload = {'object': 'whatsapp_business_account', 'entry': [{'changes': [{'value': {
            'metadata': {'phone_number_id': '123'}, 'contacts': [{'wa_id': '15550000001', 'profile': {'name': 'Sender'}}],
            'messages': [{'from': '15550000001', 'id': 'wamid.inbound', 'timestamp': '1700000000',
                          'type': 'text', 'text': {'body': 'Hello'}},
                         {'from': '15550000001', 'id': 'wamid.image', 'timestamp': '1700000001',
                          'type': 'image', 'image': {'id': '123456', 'mime_type': 'image/jpeg', 'caption': 'Photo'}}]
        }}]}]}
        body = json.dumps(payload).encode()
        sig = hmac.new(b'secret', body, hashlib.sha256).hexdigest()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=__import__('app.main', fromlist=['app']).app), base_url='http://test') as client:
            with patch.object(settings, 'WHATSAPP_APP_SECRET', 'secret'), patch.object(settings, 'WHATSAPP_PHONE_NUMBER_ID', '123'):
                for _ in range(2):
                    response = await client.post('/api/v1/whatsapp/webhook', content=body, headers={'x-hub-signature-256': 'sha256=' + sig})
                    self.assertEqual(response.status_code, 200)
                self.assertEqual(self.db.query(IncomingMessage).filter(IncomingMessage.sender_number == '15550000001').count(), 2)
                for params in ({'person_id': person.id}, *({'customer_id': c.id} for c in customers)):
                    response = await client.get('/api/v1/incoming', params=params)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual([item['message_text'] for item in response.json()], ['Photo', 'Hello'])
                    self.assertEqual(response.json()[0]['file_path'], 'incoming.jpg')

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
