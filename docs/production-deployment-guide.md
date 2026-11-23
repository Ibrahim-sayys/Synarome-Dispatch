# Production deployment guide

This guide describes a recommended approach for deploying Synarome Dispatch to a VPS. It is a plan, not a record of a deployment: the production configuration and automation described here still need to be created and tested.

## The overall flow

1. Develop and test changes on your computer.
2. Push the changes to GitHub.
3. GitHub Actions runs tests and builds versioned Docker images.
4. A deployment workflow connects securely to the VPS, pulls the images, runs any required database migrations, and updates the containers.
5. Check that the application and WhatsApp webhook work after deployment.

For a first deployment, use a manually triggered workflow after tests pass. Automatic deployment from an approved branch can be added once the process is reliable. GitHub Actions provides the automation; a custom GitHub webhook is not required.

## 1. Prepare production containers

The current Docker setup is designed for development. Before deploying, create production configuration that:

- Builds the Angular frontend into static files and serves those files with a web server.
- Runs the FastAPI backend without development auto-reload.
- Uses a production Compose configuration without source-code bind mounts.
- Keeps PostgreSQL data and uploaded files in persistent volumes.
- Uses a production API address or a same-origin `/api` proxy instead of `localhost:1609` in the frontend.
- Sets appropriate restart policies and health checks.

See Docker's [Compose production guide](https://docs.docker.com/compose/how-tos/production/).

## 2. Prepare the VPS and domain

1. Create a VPS and connect to it over SSH using a securely stored SSH key. SSH is a secure way to open a terminal on the server.
2. Install Docker and Docker Compose, apply operating system security updates, and configure a firewall.
3. Point your domain's DNS record to the VPS public IP address.
4. Set up a reverse proxy such as Caddy or Nginx. It should serve the frontend over HTTPS and forward `/api` requests to the backend.
5. Keep PostgreSQL private on the Docker network. Do not expose its port publicly. Restrict SSH access and expose only the public web ports needed by the proxy.

A permanent HTTPS domain replaces the local ngrok tunnel for production. Configure Meta's webhook to use the production backend URL, for example `https://your-domain.example/api/v1/whatsapp/webhook`.

## 3. Configure secrets and persistent data

Create a separate production configuration on the VPS for the database connection, a strong application signing secret, WhatsApp credentials, and webhook verification and signing secrets. Never commit real credentials or the production `.env` file to GitHub. Limit access to those values and rotate them if exposed. Docker also supports [Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/).

The actual WhatsApp business phone number ID and a valid access token must both be configured. Confirm Meta account eligibility, recipient numbers, and the rules for free-form messages and approved templates before sending.

Create automated backups of **both** PostgreSQL and uploaded files, store copies away from the VPS, and periodically test restoring them. Docker volumes persist across normal container replacements, but they are not backups.

## 4. Set up GitHub Actions

The deployment workflow can:

1. Run backend tests and build the frontend.
2. Build Docker images and tag them with the commit identifier.
3. Publish the images to a container registry.
4. On manual trigger or an approved release, connect to the VPS using a restricted deployment SSH key.
5. Pull the exact image versions, run the required Alembic migrations, and update the services with Docker Compose.
6. Check application health and report success or failure.

Use protected branches, keep deployment credentials in GitHub's secrets, and prevent overlapping deployments. GitHub [deployment environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments) can provide additional protections; availability depends on the repository and plan.

## 5. Verify and maintain

Before launch, test the production-like setup with representative users, including up to ten simultaneous users, uploads, and dispatches. Use a separate test database and mocked WhatsApp sending for load tests so no real messages are sent. Monitor response times, errors, memory, CPU, disk space, and database connections.

After a deployment, check the website, login, customer searches, dispatch history, and webhook. Perform a controlled real WhatsApp test with an appropriate recipient. Set up monitoring and alerts for outages and low disk space.

Keep the previous image version available for rollback. Database migrations require their own rollback or recovery plan: reverting an image does not automatically reverse a database change. Test backups and recovery before relying on them.

## Project-specific work before launch

- Replace the current development Compose and Docker setup with production configuration.
- Address dispatch interruption and duplicate-send risks, large concurrent uploads, authentication rate limiting, and webhook recovery.
- Verify the production domain, HTTPS, secrets, database access, backup procedures, and WhatsApp account configuration.
- Run the full test suite and a realistic load test against the production-like configuration.
