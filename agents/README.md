# Knownworld agents service

Python 3.12 + FastAPI + Google ADK (`google-adk` 2.8.x). Hosts the refine
agent (Gemini, schema-enforced JSON output) behind a small HTTP API the
browser app calls. Refine batches are transient; only distilled rows and
per-call telemetry persist to Firestore. Closeness is computed in the
browser at ingest and merged in code here — never by a model.

## Run locally

```bash
cd agents
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# no GCP needed: canned model + in-memory store
FAKE_LLM=1 .venv/bin/uvicorn app.main:app --port 8080

# real mode: Vertex AI + Firestore (needs gcloud auth application-default login)
GOOGLE_CLOUD_PROJECT=your-project .venv/bin/uvicorn app.main:app --port 8080
```

Every env var is documented in `.env.example`.

Smoke check:

```bash
curl -s localhost:8080/healthz
```

## Tests

```bash
cd agents
.venv/bin/python -m pytest -q
```

All tests run with `FAKE_LLM=1` and the in-memory store — no network, no
GCP. They cover the validation discipline (malformed model output rejected
with reasons; hallucinated tg_ids dropped; closeness passthrough proven
against a fake model that tries to sneak its own closeness value) and the
API surface.

## Deploy (Cloud Run)

```bash
gcloud run deploy knownworld-agents \
  --source agents \
  --region us-central1 \
  --set-env-vars GOOGLE_GENAI_USE_VERTEXAI=TRUE,GOOGLE_CLOUD_PROJECT=$PROJECT,GEMINI_MODEL=gemini-3.5-flash,FRONTEND_ORIGIN=https://your-app-url
```

The container reads `PORT` from Cloud Run. The service account needs
Vertex AI User + Cloud Datastore User roles. Firestore collections used:
`people` (doc id = tg_id), `activity_log`, `runs`.

## Layout

- `app/config.py` — env + cost table (per-1M-token pricing, prefix match)
- `app/schemas.py` — pydantic mirrors of `web/src/lib/types.ts` (frozen contracts)
- `app/agents/refine_agent.py` — the ADK `LlmAgent` (`output_schema`-enforced)
- `app/agents/{enrich,jobscout,drafter}.py` — D2 stubs
- `app/store.py` — Firestore behind an interface + in-memory twin
- `app/main.py` — FastAPI endpoints, validation with reasons, code-side merge
