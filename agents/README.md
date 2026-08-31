# Knownworld agents service

Python 3.12 + FastAPI + Google ADK (`google-adk` 2.8.x). Hosts every agent
the product runs: refine, enrich + verify (Search grounding), the Requests
brain (planner, matcher, web scout, composer), the job scout with its five
ATS clients, and the intro drafter. Refine batches are transient; only
distilled rows, research cards and per-call telemetry persist. Closeness is
computed in the browser at ingest and merged in code here, never by a
model.

## Run locally

```bash
cd agents
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
./run-local.sh   # on-disk store + deterministic FAKE model, port 8787
```

No GCP, no keys. Every env var is documented in `.env.example`; the root
`web/.env.development` already points the dashboard at :8787.

Smoke check:

```bash
curl -s localhost:8787/health
```

(`/health` is an alias for `/healthz`: Google's frontend intercepts the
literal `/healthz` path on `*.run.app`, so use `/health` against deployed
URLs.)

## Tests

```bash
cd agents
.venv/bin/python -m pytest -q
```

All 152 tests run with `FAKE_LLM=1` and the in-memory store. No network,
no GCP. They cover the validation discipline (malformed model output
rejected with reasons, hallucinated tg_ids dropped, closeness passthrough
proven against a hostile fake model that tries to sneak its own value),
tenancy isolation, the owner fence, geo filters, tags, the ATS clients,
and the API surface.

## Deploy (Cloud Run)

Use the root `deploy.sh`; it deploys this service first, wires its own URL
back in for Cloud Tasks callbacks, then builds the web app against it. The
service account needs Vertex AI User plus Cloud Datastore User roles.

## Layout

- `app/main.py`: FastAPI app, auth middleware, tenancy, the refine endpoint
- `app/agents/`: `refine_agent`, `enrich` (search + extract + in-code
  verdict), `planner` (planner, matcher, brief composer), `webscout`,
  `drafter`, plus the dev-only `claude_backend`
- `app/requests_router.py`: the Requests chat (jobs, people, brief, intro)
- `app/enrich_router.py`: research passes, the owner-correction endpoint,
  the Cloud Tasks fan-out handler
- `app/jobs/`: ATS feed clients, slug identity verification, role-fit
- `app/geo.py` and `app/tags.py`: in-code place matching and the tenant
  tag vocabulary
- `app/store.py`, `app/enrich_store.py`, `app/jobs_store.py`,
  `app/requests_store.py`, `app/users.py`: each store as a
  Firestore / local-disk / in-memory triad behind one interface
- `app/schemas.py`: pydantic mirrors of `web/src/lib/types.ts` (frozen
  contracts)
- `app/config.py`: env plus the cost table (per-1M-token pricing)
