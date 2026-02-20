# Server

Go server providing authentication, data synchronization, premium billing, cloud job offload, and web UI for the desktop application.

## Architecture

```
cmd/web/           → Entry point, config, server bootstrap
internal/
  auth/            → User registration, login, sessions (username+password, bcrypt)
  middleware/      → Request logging, CORS, auth guards, premium/admin gates
  database/        → sqlite/postgres connection, migrations, model types
    sqlc/          → sqlc-generated query boilerplate (sqlite + postgres)
  sync/            → Note & recording sync, delta sync
  store/           → S3-compatible object storage (MinIO / AWS S3)
  billing/         → Stripe integration + admin override for premium
  jobs/            → Transcription/summarization job queue with worker adapters
  api/             → JSON REST API for desktop client
  web/             → Server-rendered HTML pages (auth, dashboard, notes, devices, billing)
migrations/        → SQL migration files
  sqlite/          → Development migrations
  postgres/        → Production migrations
db/
  query/           → sqlc query files
  schema/          → sqlc schema files
templates/         → Go HTML templates
static/            → CSS and static assets
```

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Go 1.25+](https://go.dev/dl/) for local development

### Run with Docker Compose

```bash
cd server

# Copy and configure environment
cp .env.example .env

# Start all services (server + Postgres + MinIO)
docker compose up -d

# Server runs at http://localhost:8080
# MinIO console at http://localhost:9001
```

### Local Development

```bash
cd server

# Optional: if using sqlite for dev, only MinIO is needed
docker compose up -d minio

# Install Go dependencies
go mod tidy

# Generate SQL boilerplate
sqlc generate -f sqlc.yaml

# Run server
go run ./cmd/web
```

## API Endpoints

### Authentication

| Method | Path                    | Description                  |
| ------ | ----------------------- | ---------------------------- |
| POST   | `/api/v1/auth/register` | Create account               |
| POST   | `/api/v1/auth/login`    | Login, returns session token |
| POST   | `/api/v1/auth/logout`   | End session                  |
| GET    | `/api/v1/auth/me`       | Current user info            |

### Sync

| Method | Path                                 | Description               |
| ------ | ------------------------------------ | ------------------------- |
| GET    | `/api/v1/sync/delta?since=<RFC3339>` | Get changes since cursor  |
| PUT    | `/api/v1/sync/cursor`                | Update device sync cursor |

### Notes

| Method | Path                 | Description           |
| ------ | -------------------- | --------------------- |
| POST   | `/api/v1/notes`      | Create or update note |
| GET    | `/api/v1/notes/{id}` | Get note              |
| DELETE | `/api/v1/notes/{id}` | Soft-delete note      |

### Recordings

| Method | Path                              | Description                 |
| ------ | --------------------------------- | --------------------------- |
| POST   | `/api/v1/recordings`              | Create recording metadata   |
| POST   | `/api/v1/recordings/upload-url`   | Get pre-signed upload URL   |
| POST   | `/api/v1/recordings/download-url` | Get pre-signed download URL |
| DELETE | `/api/v1/recordings/{id}`         | Soft-delete recording       |

### Jobs (Premium)

| Method | Path                | Description                            |
| ------ | ------------------- | -------------------------------------- |
| POST   | `/api/v1/jobs`      | Submit transcription/summarization job |
| GET    | `/api/v1/jobs/{id}` | Get job status                         |
| GET    | `/api/v1/jobs`      | List jobs                              |

### Billing

| Method | Path                       | Description                    |
| ------ | -------------------------- | ------------------------------ |
| GET    | `/api/v1/billing/status`   | Get premium/billing status     |
| POST   | `/api/v1/billing/checkout` | Create Stripe checkout session |
| POST   | `/api/v1/billing/webhook`  | Stripe webhook endpoint        |

## Configuration

All configuration is via environment variables. See `.env.example` for defaults.

### Database Modes

| Mode        | `DATABASE_DRIVER` | `DATABASE_URL` example                              |
| ----------- | ----------------- | --------------------------------------------------- |
| Development | `sqlite`          | `file:./data/dev.db`                                |
| Production  | `postgres`        | `postgres://user:pass@host:5432/db?sslmode=disable` |

### Premium Modes

| Mode             | Description                                     |
| ---------------- | ----------------------------------------------- |
| `all_premium`    | Everyone has premium (default for self-hosted)  |
| `admin_override` | Admin grants premium per-user via database flag |
| `stripe`         | Premium requires active Stripe subscription     |

### Storage Model

Notes and recordings are stored as plaintext in the object store:

- Notes are stored as JSON with fields: `id`, `transcription`, `summary`, `metadata`
- Recordings store metadata and binary audio data in object storage

## Web UI

The server includes a web interface for managing notes and sessions:

| Path          | Description          |
| ------------- | -------------------- |
| `/`           | Home page            |
| `/login`      | User login           |
| `/register`   | User registration    |
| `/dashboard`  | Main dashboard       |
| `/notes`      | List all notes       |
| `/notes/new`  | Create new note      |
| `/notes/{id}` | View/edit note       |
| `/devices`    | List active sessions |
| `/settings`   | User settings        |
| `/billing`    | Billing management   |

## Deployment

### Self-Hosted

```bash
docker compose up -d
```

Set `PREMIUM_MODE=all_premium` for full feature access without Stripe.

`docker-compose.yml` is configured with `DATABASE_DRIVER=postgres` for production-like deployment.

### Cloud/SaaS

Configure Stripe environment variables and set `PREMIUM_MODE=stripe` for subscription-based premium access.
