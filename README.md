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

Still in progress:

* Automated tests
* More robust intent keyword coverage
* Production deployment setup
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
    controllers/             Chat request handlers
    data/                    Local file discovery and document loading
    database/                MongoDB chat history reads/writes
    entity/                  Deterministic entity detection
    intent/                  Intent scoring and detection
    retrieval/               Ingestion, vector search, reranking, deduping
    services/                RAG orchestration, LLM, and web search
    strategy/                Retrieval policy selection and result evaluation
    utils/                   Prompt/context builders, logging, hashing, progress cursor

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

---

## Local Setup

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
```

Start the frontend:

```bash
npm run dev
```

---

## Development Notes

* The backend currently ingests documents during server startup.
* The vector store is implemented in MongoDB, not ChromaDB or Pinecone.
* External-person resumes are not fetched from the web; unsupported external-profile requests use a safe response until a separately grounded collection is implemented.
* `npm test` is not wired yet and currently exits with the default "no test specified" message.
* The document set is intentionally organized by recruiter question type so metadata-aware retrieval can route questions more reliably.
* Intent keyword tuning is part of the development loop. If a recruiter phrase routes to `general`, update the dictionary with the phrasing that caused the miss.

---

## Author

Vishal Singh

Backend Engineer focused on conversational AI, RAG systems, intelligent automation, and scalable AI-driven applications.
