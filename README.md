# ProfilePilot

ProfilePilot is a full-stack, retrieval-augmented career assistant that answers recruiter questions using a verified professional profile. It combines a Next.js chat interface with an Express API, MongoDB-backed document and conversation storage, and OpenAI embeddings and chat completions.

This project explores practical RAG engineering: choosing retrieval strategies, grounding answers in source documents, managing document revisions safely, and measuring how requests move through the system.

## Highlights

- **Grounded career Q&A:** answers questions about skills, projects, experience, education, and hiring preferences, with source citations.
- **Intent-aware retrieval:** routes requests using intent, entity, and query-shape signals; reranks by semantic and metadata relevance; expands broad list questions.
- **Safe response behavior:** clarifies unresolved references and avoids presenting unsupported external-person profile information as verified fact.
- **Incremental document ingestion:** processes PDF, DOCX, and TXT files, reuses embeddings for unchanged chunks, and detects duplicate uploads.
- **Versioned source management:** stage document revisions, review them, and activate revisions atomically. Embedding-model changes migrate documents before switching the active configuration.
- **Request observability:** an admin-only dashboard shows request volume, success rate, average and p95 latency, strategies, source usage, and per-request stage timings. Observability records omit prompts, replies, and document text.
- **Protected administration:** Google sign-in and owner authorization protect the settings interface; server-side routes keep the backend admin token out of the browser.
- **Containerized development:** Docker Compose starts the frontend, backend, and MongoDB replica set from source.

The current V1 configuration disables Tavily web requests. Web-search routing remains in the codebase for future quota-controlled use.

## Project status

The current application uses a single shared profile and document collection. User-owned profiles and per-user document isolation are future work; do not treat the current version as a multi-tenant application.

The settings and source-management component is implemented but is not mounted in the recruiter-facing chat screen. An owner can use its protected admin routes and the observability dashboard.

## Technology

| Area | Tools |
|---|---|
| Frontend | Next.js, React, TypeScript, Tailwind CSS, NextAuth |
| Backend | Node.js, Express |
| Storage | MongoDB for conversations, vectors, source manifests, settings, and observability events |
| AI | OpenAI embeddings and chat completions |
| Documents | PDF, DOCX, and TXT ingestion |
| Operations | Docker Compose, Node test runner, Vitest |

---

## Architecture

```text
Frontend chat UI
  -> POST /chat/create
  -> conversation memory lookup
  -> intent detection + entity detection
  -> retrieval strategy selection
  -> optional vector retrieval and reranking
  -> policy-gated external search (disabled in V1)
  -> retrieval-confidence evaluation
  -> prompt construction
  -> OpenAI response
  -> MongoDB chat history update
  -> reply + sources returned to frontend
```

The backend ingests local documents at startup, chunks them, creates embeddings, and stores vector records in MongoDB. Chat messages and assistant responses are also persisted in MongoDB so the frontend can show session and conversation history.

Chat requests also create metadata-only observability events. The owner dashboard reads these through an admin-protected API; request records contain timing, routing, status, and counts, but not prompt, reply, or document content.

---

## Repository Structure

```text
backend/
  constants/
    intentDictionary.js      Intent and query-shape keyword weights
    entityDictionary.js      Profile-owner, pronoun, and unresolved-person aliases
    maps.js                  Intent-to-document metadata mapping
    prompts.js               System prompts for career and fallback answers
  src/
    app.js                   Express app startup, DB connection, ingestion
    config/                  Environment, DB, and memory helpers
    controllers/             Chat, runtime-settings, and source-admin handlers
    data/                    Local file discovery and document loading
    database/                MongoDB chat history reads/writes
    entity/                  Deterministic entity detection
    intent/                  Intent scoring and detection
    retrieval/               Ingestion, vector search, reranking, deduping
    services/                RAG orchestration, LLM, and web search
    strategy/                Retrieval policy selection and result evaluation
    utils/                   Prompt/context builders, logging, hashing, progress cursor
  test/                      Unit and MongoDB integration tests

documents/
  capabilities/              Skills, projects, experience
  hiring/                    Availability, compensation, location, role fit
  personal/                  Contact, education, socials, resume
  profile/                   Summary and general assistant behavior

frontend/
  src/app/                   Next.js app router pages and API routes
  src/components/            Chat UI, auth controls, source panel
  src/services/              Backend API client
  src/types/                 Chat and source types

compose.yaml                 Local source-build topology
```

---

## Retrieval Logic

The retrieval flow lives mainly in:

* `backend/src/retrieval/searchSimilarDocs.js`
* `backend/src/retrieval/rerankDocuments.js`
* `backend/src/entity/detectEntity.js`
* `backend/src/intent/detectIntent.js`
* `backend/src/strategy/routeVectorQuery.js`
* `backend/src/strategy/routeStrategy.js`
* `backend/constants/intentDictionary.js`
* `backend/constants/maps.js`

Current retrieval behavior:

1. Detect domain intent and query shape while identifying known profile-owner aliases, contextual pronouns, and unresolved person references.
2. Select a vector, web, hybrid, direct, clarification, or safe-response strategy.
3. Block retrieval for unsupported external-person profile requests instead of treating the public web as a resume source.
4. When vector retrieval is required, embed the query and score document chunks with cosine similarity.
5. Rerank chunks using semantic score, intent match, and metadata match.
6. Expand list-style queries to all relevant chunks from the mapped source document and use a larger top-K for detail queries.
7. Evaluate required retrieval results against confidence thresholds before constructing a grounded prompt.

This prevents broad questions like "List all projects Vishal has built" from receiving only the highest-ranking partial chunks.

---

## API Endpoints

### Create Chat Message

```http
POST /chat/create
```

Request:

```json
{
  "userId": "recruiter@example.com",
  "sessionId": "session-id",
  "sessionCreatedAt": 1710000000000,
  "conversationId": "optional-existing-conversation-id",
  "message": "List all projects Vishal has built."
}
```

Response:

```json
{
  "conversationId": "conversation-id",
  "reply": "Assistant response",
  "sources": []
}
```

### Fetch Chat History

```http
GET /chat/history?userId=recruiter@example.com
```

### Delete Conversation

```http
DELETE /chat/:sessionId/:conversationId?userId=recruiter@example.com
```

### Admin Settings

```http
GET /service/admin/settings
PUT /service/admin/settings
```

The update body may include `chatModel`, `embeddingModel`,
`embeddingDimensions`, `embeddingBatchSize`, and `embeddingTimeoutMs`.
Changing the embedding model or dimensions triggers an all-source migration;
the active settings and document revisions switch together only after every
replacement revision is ready.

### Admin Sources

```http
GET  /service/admin/sources
POST /service/admin/sources/upload?category=profile&filename=profile.pdf&activateAfterIngestion=false
POST /service/admin/sources/activate
```

Upload requests contain the raw PDF, DOCX, or TXT body and are limited to 10 MB.
Activation requests contain `sourceId` and `revisionId`. All `/service/admin/*`
endpoints require the configured token in the `x-admin-token` header; the
frontend server routes add this token so it is never exposed to the browser.

### Observability

```http
GET /service/admin/observability?from=<ISO date>&to=<ISO date>&limit=100
```

The endpoint defaults to the previous 24 hours and the latest 100 request records (maximum 500). It returns summary metrics and recent request metadata. The dashboard is available at `/observability` to the configured admin account.

---

## Local Setup

### Docker Compose setup

The Compose configuration builds the frontend and backend from the checked-out
source and starts them with a local MongoDB replica set. MongoDB and the backend
remain on internal networks; the frontend proxies `/backend/*` requests to the
backend service.

Before starting the stack, install Docker Desktop or Docker Engine with Docker
Compose v2. Copy `.env.example` to `.env` and configure the OpenAI credentials,
Google OAuth application credentials, owner email, and server-to-server admin
token. The Google OAuth application needs this local callback URI:

```text
http://localhost:3000/api/auth/callback/google
```

The current V1 configuration disables web search, so no Tavily credential is required.
Place profile documents under `documents/ingestables/`, then build and start the stack:

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

Backend startup runs incremental ingestion, so unchanged document chunks reuse
their existing embeddings. MongoDB data persists in its named volume across
container restarts. To stop the stack without deleting that volume, run
`docker compose down`.

Non-secret chat and embedding settings are managed through the authenticated
settings API and persist in MongoDB without editing `.env`.

The reusable, authenticated `ProfileSettings` component supports runtime model
settings and PDF, DOCX, and TXT uploads up to 10 MB. It is intentionally not
mounted into the recruiter-facing chat UI yet. Chat-model, embedding batch-size, and timeout changes
apply without re-ingestion. Embedding model or dimension changes prepare all
replacement revisions first, then atomically switch the active configuration and
documents. The configured admin may activate a successful document ingestion
immediately or leave it staged for review. Duplicate uploads return a conflict
without failing normal startup ingestion. Staged state survives restart: the UI reads
`activeSourceRevision`, `latestSourceRevision`, and `updateAvailable` through an
authenticated server route, and “Use latest revision” performs an atomic pointer
switch in MongoDB.

Application containers run as non-root with read-only root filesystems, Linux
capabilities dropped, privilege escalation disabled, bounded process counts,
and rotated local logs. Only the backend can write to the ingestable-document
mount; downloadable files remain read-only.

### Manual development setup

Manual development requires Node.js 24 or newer.

Install backend dependencies:

```bash
cd backend
npm install
```

Copy `backend/.env.example` to `backend/.env`, then replace the placeholder credentials:

```env
PORT=5000
MONGO_URI=your_mongodb_uri
OPENAI_API_KEY=your_openai_api_key
TAVILY_API_KEY=your_tavily_api_key
```

`DATA_DIR` and `UPLOAD_DIR` are available in `.env.example` when the default document paths need to be changed.

Start the backend:

```bash
npm run dev
```

Install frontend dependencies:

```bash
cd frontend
npm install
```

Create `frontend/.env.local` with the backend URL and auth settings used by your NextAuth setup:

```env
NEXT_PUBLIC_API_URL=http://localhost:5000
INTERNAL_API_URL=http://localhost:5000
AUTH_SECRET=your_local_auth_secret
AUTH_GOOGLE_ID=your_google_oauth_client_id
AUTH_GOOGLE_SECRET=your_google_oauth_client_secret
ADMIN_EMAIL=your_admin_email
ADMIN_API_TOKEN=the_same_value_used_by_the_backend
```

Start the frontend:

```bash
npm run dev
```

---

## Automated Tests

The backend uses Node's built-in test runner. From `backend/`, run the unit,
service, and controller suite plus any integration tests for which dependencies
are configured:

```bash
npm test
```

The ingestion integration suite requires a reachable MongoDB replica set because
the production workflow uses transactions:

```bash
TEST_MONGO_URI="mongodb://127.0.0.1:27017/profile_pilot_test?replicaSet=rs0" npm run test:integration
```

Integration tests use deterministic injected embeddings and mock external API
clients; they do not call OpenAI or Tavily. Current backend coverage includes
intent/entity routing, retrieval strategy, prompt/context generation, LLM/web/vector
service orchestration, controller validation, admin authentication, runtime settings,
document upload and activation, chat history, revision staging, embedding migration,
and rollback.

The frontend uses Vitest, jsdom, and Testing Library for API clients, authenticated
server proxy routes, settings submission/partial-failure behavior, revision activation,
and the recruiter-facing chat components:

```bash
cd frontend
npm test
```

Browser-level end-to-end tests and accessibility audits remain future work.

---

## Development Notes

* The backend currently ingests documents during server startup.
* The vector store is implemented in MongoDB, not ChromaDB or Pinecone.
* External-person resumes are not fetched from the web; unsupported external-profile requests use a safe response until a separately grounded collection is implemented.
* `npm test` runs the backend unit suite; MongoDB integration tests require `TEST_MONGO_URI`.
* The document set is intentionally organized by recruiter question type so metadata-aware retrieval can route questions more reliably.
* Intent keyword tuning is part of the development loop. If a recruiter phrase routes to `general`, update the dictionary with the phrasing that caused the miss.

The observability dashboard is available to the configured admin at `/observability`. Request records are operational metadata and do not contain prompts, generated replies, or source text.

---

## Author

Vishal Singh

Backend Engineer focused on conversational AI, RAG systems, intelligent automation, and scalable AI-driven applications.
