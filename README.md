# Knownworld v2

> **Judging this for the hackathon?** See [EVALUATING.md](EVALUATING.md) — the 5-minute path, nothing to upload.

**Your Telegram history, turned into a private, enriched contact database you
can ask questions — "who should I meet?", "is there a job for me?" — answered
from your own network with warm paths, not cold lists.**

Open source. Multi-account. Self-deployed into **your own** Google Cloud
project. Your raw chat export is parsed entirely in your browser and never
leaves it; the cloud side sees only transient batches and stores the
distilled rows you can inspect, edit, and delete.

---

## How it works — the product in three pages

### 0. Account = the data boundary

Simple email + password signup. Every contact row, research card, job
snapshot, and request lives in **your account's own tenant** — another
account sees nothing, and the delete-everything switch wipes only yours.
Sessions are httpOnly-cookie JWTs; the browser never holds a token in JS.

### 1. Onboarding — a wizard that builds the database

Four steps, resumable, each honest about what happens:

1. **Upload** — drop your Telegram Desktop export (`result.json`). A Web
   Worker streams it into IndexedDB **fully client-side** (multi-GB exports
   work). You also set a role-fit profile (target roles, industries,
   seniority, location) that later filters job results.
2. **Distill** — chats stream to the model in transient ~20-chat batches
   under a schema-enforced JSON contract; each batch is discarded after the
   distilled rows come back (name, company definite/inferred — never merged,
   role guess, 2-line summary, work-relevance). **Closeness is computed in
   code** from volume + recency — a model never scores it. Live telemetry
   per batch: model id, tokens, cost, duration.
3. **Research** — one grounded web lookup per work-relevant contact:
   current employer and role, **what they do now**, **how they can help
   you**, **work history**, LinkedIn/profile links, location with map
   coordinates, citations for every claim. The match / possible-mismatch /
   unverified **verdict is computed in code** by comparing evidence to the
   database — never by the model. Findings auto-apply; a mismatch never
   silently rewrites your data (the badge surfaces it, your edit resolves
   it). Non-resolving people stay `unverified` — never guessed.
4. **Done** — stat tiles and two doors: the Database and Requests.

**The lifecycle loop always works:** add → inspect → edit → delete →
add again. "Add more chats" distills another export on top (existing
contacts update, new ones join). "Start over" (and the Privacy switch) wipes
local + server data and lands you back on step 1 — the stored wizard state
is validated against reality on every load, so there are no dead ends.

### 2. Database — one dataset, three views + editable cards

- **Map** (top left): every located contact on a world map, dot size =
  closeness, city clusters collapse into count badges.
- **Network graph** (top right): you in the center, company hubs, contacts
  sized by closeness; solid edges = definite company, dashed = inferred.
- **Table** (below): search, work-relevant filter, verdict filter, closeness
  sort. Clicking a row — or a map dot, or a graph node — expands the card
  **inline under the row**:
  - *What they do now* and *How they can help you* — from public evidence
  - *From your chats* — what your own conversations say
  - *Work history* — "YEARS — ORG — ROLE" lines, newest first
  - Footprint, citations (real URLs), LinkedIn when it truly exists
  - **Edit** — the one user action. An owner correction is definitive: it
    writes the database, marks the row *verified by owner*. There is no
    approve/reject ceremony.

### 3. Requests — ask your network anything

Free-text queries, executed by a schema-enforced planner:

- *"Is there a BD or partnerships job for me — posted in the last 30 days?"*
  → intent **jobs**: the scout dedupes your contacts' companies, hits their
  **live public ATS feeds** (identity-verified slugs only — a plausible
  slug is never trusted without a board-name check), filters by your
  role-fit profile and the requested recency window **in code**, and
  returns real postings — each with its warm path: your contacts at that
  company ranked by closeness (the app **never sends messages anywhere**).
- *"I'm going to an AI conference in San Francisco — who should I meet?"*
  → intent **people**: contacts ranked against the query with grounded
  one-line reasons; model-suggested ids that don't exist in your DB are
  dropped in code.

Every request is a stored snapshot with honest stats (companies scanned,
feeds live, postings dropped for missing dates, truncation). Ask again next
week — feeds and your network move.

---

## Engineering rules (enforced in code, covered by tests)

| Rule | Where |
|---|---|
| Raw export never leaves the browser | Web Worker → IndexedDB; refine sends transient batches only |
| Closeness never comes from a model | computed at ingest; model-sneaked values proven dropped |
| Schema-enforced JSON on every model call | malformed output rejected **with reasons**, never patched |
| Verdicts computed in code | evidence-vs-DB comparison; mismatch never auto-writes company |
| Owner edits are definitive | `/correct` → verified-by-owner, activity-logged |
| ATS slugs live-verified only | board-identity checks; no hand-invented slugs, ever |
| Per-call telemetry | agent, resolved model id, tokens, est. cost, duration → activity log |
| Tenant isolation | every store scoped by uid; delete wipes only the caller's tenant |

Tests: **104 service + 29 web**, all runnable with zero cloud credentials.

## Model backends

| Backend | When | How |
|---|---|---|
| **Gemini via ADK / Vertex** | **every deploy — the hackathon mandate** | default; `deploy.sh` hard-refuses anything else |
| FAKE (deterministic stub) | local testing, zero credentials | `FAKE_LLM=1` (local default); demo answers come from the dataset's fact sidecar; telemetry labels rows `fake:` |
| Claude Haiku (dev-only) | fast local iteration | `MODEL_BACKEND=claude` + Anthropic auth; never deployable |

The same store code runs on Firestore (`STORE_MODE=firestore`, cloud), JSON
on disk (`local`, dev default), or memory (tests) — switching is an env
change, not a code change.

## The demo dataset

[`sample-data/`](sample-data/README.md): an **openly fictional** network of
15 real public figures (Musk, Altman, Buffett, …). The conversations are
invented — the dataset says so in its own metadata; the public facts
(companies, roles, cities, links) are real. 9 of the 15 companies have
live, identity-verified job boards, so the demo returns thousands of real
current postings with warm paths — the full product loop with zero keys.

## Run it locally

```bash
cd web && npm install && npm run dev -- -p 3040
```

```bash
cd agents && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && ./run-local.sh
```

Open http://localhost:3040 → create an account → **Load dev corpus** →
walk the wizard. (`web/.env.development` routes the app through the
same-origin session proxy; `agents/run-local.sh` starts the service with
the on-disk store and the FAKE model.)

## Deploy (your own GCP project)

```bash
export PROJECT_ID=<yours>
bash infra/setup-gcp.sh   # APIs, Firestore, SA + roles, Tasks queue, secrets, budget
bash deploy.sh            # agents → web (Gemini enforced, STORE_MODE=firestore)
```

Secrets (`agents-api-token`, `auth-secret`, legacy `dashboard-auth`) live in
Secret Manager; the deploy guard refuses `MODEL_BACKEND=claude`. See
[infra/README-DEPLOY.md](infra/README-DEPLOY.md) and
[DEPLOYMENT.md](DEPLOYMENT.md).

## Repo layout

- `web/` — Next.js app: onboarding wizard, Database (map/graph/table),
  Requests, Privacy; session gate in `src/proxy.ts`; agents proxy carries
  the session server-side.
- `agents/` — FastAPI + Google ADK service: refine / enrich / planner /
  matcher / drafter agents, job scout (5 ATS clients), auth, multi-tenant
  store triads, telemetry. `tests/` runs fully offline.
- `sample-data/` — the demo dataset generator + fact sidecar + golden
  reference.
- `data/ats-slugs.json` — live-verified company → job-feed registry.
- `docs/`, `SPEC*.md`, `ROADMAP*.md` — history and specs; v1 (single-tenant,
  approve-flow, separate pages) lives on `main`, v2 is this branch.
