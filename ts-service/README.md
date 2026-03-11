# TalentFlow TypeScript Service

NestJS service with candidate document intake and LLM-powered summary generation.

## Features

- Nest bootstrap with global validation
- TypeORM + migrations (PostgreSQL)
- Fake auth context (`x-user-id`, `x-workspace-id`) with workspace-scoped access
- **Candidate document upload** — store resumes/cover letters with raw text
- **Async summary generation** — queue-based worker using a summarization provider
- **Summarization provider abstraction** — fake (default) or Google Gemini
- Sample module (workspace-scoped candidates) and in-memory queue

## Prerequisites

- Node.js 22+
- npm
- PostgreSQL (e.g. from repo root: `docker compose up -d postgres`)

## Setup

```bash
cd ts-service
npm install
cp .env.example .env
```

## Environment

| Variable         | Description |
|-----------------|-------------|
| `PORT`          | Server port (default 3000) |
| `DATABASE_URL`  | PostgreSQL connection string |
| `NODE_ENV`      | `development` / `production` |
| `GEMINI_API_KEY`| Optional. If set, summary generation uses **Google Gemini**; otherwise the built-in **fake** provider is used. Do not commit this value. |

Get a free API key from [Google AI Studio](https://aistudio.google.com/apikey) to use real LLM summarization.

## Run Migrations

```bash
npm run migration:run
```

This creates `sample_workspaces`, `sample_candidates`, `candidate_documents`, and `candidate_summaries`.

## Run Service

```bash
npm run start:dev
```

## Fake Auth Headers

All candidate endpoints require:

- `x-user-id`: any non-empty string (e.g. `user-1`)
- `x-workspace-id`: workspace id used for access control (e.g. `workspace-1`)

Recruiters can only access candidates that belong to their workspace.

---

## Candidate Document + Summary API

### 1. Create a candidate (sample module)

```http
POST /sample/candidates
x-user-id: user-1
x-workspace-id: workspace-1
Content-Type: application/json

{"fullName": "Jane Doe", "email": "jane@example.com"}
```

Use the returned `id` as `candidateId` below.

### 2. Upload a candidate document

```http
POST /candidates/:candidateId/documents
x-user-id: user-1
x-workspace-id: workspace-1
Content-Type: application/json

{
  "documentType": "resume",
  "fileName": "jane-resume.txt",
  "rawText": "Full resume text here...",
  "storageKey": "optional/path/key"
}
```

- `documentType`: `resume` | `cover_letter` | `other`
- `storageKey` is optional; a path is generated if omitted.

### 3. Request summary generation (async)

```http
POST /candidates/:candidateId/summaries/generate
x-user-id: user-1
x-workspace-id: workspace-1
```

Returns **202 Accepted** with `{ "summaryId": "...", "status": "pending" }`.  
A background worker processes the job and updates the summary (status `completed` or `failed`). Poll the get-summary endpoint to see the result.

### 4. List summaries for a candidate

```http
GET /candidates/:candidateId/summaries
x-user-id: user-1
x-workspace-id: workspace-1
```

### 5. Get a single summary

```http
GET /candidates/:candidateId/summaries/:summaryId
x-user-id: user-1
x-workspace-id: workspace-1
```

Summary fields include: `id`, `candidateId`, `status`, `score`, `strengths`, `concerns`, `summary`, `recommendedDecision`, `provider`, `promptVersion`, `errorMessage` (if failed), `createdAt`, `updatedAt`.

---

## LLM Provider

- **Fake provider** (default when `GEMINI_API_KEY` is unset): returns stub data; no external calls. Used for local dev and tests.
- **Gemini provider**: when `GEMINI_API_KEY` is set, the app uses the **Google Gemini REST API** (model `gemini-flash-latest`) via `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent` to generate structured summaries. The provider asks for JSON output and validates it before persisting; invalid or malformed responses are treated as failures and stored with `status: failed` and `errorMessage` set.

**Assumptions / limitations**

- Summary generation runs in-process: a polling worker checks the in-memory queue every 2 seconds. For production you would replace this with a proper job queue (e.g. Bull, SQS).
- Document text is passed in the request body (`rawText`); no file upload parsing. File contents are assumed to be already extracted as text.
- Candidates are the existing `sample_candidates`; workspace is enforced on every candidate operation.

## Tests

Unit and e2e tests use the **fake** summarization provider only (no live API calls).

```bash
npm test
npm run test:e2e
```

## Layout

- `src/auth/` — fake auth guard, `@CurrentUser()`, auth types
- `src/candidates/` — document upload, summary generation, list/get summaries, worker
- `src/entities/` — TypeORM entities (including `CandidateDocument`, `CandidateSummary`)
- `src/llm/` — `SummarizationProvider` interface, fake and Gemini implementations
- `src/queue/` — in-memory queue (`enqueue`, `takeNext` for workers)
- `src/sample/` — sample candidates CRUD
- `src/migrations/` — TypeORM migrations
