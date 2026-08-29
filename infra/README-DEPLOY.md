# Knownworld — deploy guide

Everything below deploys the whole stack into **your own** Google Cloud
project. There is no shared server and no operator who can read anyone's
data — self-deploy is the product (see `architecture.mmd` for the privacy
boundary: raw messages never leave the browser).

## Prerequisites

- [gcloud CLI](https://cloud.google.com/sdk/docs/install)
- A GCP project with billing attached (default id: `knownworld`; override
  everywhere with `PROJECT_ID=my-project`)
- Authenticate once:

```sh
gcloud auth login
gcloud auth application-default login
```

## One-time project setup

```sh
./infra/setup-gcp.sh
```

Idempotent. Enables the required APIs (Cloud Run, Cloud Build, Artifact
Registry, Firestore, Vertex AI, Secret Manager, Billing Budgets), creates the
`(default)` native-mode Firestore database and the `knownworld` Artifact
Registry repo in `us-central1`, creates the `knownworld-agents` service
account with `roles/aiplatform.user` + `roles/datastore.user`, and creates a
**$20 budget** (`knownworld-cap`) with alerts at 50% / 90% / 100%.

## Local dev

```sh
# web dashboard on http://localhost:3040
cd web && npm ci && npm run dev -- -p 3040

# agents service on http://localhost:8080 — FAKE_LLM=1 stubs Gemini so the
# whole loop runs offline (no GCP auth, no spend)
cd agents && pip install -r requirements.txt && FAKE_LLM=1 PORT=8080 python main.py
```

Copy `.env.example` (repo root) to `.env` and adjust as needed.

## Deploy

```sh
./deploy.sh
```

Deploys both Cloud Run services from source via Cloud Build, `us-central1`:

1. `knownworld-agents` (from `agents/`) — Vertex AI env preset, runs as the
   `knownworld-agents` service account. Publicly reachable **by design** (the
   browser posts refine batches straight to it), but app-gated: every request
   must carry `AGENTS_API_TOKEN`. The script generates the token with
   `openssl rand -hex 16` if unset and prints it **once** — save it.
2. `knownworld-web` (from `web/`) — gets the agents URL
   (`NEXT_PUBLIC_AGENTS_URL`) plus `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` for
   the dashboard auth gate. Credentials are generated (and printed once) if
   unset.

The script prints both service URLs at the end. **The dashboard must stay
auth-gated** for the duration of judging.

Re-deploy = run `./deploy.sh` again (pass the same `AGENTS_API_TOKEN` /
`BASIC_AUTH_*` values to keep credentials stable).

## Budget

Hackathon credit is $150; our hard line is **$20**, enforced by the
`knownworld-cap` budget from setup. Alerts fire at $10 / $18 / $20. Budgets
alert but do not stop spend — if an alert fires, check Cloud Run + Vertex AI
usage immediately. Both services are capped at `--max-instances 3`.

## Self-deploy story (for the write-up)

Any user runs the same three commands — `gcloud auth login`,
`./infra/setup-gcp.sh`, `./deploy.sh` — against their own project id and gets
their own private stack: their browser parses their export locally, their
Cloud Run services talk to Gemini under their billing, their Firestore holds
only the distilled rows they can see and delete. Nobody else is in the loop.
