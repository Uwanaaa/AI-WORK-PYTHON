# InsightOps Python Service Starter

FastAPI starter service for the backend assessment.

This service includes:

- FastAPI app bootstrap and health endpoint
- SQLAlchemy wiring
- Manual SQL migration runner
- One small `sample_items` example feature
- **Briefing report feature**:
  - `/briefings` CRUD endpoints
  - Normalized schema (`briefings`, `briefing_points`, `briefing_metrics`)
  - Jinja template + formatter-based HTML generation
- Pytest setup

## Prerequisites

- Python 3.12
- PostgreSQL running from repository root:

```bash
docker compose up -d postgres
```

## Setup

```bash
cd python-service
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

## Environment

`.env.example` includes:

- `DATABASE_URL`
- `APP_ENV`
- `APP_PORT`

## Run Migrations (Manual SQL Runner)

Apply pending migrations:

```bash
cd python-service
source .venv/bin/activate
python -m app.db.run_migrations up
```

Roll back the latest migration:

```bash
cd python-service
source .venv/bin/activate
python -m app.db.run_migrations down --steps 1
```

How it works:

- SQL files live in `python-service/db/migrations/`
- A `schema_migrations` table tracks applied filenames
- Up files are applied in sorted filename order (`*.sql` or `*.up.sql`)
- Rollback uses a paired `*.down.sql` file for each applied migration
- Applied migration files are skipped on subsequent runs

## Run Service

```bash
cd python-service
source .venv/bin/activate
python -m uvicorn app.main:app --reload --port 8000
```

## Briefing API (Part A)

Once the service is running on `http://127.0.0.1:8000`:

1. **Create a briefing**

   ```http
   POST /briefings
   Content-Type: application/json

   {
     "companyName": "Acme Holdings",
     "ticker": "ACME",
     "sector": "Industrial Technology",
     "analystName": "Jane Doe",
     "summary": "...",
     "recommendation": "...",
     "keyPoints": ["...", "..."],
     "risks": ["..."],
     "metrics": [
       { "name": "Revenue Growth", "value": "18%" }
     ]
   }
   ```

2. **Retrieve a briefing**

   ```http
   GET /briefings/{id}
   ```

3. **Generate an HTML report**

   ```http
   POST /briefings/{id}/generate
   ```

4. **Fetch rendered HTML**

   ```http
   GET /briefings/{id}/html
   ```

For a deeper explanation of the schema and flow, see `NOTES.md`.

## Run Tests

```bash
cd python-service
source .venv/bin/activate
python -m pytest
```

## Project Layout

- `app/main.py`: FastAPI bootstrap and router wiring
- `app/config.py`: environment config
- `app/db/`: SQLAlchemy session management and migration runner
- `db/migrations/`: SQL migration files
- `app/models/`: ORM models
- `app/schemas/`: Pydantic request/response schemas
- `app/services/`: service-layer logic and template helpers
- `app/api/`: route handlers
- `app/templates/`: Jinja templates
- `tests/`: test suite
