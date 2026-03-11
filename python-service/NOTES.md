# Briefing Report Generator — Implementation Guide

This document explains the implementation of **Part A (FastAPI/Python)** in the `python-service` project: storing briefings, validating input, generating an HTML report via a template, and exposing the required APIs.

---

## 1. Overview

**What was built**

- **Create briefing** from structured JSON input.
- **Retrieve briefing** as structured JSON.
- **Generate report** for an existing briefing (server-side HTML, with a formatter layer).
- **Fetch rendered HTML** for a previously generated report.

**Key design points**

- Strong **validation** with Pydantic (ticker normalization, key point/risk counts, metric uniqueness).
- **Normalized relational schema** for briefings: a main `briefings` table plus `briefing_points` and `briefing_metrics` tables, all backed by migrations.
- A dedicated **service layer** (`brief_service`) for persistence logic.
- A **formatter layer** (`ReportFormatter`) to build a view model and render a Jinja2 template.
- Clean **API surface** (`/briefings`) with clear responsibilities per endpoint.

---

## 2. Architecture

High-level flow for the briefing feature:

```text
Client
  │
  ▼
FastAPI router (app/api/brief.py)
  • POST   /briefings            → create_brief_handler
  • GET    /briefings/{id}       → get_brief_handler
  • POST   /briefings/{id}/generate → generate_report_handler
  • GET    /briefings/{id}/html  → get_report_html_handler
  │
  ▼
Service layer (app/services/brief_service.py)
  • create_brief
  • get_brief / get_briefs
  • update_brief
  • store_generated_report
  │
  ▼
SQLAlchemy models (app/db/base.py)
  • Briefing       (table: briefings)
  • BriefingPoint  (table: briefing_points)
  • BriefingMetric (table: briefing_metrics)
  │
  ▼
Formatter + template (app/services/report_formatter.py + app/templates/base.html)
  • _build_view_model(Brief) → BriefModel
  • render_base(Brief) → HTML string
```

**Separation of concerns**

- **Router**: HTTP concerns (paths, status codes, error mapping).
- **Service**: DB operations and domain logic (create/update/fetch, mark generated + store HTML).
- **Formatter**: transforms DB record into a view model and renders the Jinja2 template.
- **Model**: Pydantic `BriefModel` for validation and view modeling; SQLAlchemy `Brief` for persistence.

---

## 3. Data Model

### 3.1 SQLAlchemy models (`app/db/base.py`)

The briefing data is modeled using **three** tables:

#### 3.1.1 `briefings`

| Column          | Type           | Description                                      |
|----------------|----------------|--------------------------------------------------|
| id             | serial (int)   | Primary key                                      |
| ticker         | varchar(10)    | Ticker symbol (uppercased)                      |
| companyName    | varchar(255)   | Company name                                     |
| analystName    | varchar(255)   | Analyst name                                     |
| sector         | varchar(255)   | Sector                                           |
| summary        | text           | Executive summary                                |
| recommendation | varchar(255)   | Recommendation                                   |
| generated      | boolean        | Whether HTML report has been generated          |
| report_html    | text, nullable | Persisted HTML for the generated report         |
| created_at     | timestamptz    | Created timestamp                                |
| updated_at     | timestamptz    | Updated timestamp                                |

ORM class: `Briefing`.

#### 3.1.2 `briefing_points`

Represents both key points and risks; they are distinguished by `kind`.

| Column      | Type         | Description                                          |
|------------|--------------|------------------------------------------------------|
| id         | serial (int) | Primary key                                          |
| briefing_id| int          | FK → `briefings.id`, `ON DELETE CASCADE`             |
| kind       | varchar(16)  | `"key"` for key point, `"risk"` for risk item        |
| text       | text         | The point/risk text                                  |
| position   | int          | Display order within its kind                        |

Index: `idx_briefing_points_briefing_id_kind` on `(briefing_id, kind, position)`  
ORM class: `BriefingPoint`.

#### 3.1.3 `briefing_metrics`

Represents metrics as separate rows.

| Column      | Type         | Description                                          |
|------------|--------------|------------------------------------------------------|
| id         | serial (int) | Primary key                                          |
| briefing_id| int          | FK → `briefings.id`, `ON DELETE CASCADE`             |
| name       | varchar(255) | Metric name (unique per briefing)                    |
| value      | varchar(255) | Metric value                                         |

Unique index: `uq_briefing_metrics_briefing_id_name` on `(briefing_id, name)`  
ORM class: `BriefingMetric`.

This normalized schema satisfies the spec’s suggestion of `briefings`, `briefing_points`, and `briefing_metrics`, and keeps relationships explicit and queryable.

### 3.2 Migrations (`python-service/db/migrations`)

Existing starter migrations:

- `001_create_sample_items.sql` / `.down.sql` — starter sample items.
- `002_rename_brief_columns.sql` / `.down.sql` — rename columns on `briefs` to camelCase.

New migrations:

- `003_add_brief_report_html.sql` / `.down.sql` — (legacy) added `report_html` and nullable `metrics` to the old `briefs` table.
- `004_normalize_briefings.sql` / `.down.sql` — **current schema**:
  - **Up**:
    - Drops any previous `briefs`/`briefings`/`briefing_points`/`briefing_metrics` tables if present.
    - Creates `briefings`, `briefing_points`, and `briefing_metrics` as described above.
    - Adds the relevant indexes and unique constraints.
  - **Down**:
    - Drops `briefing_metrics`, `briefing_points`, `briefings`.
    - Recreates a simple `briefs` table similar to the original JSONB design.

Run all migrations from `python-service`:

```bash
cd python-service
python -m app.db.run_migrations up
```

---

## 4. Pydantic Validation (`app/models/base.py`)

### 4.1 BriefModel shape

`BriefModel` is the validated DTO used both for request input and as a view model:

- `ticker: str` — required; normalized to uppercase.
- `companyName: str` — required.
- `analystName: str` — required.
- `sector: str` — required.
- `summary: str` — required.
- `recommendation: str` — required.
- `keyPoints: List[str>` — required; **at least 2** non-empty strings.
- `risks: List[str>` — required; **at least 1** non-empty string.
- `metrics: Optional[List[Dict[str, str]]]` — optional list of `{name, value}` objects, with **unique `name` values** within a briefing.
- `generated: bool` — whether a report has been generated.

### 4.2 Validation rules implemented

- **Ticker normalization**:
  - Strips whitespace and uppercases the ticker.
  - Raises if empty after normalization.
- **Key points**:
  - Filters out empty/whitespace-only entries.
  - Requires at least 2 remaining key points.
- **Risks**:
  - Filters out empty/whitespace-only entries.
  - Requires at least 1 remaining risk.
- **Metrics**:
  - Accepts `None` or a list of `{name, value}`.
  - Strips whitespace on both `name` and `value`.
  - Requires non-empty `name` for every metric.
  - Enforces that metric names are **unique** within a single briefing.

These validators ensure that all functional validation requirements from the spec are enforced consistently at the API boundary.

---

## 5. Service Layer (`app/services/brief_service.py`)

The service encapsulates DB operations and domain logic around briefings:

- `create_brief(session, brief: BriefModel) -> Briefing`
  - Inserts a new `Briefing` row, mapping scalar fields from the validated `BriefModel`.
  - Inserts rows into `briefing_points` for each key point (kind `"key"`) and risk (kind `"risk"`) with appropriate `position`.
  - Inserts rows into `briefing_metrics` for each metric (`{name, value}`).

- `get_brief(session, brief_id: int) -> Briefing | None`
  - Fetches a single `Briefing` by id (points and metrics are accessible via relationships).

- `get_briefs(session) -> list[Briefing]`
  - Returns all `Briefing` rows.

- `update_brief(session, brief_id: int, brief: BriefModel) -> Briefing`
  - Loads the existing `Briefing`.
  - Updates scalar fields (ticker, companyName, etc.).
  - Clears existing `briefing_points` and `briefing_metrics` for that briefing and reinserts rows from the new `BriefModel`.

- `store_generated_report(session, brief_id: int, html: str) -> Briefing`
  - Marks the briefing as generated (`generated=True`).
  - Persists the rendered HTML to `report_html` on the `briefings` table.
  - Returns the updated `Briefing`.

All DB writes for the briefing feature go through these functions, keeping controllers thin.

---

## 6. Formatter + HTML Template

### 6.1 ReportFormatter (`app/services/report_formatter.py`)

`ReportFormatter` handles the transformation of normalized DB records into a template-friendly view model and rendering the Jinja2 template:

- Uses `Environment` with:
  - `FileSystemLoader` pointed at `app/templates`.
  - `select_autoescape` to safely escape HTML/XML.

Methods:

- `_build_view_model(briefing: Briefing) -> BriefModel`
  - Reads from the normalized tables via relationships:
    - Builds `keyPoints` from `briefing.points` where `kind == "key"`, ordered by `position`.
    - Builds `risks` from `briefing.points` where `kind == "risk"`, ordered by `position`.
    - Builds `metrics` as a list of `{name, value}` from `briefing.metrics`, sorted by metric name.
  - Returns a `BriefModel` constructed from these lists plus the scalar fields (ticker, companyName, etc.).

- `render_base(briefing: Briefing) -> str`
  - Fetches the `base.html` template.
  - Calls `_build_view_model` to get the view model.
  - Renders the template with:
    - `brief` → the view model.
    - `generated_at` → a generated timestamp (ISO-8601).

- `generated_timestamp() -> str`
  - Returns an ISO-8601 UTC timestamp.

### 6.2 HTML template (`app/templates/base.html`)

The `base.html` template is a semantic, styled HTML report. It includes:

- **Title/Header**:
  - `<title>{{ brief.companyName }} Report</title>`
  - `<h1>{{ brief.companyName }} ({{ brief.ticker }})</h1>`
- **Company info block**:
  - Analyst name and sector.
- **Executive summary**:
  - “Summary” section with the main summary text.
- **Key points**:
  - “Key Points” section as a `<ul>` of `brief.keyPoints`.
- **Risks**:
  - “Risks” section as a `<ul>` of `brief.risks`.
- **Recommendation**:
  - “Recommendation” section with the recommendation text.
- **Metrics**:
  - Conditional `Metrics` section:
    - Only rendered if `brief.metrics` is present.
    - Each metric shown as `<strong>{{ metric.name }}:</strong> {{ metric.value }}`.
- **Footer**:
  - `Generated at: {{ generated_at }}`.

Autoescaping is enabled in the Jinja2 environment, so user-provided content is escaped by default.

---

## 7. API Endpoints (`app/api/brief.py`)

All briefing endpoints are grouped under the router prefix `/briefings` with tag `"briefings"`.

### 7.1 Create briefing

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
    { "name": "Revenue Growth", "value": "18%" },
    { "name": "Operating Margin", "value": "22.4%" }
  ]
}
```

Behavior:

- Validates using `BriefModel` (including normalization and rules).
- Calls `create_brief`.
- Returns the created briefing as a `BriefModel` (response_model).

### 7.2 Retrieve briefing

```http
GET /briefings/{id}
```

Behavior:

- Uses `get_brief`.
- If not found → **404 Not Found**.
- Otherwise returns `BriefModel` representation of the briefing.

### 7.3 Generate report

```http
POST /briefings/{id}/generate
```

Behavior:

- Loads the briefing (`get_brief`), 404 if missing.
- Uses `ReportFormatter.render_base` to produce HTML.
- Calls `store_generated_report` to:
  - Mark `generated=True`.
  - Persist HTML into `report_html`.
- Returns **202 Accepted** with `{ "id": <brief_id>, "generated": true }`.

This implements the required “generate a report” step:

- Reads stored data.
- Transforms it into a view model via the formatter.
- Renders HTML.
- Marks the briefing as generated.

### 7.4 Fetch rendered HTML

```http
GET /briefings/{id}/html
```

Behavior:

- Loads the briefing (`get_brief`).
- If not found → **404 Not Found**.
- If `generated` is `False` or `report_html` is empty → **404 Not Found** with a message indicating that the report has not been generated.
- Otherwise returns:
  - Response body: HTML from `report_html`.
  - `Content-Type: text/html`.

This endpoint does **not** regenerate HTML; it serves the stored output.

---

## 8. How to Run (Python service)

From the repo root:

```bash
cd python-service
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Set environment variables as needed (see `python-service/.env` and `python-service/README.md`), especially the database URL.

Run migrations:

```bash
python -m app.db.run_migrations up
```

Start the app:

```bash
uvicorn app.main:app --reload --port 8000
```

Then you can:

1. `POST /briefings` to create a briefing.
2. `GET /briefings/{id}` to retrieve it.
3. `POST /briefings/{id}/generate` to generate the report.
4. `GET /briefings/{id}/html` to fetch the rendered HTML.

---

## 9. Design & Schema Decisions

- **Normalized briefings**: In line with the spec’s suggestion, this implementation uses a normalized schema with `briefings`, `briefing_points`, and `briefing_metrics` tables instead of a single JSONB-heavy table. This makes relationships explicit, enforces constraints at the DB level, and keeps the design maintainable.

- **Metrics as rows + unique index**: Metrics are modeled as rows in `briefing_metrics` with a unique index on `(briefing_id, name)`. This enforces the “metric names must be unique within the same briefing” rule at the database level in addition to the Pydantic validation.

- **Generated HTML in the main table**: The `report_html` column lives directly on `briefings`, avoiding a separate table for reports. This keeps retrieval straightforward (`GET /briefings/{id}/html`) while still being normalized for points and metrics.

- **Formatter abstraction**: All template-facing transformation is centralized in `ReportFormatter._build_view_model`, which rebuilds the `BriefModel` from normalized tables (grouping/sorting points, ordering metrics, and injecting metadata) rather than passing ORM instances or raw request payloads to the template.

- **Validation at the boundary**: All required rules are enforced by `BriefModel` before data hits the service or DB, ensuring that stored data is always valid and consistent with the schema.

---

## 10. What could be improved with more time

- **Created/updated timestamps everywhere**: The normalized schema adds `created_at` / `updated_at` to `briefings`. Similar timestamps on `briefing_points` and `briefing_metrics` could be added for full auditing.

- **Pagination & filtering**: Add pagination for listing briefings and optional filters (by ticker, sector, date range).

- **More sophisticated formatting**: E.g., grouping metrics, ordering sections by importance, or adding computed fields such as a synthesized headline.

- **Tests**: Add unit and integration tests for:
  - Validation rules on `BriefModel`.
  - Service functions (`create_brief`, `update_brief`, `store_generated_report`).
  - Endpoints (`/briefings`, `/briefings/{id}`, `/briefings/{id}/generate`, `/briefings/{id}/html`) using a test database.

This guide can be used to quickly review and reason about the entire briefing implementation in the Python service.

