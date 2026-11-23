# WhatsApp Cloud API local testing

With `WHATSAPP_SEND_MODE=test`, each selected marketing person generates one send to `WHATSAPP_TEST_RECIPIENT`. Each selected customer generates one send to `WHATSAPP_CUSTOMER_TEST_RECIPIENT`; the selected end customer is included only when chosen in **Add recipient**. See [Customer dispatch](customer-dispatch.md) for the customer workflow and live routing.

## Meta dashboard setup

1. Create or open your Meta Developer app and add the WhatsApp product. Open **WhatsApp > API Setup** (or **Getting Started**, depending on the dashboard layout).
2. Under **From**, select Meta's provided test number and copy its **Phone number ID** into `WHATSAPP_PHONE_NUMBER_ID`. This is the numeric ID, not the visible phone number.
3. Copy the dashboard's **temporary access token** into `WHATSAPP_ACCESS_TOKEN`. It expires; replace it and restart the backend when Meta reports expiration. Keep it only in the backend `.env`.
4. Under **To**, add your own WhatsApp number and complete Meta's verification code flow. Set `WHATSAPP_TEST_RECIPIENT` to that verified international number, using digits and optional leading `+` only. To test the optional customer copy, verify a second recipient and set `WHATSAPP_CUSTOMER_TEST_RECIPIENT` to it. Do not use a marketing contact's number for either test destination.
5. Set `WHATSAPP_API_VERSION=v26.0` (or the supported version shown by your current Meta API setup). Copy `.env.example` to `.env` and fill all four variables. Never commit `.env`.

## Start locally

The existing Docker setup is `docker compose up --build`. Run `docker compose exec backend alembic upgrad11e head` on **both new and existing databases** to add the WhatsApp test history fields. On a fresh database, also run `docker compose exec backend python -m app.scripts.create_super_admin --username admin` and enter a password at the prompt. The frontend runs at `http://localhost:1711`, backend at `http://localhost:1609`, and Swagger UI at `http://localhost:1609/docs`. For separate local processes, use the existing backend virtual environment, install `backend/requirements.txt`, run migrations with `alembic upgrade head`, start `uvicorn app.main:app --reload` from `backend`, and run `npm install && npm start` from `frontend`. Set the backend database URL for your local PostgreSQL instance when not using Docker.

Log into the application. Its existing bearer token is required on all WhatsApp endpoints; in Swagger, authorize with the login route first. The Dispatch page now selects a customer and shows the assigned marketing person. In test mode, Send always requests `WHATSAPP_TEST_RECIPIENT`; checking the customer copy option also requests `WHATSAPP_CUSTOMER_TEST_RECIPIENT`. The old `/api/v1/dispatch/send` route returns 410. Test sends appear in `/dispatch/history` with the customer, assigned marketing person, and actual test destination. The older `/api/v1/whatsapp/text` and `/media` demo endpoints remain available; their selected contact IDs are demo selections only.

Only sends made after this history change are recorded. Earlier test messages that were not saved in the database cannot be reconstructed from Meta without incoming-message or history synchronization support.

## Manually open the customer-service window

From the **verified recipient's** WhatsApp account, send a normal message to **Meta's test phone number** shown under **From**. Then, within 24 hours of that message, send a free-form test message from this application. If Meta returns error `131047`, send another message from that recipient to the Meta test number and retry. This app does not open or track the window.

## Send tests

On the Dispatch page, select a customer, enter text, and click the send arrow. For an attachment, choose JPG/JPEG or PNG (up to 5 MB) or PDF (up to 100 MB). Any text entered with a file is its caption. In test mode, one media message is submitted to the primary test number and, if the customer copy is checked, one more to the second test number. The results show whether Meta accepted each request. Acceptance does not establish delivery or reading.

API endpoints (all require `Authorization: Bearer <app-login-token>`):

| Endpoint | Body | Result |
| --- | --- | --- |
| `POST /api/v1/whatsapp/text` | JSON `{"message":"Bilty BLT-1025 dispatched","demo_contact_ids":[1,2]}` | `{"message_id":"wamid...","status":"accepted","record_id":123}` |
| `POST /api/v1/whatsapp/media` | multipart `file`, optional `caption`, and repeated optional `demo_contact_ids` | Same result; file is saved locally, uploaded to Meta, then sent by media ID |

Example commands:

```sh
curl -X POST http://localhost:1609/api/v1/whatsapp/text \
  -H "Authorization: Bearer $APP_TOKEN" -H 'Content-Type: application/json' \
  -d '{"message":"Bilty BLT-1025 dispatched"}'

curl -X POST http://localhost:1609/api/v1/whatsapp/media \
  -H "Authorization: Bearer $APP_TOKEN" \
  -F 'file=@./bilty.jpg;type=image/jpeg' -F 'caption=Bilty BLT-1025 dispatched'

curl -X POST http://localhost:1609/api/v1/whatsapp/media \
  -H "Authorization: Bearer $APP_TOKEN" \
  -F 'file=@./bilty.pdf;type=application/pdf' -F 'caption=Bilty PDF'
```

Swagger UI exposes the same text and media forms. Use **Authorize** with the application login token, then **Try it out** on each route.

## Common failures

| Response | Action |
| --- | --- |
| 503 missing or invalid configuration | Set all four backend variables and restart FastAPI. |
| 502 token rejected or Meta code 190 | Replace the expired temporary token and restart FastAPI. |
| 422 unverified recipient / Meta code 131030 | Verify the recipient in Meta's dashboard and check its international number. |
| 409 / Meta code 131047 | Manually message the Meta test number from the verified recipient to reopen the 24-hour window. |
| 413 / 415 | Use a real JPG/PNG under 5 MB or PDF under 100 MB, with matching extension and MIME type. |
| 502 media or message failure | Check backend log for the HTTP status and Meta error code, then verify Meta dashboard settings. |
| 504 timeout | Check WhatsApp before retrying; an uncertain response may have been accepted by Meta. |

The backend logs only status/error codes, not tokens or raw Meta error bodies. A successful HTTP response means Meta **accepted** the request, not that the recipient received it. Failed and uncertain Meta submissions remain in the database for diagnostics but are hidden from the History page, contact conversations, and dashboard recent list. A timeout is recorded as **status uncertain** because Meta might have accepted it. Local validation errors are rejected before a history record is created. Delivery and read tracking require the webhook setup below.

## Delivery and read receipts

The backend accepts Meta webhooks at `/api/v1/whatsapp/webhook`. Set `WHATSAPP_WEBHOOK_VERIFY_TOKEN` to a long random value you choose, and `WHATSAPP_APP_SECRET` to the app secret from Meta's developer dashboard. Keep both private and restart the backend after setting them. The verify token is separate from the access token and the app secret.

Expose the backend over public HTTPS (see [ngrok.md](ngrok.md) for local testing), then enter the complete URL, for example `https://your-domain.example/api/v1/whatsapp/webhook`, and the same verify token in the WhatsApp webhook configuration in Meta's app dashboard. Subscribe to the `messages` field and ensure the WhatsApp Business Account is subscribed to the app. Test by sending a message and checking dispatch history after delivery or reading. A local tunnel must remain running; use a stable public URL in production.

Signed delivery updates change the existing message status to sent, delivered, read or failed. Incoming message content is ignored. Read status depends on WhatsApp providing a read receipt. Messages sent before webhook setup may not have delivery updates, and a status received before its message ID is saved is retried while a send is pending.
