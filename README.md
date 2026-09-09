# ProfilePilot

ProfilePilot is a recruiter-facing career assistant for Vishal Singh. It uses Retrieval-Augmented Generation (RAG), conversation memory, source attribution, and optional web search to answer questions about Vishal's profile, skills, projects, experience, hiring preferences, contact details, and professional links.

The project is built as a full-stack learning project with a Node.js/Express backend, MongoDB-backed vector and chat storage, OpenAI embeddings and chat completions, policy-based Tavily web search, and a Next.js frontend.

---

## Current Status

The project has moved from a generic insurance RAG assistant into a career assistant named ProfilePilot.

Implemented:

* Next.js chat UI with authentication, chat history, and source panel
* Express chat API
* MongoDB document and session storage
* Document ingestion from the local `documents/` folder
* OpenAI embedding generation
* Cosine-similarity vector retrieval
* Intent detection and intent-aware reranking
* Dictionary-based entity detection for the profile owner, pronouns, and unresolved person references
* Policy-based vector, web, hybrid, direct, clarification, and safe-response strategies
* Metadata-aware document boosting
* Query-shape handling for list/detail/default fact-style retrieval
* Source expansion for list-style questions
* Tavily web search for current general knowledge and grounded market-aware evaluation
* OpenAI LLM response generation
* Runtime chat and embedding settings persisted in MongoDB
* Versioned document ingestion with staged revisions and atomic activation
* Authenticated admin APIs for settings, uploads, and revision management
* Docker Compose deployment and release-image publishing workflow
* Local first-run installer with preflight checks and mandatory Google admin verification
* Targeted unit and MongoDB integration tests for the new ingestion/settings flow

Official V1 releases keep web search disabled. The retrieval implementation remains
in the codebase for the planned quota-controlled gateway, but V1 makes no Tavily API calls.

Still in progress:

* Browser-level end-to-end and accessibility coverage
* More robust intent keyword coverage
* Packaging the source installer as self-contained GitHub Release executables
* Broader error handling and observability

---

## Architecture

```text
Frontend chat UI
  -> POST /chat/create
  -> conversation memory lookup
  -> intent detection + entity detection
  -> retrieval strategy selection
  -> optional vector retrieval and reranking
  -> optional Tavily web search for current information
  -> retrieval-confidence evaluation
  -> prompt construction
  -> OpenAI response
  -> MongoDB chat history update
  -> reply + sources returned to frontend
```

The backend ingests local documents at startup, chunks them, creates embeddings, and stores vector records in MongoDB. Chat messages and assistant responses are also persisted in MongoDB so the frontend can show session and conversation history.

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

scripts/                     Docker lifecycle scripts for Windows and Unix-like systems
compose.yaml                 Hardened official-image topology
compose.dev.yaml             Contributor source-build override
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

---

## Local Setup

### Official container prerequisites

The official container configuration runs the complete local stack from approved, digest-pinned
container images. It does not build the frontend or backend on the user's
machine. MongoDB and the backend are not published directly to the host; the
frontend proxies `/backend/*` requests to the internal backend service.

Before installation, the user needs:

* Docker Desktop or Docker Engine with Docker Compose v2, running locally
* Internet access to pull the official images and call the configured AI APIs
* An OpenAI API key with access to the selected chat and embedding models
* Google OAuth client ID and secret, with both installer and application callback
  URIs configured: `http://127.0.0.1:48731/oauth/callback` and
  `http://localhost:3000/api/auth/callback/google` (replace `3000` when using
  another frontend port)
* Profile documents in PDF, DOCX, or TXT format
* An available local frontend port (port `3000` by default)

The first-run installer validates Docker and the OpenAI key, then requires a real
Google sign-in before installation can begin. The verified Google email becomes
the sole administrator; the form never accepts a typed admin email. After the
identity is displayed, the user must explicitly confirm it before the installer
writes configuration or starts containers. Cancelled, denied, expired, or failed
verification therefore leaves no partial installation. Existing `.env` or
ProfilePilot data also blocks fresh setup, preventing an accidental second-admin
registration.

The installer source lives under `installer/`. Until self-contained release
executables are published, running it from the repository requires Node.js 24:

```powershell
.\scripts\setup.ps1
```

Official mode reads digest-pinned image references from
`installer/release-manifest.json`, which release packaging must generate. For a
contributor build from the current source, use `.\scripts\setup.ps1 -Dev`.
Secrets remain in memory through verification and are written only to the ignored
root `.env` after Compose reports a healthy installation; they are never baked
into either application image. Place profile documents under
`documents/ingestables/` before or after setup.

After installation, the application is controlled with:

```powershell
.\scripts\profilepilot.ps1 start
```

After changing environment-managed secrets, recreate the application services:

```powershell
.\scripts\profilepilot.ps1 restart
```

The restart preserves the MongoDB volume. Backend startup runs incremental
ingestion, so unchanged document chunks reuse their existing embeddings.
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

On macOS or Linux, use `./scripts/profilepilot.sh` with the same actions.

Official startup rejects application or MongoDB images that are not pinned by
SHA-256 digest or are outside the approved image repositories. Application
containers run as non-root with a read-only root filesystem, Linux capabilities
dropped, privilege escalation disabled, bounded process counts, and rotated
local logs. Only the backend can write the ingestable-document mount; downloadable
files remain read-only. MongoDB data remains in its private named volume and
internal network.

Official images are published only when a GitHub Release is published. The
release workflow uses commit-pinned build actions, publishes to the
`humble-builder` GitHub Container Registry namespace, attaches SBOM and maximum
provenance metadata, creates GitHub artifact attestations, and reports the exact
image digests required by installer packaging. Release packaging must place those
digests in the installer's manifest; mutable image tags are rejected.
Repository settings should protect the `official-release` environment with a
required maintainer approval.

This protects the official distribution path from unreviewed source changes. A
machine administrator can still replace software on their own computer, and a
public repository can still be forked; neither action changes an official image
or the upstream repository.

### Contributor Docker setup

Contributors may build from source with the development override. These images
are separate from installer images and cannot become an official release until
their changes are reviewed, merged, and published through the release pipeline.

```powershell
Copy-Item .env.example .env
docker compose -f compose.yaml -f compose.dev.yaml up -d --build
```

Fill in the API and OAuth values in `.env` before starting. The placeholder
official image digests are ignored by the development override.

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

---

## Author

Vishal Singh

Backend Engineer focused on conversational AI, RAG systems, intelligent automation, and scalable AI-driven applications.
