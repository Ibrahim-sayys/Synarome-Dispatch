# Synarome Dispatch

Synarome Dispatch is a web application for managing bilty dispatches, customers, marketing contacts, and WhatsApp communication in one place.

It helps teams send dispatch information and documents to the right people, review message history, and manage customer assignments through a central dashboard.

## Features

- **Customer management:** Maintain customer records, including contact details, city, and assigned marketing person.
- **Marketing contact management:** Manage the people responsible for receiving customer dispatch information.
- **WhatsApp dispatch:** Send messages and attachments using the WhatsApp Cloud API.
- **Multiple recipients:** Send a dispatch to the assigned marketing person and select additional eligible recipients.
- **Dispatch history:** Review customer conversations, recipients, attachments, and message statuses.
- **Incoming messages:** View supported WhatsApp replies in matching customer and marketing-person conversations.
- **Delivery updates:** Receive supported message status updates through Meta webhooks.
- **User access management:** Manage application users and their permissions.
- **Document scanning:** Use the optional Windows scanner companion to scan documents directly into a dispatch.
- **Media cleanup:** Configure scheduled cleanup of stored dispatch attachments.
- **Dashboard:** Get an overview of dispatch activity and recent records.

## Tech Stack

| Component | Technology |
| --- | --- |
| Frontend | Angular, TypeScript, CSS |
| Backend | FastAPI, Python |
| Database | PostgreSQL |
| ORM and migrations | SQLAlchemy, Alembic |
| Authentication | JWT |
| Messaging | WhatsApp Cloud API |
| Containers | Docker and Docker Compose |
| Scanner integration | Python, Windows Image Acquisition (WIA) |

## How It Works

1. An administrator creates user accounts and manages access.
2. Marketing persons and customers are added to the system.
3. Each customer is assigned a marketing person.
4. A user selects a customer on the Dispatch page and prepares a message or attachment.
5. The application sends the dispatch through the WhatsApp Cloud API to the selected recipients.
6. Dispatch records, supported replies, and available message status updates can be reviewed in the application.

WhatsApp must be configured before messages can be sent. Free-form messages also depend on the applicable WhatsApp customer-service window.

## Project Structure

```text
Synarome-Dispatch/
├── backend/
│   ├── alembic/               # Database migrations
│   ├── app/
│   │   ├── api/               # API routes
│   │   ├── core/              # Security and permissions
│   │   ├── models/            # Database models
│   │   ├── schemas/           # Request and response schemas
│   │   ├── scripts/           # Admin and demo-data scripts
│   │   └── services/          # Application services
│   ├── tests/
│   └── requirements.txt
├── frontend/
│   ├── public/
│   ├── src/
│   └── package.json
├── scanner-companion/         # Optional Windows scanner bridge
├── docs/                      # Setup and operational guides
├── .env.example
└── docker-compose.yml
```

## Getting Started

### Prerequisites

- Docker and Docker Compose
- A Meta developer app with WhatsApp Cloud API access for sending messages
- A Windows computer and WIA-compatible scanner driver if using the optional scanner companion

### 1. Clone the repository

```bash
git clone https://github.com/Ibrahim-sayys/Synarome-Dispatch
cd Synarome-Dispatch
```

### 2. Configure environment variables

Copy the example environment file:

```bash
cp .env.example .env
```

Update `.env` with your database password, a strong application secret, and any WhatsApp credentials you need. Keep `POSTGRES_PASSWORD` and the password in `DATABASE_URL` consistent.

Do not commit `.env` or share access tokens and application secrets.

### 3. Start the application

```bash
docker compose up --build -d
```

### 4. Run database migrations

```bash
docker compose exec backend alembic upgrade head
```

Run this command after pulling changes that include new migrations as well.

### 5. Create the first administrator

```bash
docker compose exec backend python -m app.scripts.create_super_admin --username admin
```

Enter a password when prompted. The password must contain at least eight characters.

### 6. Open the application

| Service | Address |
| --- | --- |
| Frontend | http://localhost:1711 |
| Backend | http://localhost:1609 |
| Interactive API documentation | http://localhost:1609/docs |
| API health check | http://localhost:1609/health |

Sign in with the administrator account you created.

To stop the containers:

```bash
docker compose down
```

The Compose setup uses named volumes for PostgreSQL data and uploaded files.

## Configuration

The `.env.example` file contains the available settings. The main groups are:

| Variable | Purpose |
| --- | --- |
| `POSTGRES_DB` | PostgreSQL database name |
| `POSTGRES_USER` | PostgreSQL username |
| `POSTGRES_PASSWORD` | PostgreSQL password |
| `DATABASE_URL` | SQLAlchemy database connection URL |
| `SECRET_KEY` | Secret used for application authentication |
| `ALGORITHM` | JWT signing algorithm |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Access-token lifetime |
| `WHATSAPP_API_VERSION` | WhatsApp Cloud API version |
| `WHATSAPP_ACCESS_TOKEN` | Meta access token |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp business phone number ID |
| `WHATSAPP_SEND_MODE` | Sending mode: `test` or `live` |
| `WHATSAPP_TEST_RECIPIENT` | Test destination for marketing-person sends |
| `WHATSAPP_CUSTOMER_TEST_RECIPIENT` | Test destination for customer sends |
| `WHATSAPP_DEFAULT_COUNTRY_CODE` | Country code used to normalize local numbers |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Token used to verify the webhook |
| `WHATSAPP_APP_SECRET` | Meta app secret used to verify webhook signatures |
| `UPLOAD_DIR` | Directory for stored dispatch attachments |

The example file also contains settings for approved image and document templates. See [WhatsApp media templates](docs/whatsapp-media-templates.md) for details.

Restart the backend after changing its environment configuration:

```bash
docker compose up -d backend
```

## WhatsApp Setup

1. Create or open a Meta developer app and add the WhatsApp product.
2. Add your WhatsApp phone number ID and access token to `.env`.
3. Start in `test` mode and configure verified test recipient numbers.
4. Configure approved image and document templates where needed.
5. Restart the backend after updating `.env`.
6. Configure the webhook if you want incoming replies and delivery status updates.

In test mode, messages are routed to the configured test destinations. In live mode, they are routed to the selected recipients' actual numbers. Switching to live mode does not itself enable production messaging; your Meta account and recipients must meet Meta's requirements.

For webhook setup, expose the endpoint over public HTTPS:

```text
https://your-domain.example/api/v1/whatsapp/webhook
```

Set the webhook verification token and app secret in `.env`, configure the same verification token in Meta, and subscribe to the `messages` field.

A successful send means Meta accepted the request; it does not by itself confirm delivery. Delivery and read updates depend on webhook events.

See the detailed guides:

- [WhatsApp testing and webhook setup](docs/whatsapp-testing.md)
- [WhatsApp media templates](docs/whatsapp-media-templates.md)
- [Customer dispatch and sending modes](docs/customer-dispatch.md)
- [Sharing a local app with ngrok](docs/ngrok.md)

## Optional: Add Demo Data

After running migrations, you can add sample marketing persons and customers:

```bash
docker compose exec backend python -m app.scripts.seed_demo_data
```

The demo records are marked **(Demo)**, and running the script again does not duplicate them. Their phone numbers are fictitious, so use test mode when exploring dispatches with this data.

## Optional: Windows Scanner Companion

The scanner companion connects the web application to a WIA-compatible scanner on a Windows computer.

1. Copy the `scanner-companion` directory to the Windows computer.
2. Install Python 3 with Tkinter and the scanner's Windows WIA driver.
3. Run **Start Scanner.bat** and enter the exact website address used for Synarome Dispatch.
4. Keep the companion running and open the same website on that computer.
5. In the Dispatch composer, choose **Attach → Scan Document**.

The companion is a development preview. Device capabilities and browser behavior can vary, so test it with your scanner before relying on it.

See the [scanner companion guide](scanner-companion/README.md) for setup, limitations, and troubleshooting.

## Media Retention

A super admin can configure scheduled cleanup of stored dispatch attachments from the account menu. Cleanup removes eligible local attachment files while retaining dispatch records and message details.

The default schedule is created by the database migration. The application must be running to process notices and cleanup. Back up the database and uploaded files, and review the [media retention guide](docs/media-retention.md) before using this feature with important documents.

## Running Tests

Run backend tests inside the backend container:

```bash
docker compose exec backend python -m unittest discover -s tests
```

Run frontend tests:

```bash
docker compose exec frontend npm test
```

Run the scanner companion tests from the repository root:

```bash
python3 -m unittest discover -s scanner-companion -p "test_*.py"
```

The scanner tests simulate scanner operations; they do not test physical scanner hardware.

## Deployment

The included `docker-compose.yml` is intended for development. Before deploying, review your environment configuration, database and upload backups, HTTPS setup, Meta webhook configuration, and deployment process.

See the [production deployment guide](docs/production-deployment-guide.md).

## Additional Documentation

- [Customer dispatch](docs/customer-dispatch.md)
- [WhatsApp testing](docs/whatsapp-testing.md)
- [WhatsApp media templates](docs/whatsapp-media-templates.md)
- [Media retention](docs/media-retention.md)
- [ngrok setup](docs/ngrok.md)
- [Production deployment](docs/production-deployment-guide.md)
- [Scanner companion](scanner-companion/README.md)
