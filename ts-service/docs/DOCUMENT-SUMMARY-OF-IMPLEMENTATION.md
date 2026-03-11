# Candidate Document Intake + Summary Workflow — Implementation Guide

This document explains the full implementation of Part B (NestJS/TypeScript) in the `ts-service` project: candidate document upload, async summary generation via a queue/worker, and provider-based LLM summarization.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Data Model](#3-data-model)
4. [API Endpoints](#4-api-endpoints)
5. [Access Control](#5-access-control)
6. [Queue & Worker](#6-queue--worker)
7. [Summarization Provider](#7-summarization-provider)
8. [File Layout](#8-file-layout)
9. [How to Run](#9-how-to-run)
10. [Testing](#10-testing)
11. [Assumptions & Limitations](#11-assumptions--limitations)

---

## 1. Overview

**What was built**

- **Upload candidate documents** — Resumes and cover letters (as raw text) stored per candidate.
- **Request summary generation** — An endpoint that creates a “pending” summary record, enqueues a background job, and returns immediately (202 Accepted).
- **Background worker** — Polls the queue, loads the candidate’s documents, calls an LLM via a **provider interface**, and saves the result (or marks the summary as failed).
- **Retrieve summaries** — List all summaries for a candidate, or fetch a single summary by ID.

**Design principles**

- Recruiters are scoped to a **workspace**; they can only access candidates in that workspace.
- Summary generation is **asynchronous** (queue + worker), not inside the request cycle.
- LLM logic lives behind a **SummarizationProvider** abstraction (fake or Gemini); no hardcoded LLM in controllers or workers.
- Tests use **mocked** providers; no live external API calls.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  HTTP (FakeAuthGuard: x-user-id, x-workspace-id)                        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  CandidatesController                                                    │
│  POST /candidates/:candidateId/documents                                │
│  POST /candidates/:candidateId/summaries/generate                        │
│  GET  /candidates/:candidateId/summaries                                 │
│  GET  /candidates/:candidateId/summaries/:summaryId                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  CandidatesService                                                       │
│  • ensureCandidateInWorkspace(candidateId, workspaceId)                   │
│  • createDocument / requestSummaryGeneration / listSummaries / getSummary│
└─────────────────────────────────────────────────────────────────────────┘
        │                              │
        │                              │ enqueue(job)
        ▼                              ▼
┌───────────────────┐          ┌─────────────────────────────────────────┐
│  TypeORM          │          │  QueueService (in-memory)                 │
│  • SampleCandidate│          │  • enqueue(name, payload)                │
│  • CandidateDoc   │          │  • takeNext(name)  ← used by worker       │
│  • CandidateSumm. │          └─────────────────────────────────────────┘
└───────────────────┘                              │
                                                    ▼
                                    ┌─────────────────────────────────────┐
                                    │  SummaryGenerationWorkerService      │
                                    │  (polls every 2s, takeNext, then)    │
                                    │  • load summary + documents           │
                                    │  • SummarizationProvider.generate()   │
                                    │  • save completed / failed            │
                                    └─────────────────────────────────────┘
                                                    │
                                                    ▼
                                    ┌─────────────────────────────────────┐
                                    │  SummarizationProvider               │
                                    │  • FakeSummarizationProvider (default)│
                                    │  • GeminiSummarizationProvider (if   │
                                    │    GEMINI_API_KEY is set)            │
                                    └─────────────────────────────────────┘
```

- **Controller** → **Service** for all candidate operations.
- **Service** writes to the DB and enqueues a job; it does **not** call the LLM.
- **Worker** pulls jobs with `takeNext`, loads data from DB, calls the **provider**, then updates the summary row (status, score, strengths, concerns, etc., or failed + errorMessage).

---

## 3. Data Model

### 3.1 Existing (starter)

- **SampleWorkspace** — `id`, `name`, `createdAt`.
- **SampleCandidate** — `id`, `workspaceId`, `fullName`, `email`, `createdAt`. Belongs to one workspace.

Candidates are created via `POST /sample/candidates`; the returned `id` is used as `candidateId` in the document/summary APIs.

### 3.2 CandidateDocument

**Table:** `candidate_documents`

| Column         | Type         | Description                                |
|----------------|--------------|--------------------------------------------|
| id             | varchar(64) | Primary key (UUID)                         |
| candidate_id   | varchar(64) | FK → sample_candidates.id, CASCADE          |
| document_type  | varchar(32) | `resume` \| `cover_letter` \| `other`       |
| file_name      | varchar(255)| Original file name                          |
| storage_key    | varchar(512)| Path or identifier for storage             |
| raw_text       | text        | Extracted/raw text content                 |
| uploaded_at    | timestamptz | Set on insert                              |

**Entity:** `src/entities/candidate-document.entity.ts`

### 3.3 CandidateSummary

**Table:** `candidate_summaries`

| Column               | Type         | Description                                  |
|----------------------|--------------|----------------------------------------------|
| id                   | varchar(64) | Primary key (UUID)                            |
| candidate_id         | varchar(64) | FK → sample_candidates.id, CASCADE            |
| status               | varchar(32) | `pending` \| `completed` \| `failed`          |
| score                | decimal(5,2)| 0–100, nullable until completed               |
| strengths            | jsonb       | string[], nullable                            |
| concerns             | jsonb       | string[], nullable                            |
| summary              | text        | Paragraph summary, nullable                   |
| recommended_decision  | varchar(32)| `advance` \| `hold` \| `reject`, nullable     |
| provider             | varchar(64)| e.g. `gemini`, nullable                        |
| prompt_version       | varchar(32)| e.g. `v1`, nullable                           |
| error_message        | text        | Set when status = failed                      |
| created_at           | timestamptz| Set on insert                                 |
| updated_at           | timestamptz| Updated on save                               |

**Entity:** `src/entities/candidate-summary.entity.ts`

### 3.4 Migration

- **File:** `src/migrations/1720000000000-CandidateDocumentsAndSummaries.ts`
- **Up:** Creates `candidate_documents` and `candidate_summaries` with FKs and indexes on `candidate_id`.
- **Down:** Drops tables and FKs in reverse order.

Run: `npm run migration:run` from `ts-service`.

---

## 4. API Endpoints

All candidate endpoints require headers:

- `x-user-id`: any non-empty string (e.g. `user-1`)
- `x-workspace-id`: workspace id (e.g. `workspace-1`)

If missing → **401 Unauthorized**. If the candidate is not in that workspace → **403 Forbidden** or **404 Not Found**.

### 4.1 Create a candidate (sample module)

You need a candidate before uploading documents or generating summaries.

```http
POST /sample/candidates
Content-Type: application/json
x-user-id: user-1
x-workspace-id: workspace-1

{
  "fullName": "Jane Doe",
  "email": "jane@example.com"
}
```

Response: `{ "id": "<candidateId>", "workspaceId": "workspace-1", "fullName": "Jane Doe", "email": "jane@example.com", "createdAt": "..." }`.  
Use `id` as `candidateId` below.

### 4.2 Upload a candidate document

```http
POST /candidates/:candidateId/documents
Content-Type: application/json
x-user-id: user-1
x-workspace-id: workspace-1

{
  "documentType": "resume",
  "fileName": "jane-resume.txt",
  "rawText": "Full resume text here...",
  "storageKey": "optional/custom/path"
}
```

- **documentType:** `resume` | `cover_letter` | `other` (validated).
- **fileName:** string, max 255 chars.
- **storageKey:** optional; if omitted, a path is generated: `workspaces/{workspaceId}/candidates/{candidateId}/{uuid}_{fileName}`.
- **rawText:** required. We assume content is already text (no file parsing).

Response: The saved document entity (id, candidateId, documentType, fileName, storageKey, rawText, uploadedAt).

### 4.3 Request summary generation (async)

```http
POST /candidates/:candidateId/summaries/generate
x-user-id: user-1
x-workspace-id: workspace-1
```

No body. Response: **202 Accepted**

```json
{
  "summaryId": "uuid-of-summary",
  "status": "pending"
}
```

- A row is inserted in `candidate_summaries` with `status: 'pending'`.
- A job is enqueued with name `generate-candidate-summary` and payload `{ summaryId }`.
- The worker later processes it and updates the same row to `completed` (with score, strengths, concerns, summary, recommendedDecision, provider, promptVersion) or `failed` (with errorMessage).

### 4.4 List summaries for a candidate

```http
GET /candidates/:candidateId/summaries
x-user-id: user-1
x-workspace-id: workspace-1
```

Response: Array of summary objects, newest first (`createdAt` DESC).

### 4.5 Get one summary

```http
GET /candidates/:candidateId/summaries/:summaryId
x-user-id: user-1
x-workspace-id: workspace-1
```

Response: Single summary. If the summary does not exist or does not belong to the candidate → **404 Not Found**. If the candidate is not in the user’s workspace → **403 Forbidden** (from earlier access check).

---

## 5. Access Control

- **FakeAuthGuard** (already in the starter): Reads `x-user-id` and `x-workspace-id`, sets `request.user = { userId, workspaceId }`. Used on all candidate routes.
- **CandidatesService.ensureCandidateInWorkspace(candidateId, workspaceId):**
  - Loads the candidate by `candidateId`.
  - If not found → **NotFoundException** (404).
  - If `candidate.workspaceId !== workspaceId` → **ForbiddenException** (403).
  - Otherwise returns the candidate; the controller/service then proceeds.

So: recruiters only see and act on candidates in their own workspace. No roles or permissions beyond workspace membership.

---

## 6. Queue & Worker

### 6.1 QueueService

- **Location:** `src/queue/queue.service.ts`
- **Storage:** In-memory array of jobs.
- **Methods:**
  - `enqueue<TPayload>(name, payload)` — pushes a job `{ id, name, payload, enqueuedAt }`, returns it.
  - `getQueuedJobs()` — returns current list (read-only).
  - **`takeNext<TPayload>(name)`** — finds the first job with that `name`, removes it from the array, and returns it (or `null`). Used by the worker so each job is processed once.

### 6.2 Job shape for summary generation

- **Name:** `generate-candidate-summary` (constant in `src/queue/queue.types.ts`).
- **Payload:** `{ summaryId: string }`.

### 6.3 SummaryGenerationWorkerService

- **Location:** `src/candidates/summary-generation.worker.ts`
- **Lifecycle:** On module init, starts a `setInterval(..., 2000)` that calls `processNext()`. On module destroy, clears the interval.
- **processNext():**
  1. `takeNext('generate-candidate-summary')`. If no job, return.
  2. Load the summary by `summaryId`. If not found or status ≠ `pending`, return (no update).
  3. Load all documents for `summary.candidateId`, order by `uploadedAt`.
  4. Call `summarizationProvider.generateCandidateSummary({ candidateId, documents: docs.map(d => d.rawText) })`.
  5. On success: set summary fields (status, score, strengths, concerns, summary, recommendedDecision, provider, promptVersion, clear errorMessage), save.
  6. On error: set status = `failed`, errorMessage = err.message (or String(err)), save.

So: API only enqueues; worker does all LLM and DB updates. Clear separation between request handling and background processing.

---

## 7. Summarization Provider

### 7.1 Interface

**File:** `src/llm/summarization-provider.interface.ts`

```ts
interface CandidateSummaryInput {
  candidateId: string;
  documents: string[];  // raw text per document
}

interface CandidateSummaryResult {
  score: number;           // 0–100
  strengths: string[];
  concerns: string[];
  summary: string;
  recommendedDecision: 'advance' | 'hold' | 'reject';
}

interface SummarizationProvider {
  generateCandidateSummary(input: CandidateSummaryInput): Promise<CandidateSummaryResult>;
}
```

Injection token: `SUMMARIZATION_PROVIDER`.

### 7.2 FakeSummarizationProvider

- **File:** `src/llm/fake-summarization.provider.ts`
- Returns stub data; no network. Used when `GEMINI_API_KEY` is not set and in all automated tests.

### 7.3 GeminiSummarizationProvider

- **File:** `src/llm/gemini-summarization.provider.ts`
- **LLM provider:** Google **Gemini** (model `gemini-2.0-flash`) via the official REST API:
  - Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`
  - Auth: API key passed as `?key=GEMINI_API_KEY` query parameter.
- **Local configuration:** set `GEMINI_API_KEY` in `ts-service/.env` to your Gemini API key. If `GEMINI_API_KEY` is unset or blank, the app automatically falls back to the fake provider and never calls the external API.
- **Behavior:** sends a prompt that asks for a single JSON object with the required fields (score, strengths, concerns, summary, recommendedDecision), reads the text response from `candidates[0].content.parts[0].text`, and:
  - Parses it as JSON.
  - Validates score range (0–100).
  - Ensures `strengths`/`concerns` are string arrays.
  - Ensures `recommendedDecision` is one of `advance` | `hold` | `reject`.
  - On malformed/invalid output, throws so the worker can mark the summary as `failed` and store the `errorMessage`.

**LlmModule** uses a factory: if `GEMINI_API_KEY` is set (and non-empty), the app uses `GeminiSummarizationProvider`; otherwise `FakeSummarizationProvider`. No LLM logic appears in controllers or workers—only behind the `SummarizationProvider` abstraction.

### 7.4 Summary of LLM-related documentation (per spec)

- **Which LLM API/provider is used?**
  - Google Gemini API, model `gemini-flash-latest`, via the REST endpoint `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent`.
- **How to configure it locally?**
  - Obtain a Gemini API key from Google AI Studio.
  - Set `GEMINI_API_KEY` in `ts-service/.env`.
  - Leave `GEMINI_API_KEY` empty to use the in-process fake provider instead (no external calls).
- **Assumptions / limitations for the LLM integration:**
  - Rate limits and quotas are entirely governed by Gemini; errors from the API (e.g. quota exceeded) are surfaced as `failed` summaries with `errorMessage` stored (so as to aid in debugging).
  - The worker truncates concatenated document text to a safe length before sending to Gemini.
  - For automated tests and CI, the real Gemini provider is never called; tests use a mocked/fake implementation only.

---

## 8. File Layout

| Path | Purpose |
|------|--------|
| `src/entities/candidate-document.entity.ts` | CandidateDocument entity |
| `src/entities/candidate-summary.entity.ts`  | CandidateSummary entity |
| `src/migrations/1720000000000-CandidateDocumentsAndSummaries.ts` | Migration |
| `src/queue/queue.service.ts`               | enqueue, takeNext |
| `src/queue/queue.types.ts`                 | Job name and payload type |
| `src/llm/summarization-provider.interface.ts` | Interface + token |
| `src/llm/fake-summarization.provider.ts`    | Fake provider |
| `src/llm/gemini-summarization.provider.ts` | Gemini provider |
| `src/llm/llm.module.ts`                    | Provider factory (fake vs Gemini) |
| `src/candidates/candidates.module.ts`      | Module wiring |
| `src/candidates/candidates.controller.ts`  | Four HTTP endpoints |
| `src/candidates/candidates.service.ts`     | Business logic + access check |
| `src/candidates/dto/create-candidate-document.dto.ts` | DTO + validation |
| `src/candidates/summary-generation.worker.ts` | Queue consumer |
| `src/candidates/candidates.service.spec.ts`    | Service unit tests |
| `src/candidates/summary-generation.worker.spec.ts` | Worker unit tests (mocked provider) |
| `src/config/typeorm.options.ts`            | Registers new entities + migration |
| `src/app.module.ts`                         | Imports CandidatesModule |

---

## 9. How to Run

1. **Prerequisites:** Node.js 22+, npm, PostgreSQL (e.g. `docker compose up -d postgres` from repo root).

2. **Install and env:**
   ```bash
   cd ts-service
   npm install
   cp .env.example .env
   ```
   In `.env`, set `GEMINI_API_KEY` only if you want real LLM summarization; leave it empty for the fake provider.

3. **Migrations:**
   ```bash
   npm run migration:run
   ```

4. **Start app:**
   ```bash
   npm run start:dev
   ```

5. **Example flow:**
   - Create candidate: `POST /sample/candidates` with body `{ "fullName": "Jane Doe", "email": "jane@example.com" }` and headers `x-user-id`, `x-workspace-id`.
   - Upload document: `POST /candidates/<candidateId>/documents` with body `{ "documentType": "resume", "fileName": "resume.txt", "rawText": "..." }`.
   - Request summary: `POST /candidates/<candidateId>/summaries/generate` → 202 with `summaryId`.
   - After a few seconds, `GET /candidates/<candidateId>/summaries` or `GET /candidates/<candidateId>/summaries/<summaryId>` to see completed (or pending/failed) summary.

---

## 10. Testing

- **Unit tests** do not call any external API. The summarization provider is always mocked in tests.
- **CandidatesService** (`candidates.service.spec.ts`): access control (ensureCandidateInWorkspace), createDocument, requestSummaryGeneration, listSummaries, getSummary — all with mocked repositories and QueueService.
- **SummaryGenerationWorkerService** (`summary-generation.worker.spec.ts`): successful completion (provider returns result, summary saved as completed) and failure (provider throws, summary saved as failed with errorMessage). Provider is mocked.

Run:

```bash
npm test
```

---

## 11. Assumptions & Limitations

- **Candidates** are the existing `sample_candidates`; created via `POST /sample/candidates`. No separate “candidate” entity for this feature.
- **Document content** is provided as `rawText` in the request body. No file upload or parsing; “file contents are already available as text.”
- **Queue** is in-memory and processed by a single in-process worker polling every 2 seconds. For production you’d replace this with a durable queue (e.g. Bull, SQS) and separate worker processes.
- **Auth** is the starter’s fake auth (headers only). No JWT or real identity provider.
- **Workspace** is created on demand when creating a candidate (same as starter); recruiters are identified only by `x-workspace-id` for scoping.

---

This document is the single reference for the candidate document intake and summary workflow in `ts-service`. Use it to assist review, onboard, or tweak the implementation.
