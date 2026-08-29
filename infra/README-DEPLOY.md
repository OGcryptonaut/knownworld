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
Registry, Firestore, Vertex AI, Secret Manager, Cloud Tasks, Logging,
Monitoring, Billing Budgets), creates the `(default)` native-mode Firestore
database and the `knownworld` Artifact Registry repo in `us-central1`,
creates the `knownworld-agents` service account (roles: `aiplatform.user`,
`datastore.user`, `secretmanager.secretAccessor`, `cloudtasks.enqueuer`,
`run.invoker`, `logging.logWriter`, plus `iam.serviceAccountUser` on itself
for OIDC task creation), creates the Cloud Tasks queue `knownworld-enrich`,
seeds the three Secret Manager secrets (see **Secrets model**), and creates a
**$20 budget** (`knownworld-cap`) with alerts at 50% / 90% / 100%.

On FIRST run it prints the generated dashboard password and agents API token
**once** — save them (both remain retrievable from Secret Manager, see below).
Re-runs never rotate an existing secret.

## Secrets model (Secret Manager)

| Secret | Holds | Consumed by |
|---|---|---|
| `dashboard-auth` | dashboard basic-auth password (`openssl rand -base64 18`) | `knownworld-web` as env `BASIC_AUTH_PASS` via `--set-secrets` |
| `agents-api-token` | app-level bearer token for the public agents URL (`openssl rand -hex 16`) | `knownworld-agents` as env `AGENTS_API_TOKEN` via `--set-secrets` |
| `app-config` | `{"TAVILY_API_KEY": ""}` — an **optional fallback slot only**. The build uses NATIVE Gemini Google Search grounding for enrichment (owner decision); no external search key is used or read by the shipped code. The slot exists so a self-deployer could wire one in without schema changes. | nothing (unused) |

Retrieve a value:

```sh
gcloud secrets versions access latest --secret=dashboard-auth
```

Rotate: add a new version, then redeploy so Cloud Run picks up `:latest`:

```sh
printf 'NEW-VALUE' | gcloud secrets versions add dashboard-auth --data-file=-
./deploy.sh
```

Secrets never appear in the repo, in images, or in `--set-env-vars`; Cloud
Run mounts them at runtime through `--set-secrets` (the service account holds
`secretmanager.secretAccessor`).

## Cloud Tasks orchestration (enrich fan-out)

An enrich run does not loop through people in one request. The run endpoint
enqueues one Cloud Tasks task per person onto the `knownworld-enrich` queue
(`us-central1`); each task pushes back into the agents service
(`POST /enrich/task`) with an OIDC token for the `knownworld-agents` service
account. Deploy wires this with:

- `TASKS_MODE=cloud` — enqueue to Cloud Tasks (production)
- `TASKS_QUEUE=knownworld-enrich`
- `TASKS_SA_EMAIL` — the OIDC identity on each task push
- `SERVICE_URL` — the service's own public URL, target of the pushes
  (set by deploy.sh in a second pass, because the URL only exists after the
  first deploy)

Local dev fallback: `TASKS_MODE=local` (the default outside Cloud Run) runs
the same handler in-process — no queue, no GCP dependency, same code path.

## Auth gate (dashboard)

`web/middleware.ts` enforces HTTP basic auth on every route (only Next's
static assets and the favicon are exempt) **whenever `BASIC_AUTH_PASS` is
set** — which deploy.sh guarantees in production by mounting the
`dashboard-auth` secret. When the env var is absent (local dev) the gate is
off.

- Log in: user `knownworld` (or your `BASIC_AUTH_USER` override), password =
  `gcloud secrets versions access latest --secret=dashboard-auth`
- Change the password: rotate `dashboard-auth` as shown above, redeploy web
- The gate must STAY on for the whole judging window

## Deploy order: agents → web (and why)

`NEXT_PUBLIC_AGENTS_URL` is inlined into the **browser bundle at build
time** — a runtime env var on Cloud Run is invisible to browser code. So
deploy.sh must know the live agents URL *before* the web image builds:

1. deploy `knownworld-agents`, capture its URL (plus a second pass that sets
   `SERVICE_URL` on the service for Cloud Tasks self-enqueue)
2. write a **transient** `web/.env.production.local` containing
   `NEXT_PUBLIC_AGENTS_URL=<agents URL>` (gitignored; deploy.sh verifies with
   `git check-ignore` and deletes it after), plus a transient
   `web/.gcloudignore` so the source upload doesn't drop the file
3. deploy `knownworld-web` — Cloud Build's `npm run build` inlines the URL

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

Deploys both Cloud Run services from source via Cloud Build, `us-central1`,
in the order described under **Deploy order** above:

1. `knownworld-agents` (from `agents/`) — Vertex AI env preset, runs as the
   `knownworld-agents` service account. Publicly reachable **by design** (the
   browser posts refine batches straight to it), but app-gated: every request
   must carry `AGENTS_API_TOKEN`, mounted from the `agents-api-token` secret
   via `--set-secrets`. Cloud Tasks env (`TASKS_MODE=cloud`, `TASKS_QUEUE`,
   `TASKS_SA_EMAIL`, then `SERVICE_URL` in a second pass) is set here too.
2. `knownworld-web` (from `web/`) — built with the agents URL inlined (see
   **Deploy order**), gated by `web/middleware.ts` with `BASIC_AUTH_USER`
   (default `knownworld`) and `BASIC_AUTH_PASS` mounted from the
   `dashboard-auth` secret.

The script prints both service URLs and the credential-retrieval commands at
the end. **The dashboard must stay auth-gated** for the duration of judging.

Re-deploy = run `./deploy.sh` again — credentials live in Secret Manager, so
they stay stable across deploys with no env vars to remember.

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
