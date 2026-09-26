# Knownworld deploy guide

Everything below deploys the whole stack into **your own** Google Cloud
project: no shared server, nobody else in the loop. The hosted instance is
the same stack run by us, and the one thing self-deploy changes is who
operates the two Cloud Run containers that distill batches pass through
(see **Data boundary** below and `architecture.mmd`).

## Prerequisites

- [gcloud CLI](https://cloud.google.com/sdk/docs/install)
- A GCP project with billing attached. Set it everywhere with
  `PROJECT_ID=my-project`; both scripts refuse to run without it, so a
  deploy can never land in someone else's project by accident
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

On FIRST run it prints the generated agents API token **once**; save it
(it stays retrievable from Secret Manager, see below). Re-runs never rotate
an existing secret.

## Secrets model (Secret Manager)

| Secret | Holds | Consumed by |
|---|---|---|
| `auth-secret` | signs user session JWTs (`openssl rand -hex 32`) | `knownworld-agents` as env `AUTH_SECRET` via `--set-secrets` |
| `agents-api-token` | app-level bearer token for the public agents URL (`openssl rand -hex 16`) | both services via `--set-secrets`: the agents service checks it, the web proxy attaches it |
| `dashboard-auth` | legacy v1 basic-auth password; v2 replaced the shared gate with per-account signup | mounted but unused by v2 |
| `app-config` | `{"TAVILY_API_KEY": ""}`, an **optional fallback slot only**. The build uses NATIVE Gemini Google Search grounding for enrichment (owner decision); no external search key is used or read by the shipped code. The slot exists so a self-deployer could wire one in without schema changes. | nothing (unused) |

Retrieve a value:

```sh
gcloud secrets versions access latest --secret=agents-api-token
```

Rotate: add a new version, then redeploy so Cloud Run picks up `:latest`:

```sh
printf 'NEW-VALUE' | gcloud secrets versions add agents-api-token --data-file=-
./deploy.sh
```

(Rotating `auth-secret` signs everyone out: existing session JWTs stop
verifying and users just sign in again.)

Secrets never appear in the repo, in images, or in `--set-env-vars`; Cloud
Run mounts them at runtime through `--set-secrets` (the service account holds
`secretmanager.secretAccessor`).

## Cloud Tasks orchestration (enrich fan-out)

An enrich run does not loop through people in one request. The run endpoint
enqueues one Cloud Tasks task per person onto the `knownworld-enrich` queue
(`us-central1`); each task pushes back into the agents service
(`POST /enrich/task`) with an OIDC token for the `knownworld-agents` service
account. Deploy wires this with:

- `TASKS_MODE=cloud`: enqueue to Cloud Tasks (production)
- `TASKS_QUEUE=knownworld-enrich`
- `TASKS_SA_EMAIL`: the OIDC identity on each task push
- `SERVICE_URL`: the service's own public URL, target of the pushes
  (set by deploy.sh in a second pass, because the URL only exists after the
  first deploy)

Local dev fallback: `TASKS_MODE=local` (the default outside Cloud Run) runs
the same handler in-process: no queue, no GCP dependency, same code path.

## Auth model (v2: accounts)

Users sign up with email plus password (or Google) on the web app; the
agents service scrypt-hashes credentials, issues a session JWT signed with
`auth-secret`, and the web app keeps it in an httpOnly cookie. Every store
call is scoped to the signed-in account, so tenants are isolated by
construction. `web/src/proxy.ts` redirects signed-out visitors to the login
page; the agents service re-verifies the JWT on every request and answers
401 to an expired or invalid session.

## Data boundary (what the two containers actually see)

The browser never calls the agents service. Every dashboard call goes to
same-origin `/agents/*` on the web service, where
`web/src/app/agents/[...path]/route.ts` forwards the request body in memory
to `AGENTS_UPSTREAM`, attaching the service token and the session JWT; it
writes nothing and logs nothing. So a distill batch (~20 chats) transits
the web container and the agents container in memory on its way to Gemini,
and is discarded once the rows come back: the honest claim is "we never
store a message", not "messages never leave the browser". `agents/app` has
no logging at all; Cloud Run request logs keep metadata (IP, user agent,
path, status, timing), never bodies. On the hosted instance the operator
could observe a batch in flight; on your own project nobody can. The raw
export itself never leaves the browser.

What lands in Firestore, per account under `users/{uid}/`: `people`
(distilled rows with the model-written summary and the owner note),
`activity_log`, `enrichments` (research cards), `jobs` + `job_runs`,
`pipeline` (tracked leads: name, note, draft), `requests` (question
verbatim, params, result snapshot); root `users/{uid}` (email, scrypt hash)
and `email_index`; global `ats_slugs` (company → feed, no personal data).
`DELETE /data` wipes every tenant collection; the account record stays.
Outbound from the agents container: distill batches, research queries
(name + company) and Requests inputs (question; question + candidate
rows/cards/owner notes; question + up to 8 name/company pairs to Search
grounding; first name + summary + closeness + your ask for an intro) to
Vertex AI, and company names to the public ATS feeds.

## Deploy order: agents → web (and why)

The web service reaches the agents service through `AGENTS_UPSTREAM`, a
**runtime** env var read only by the server-side proxy. The browser bundle
gets `NEXT_PUBLIC_AGENTS_URL=/agents`, a constant path inlined at build time;
the live agents URL is never inlined. deploy.sh still has to know that URL
before it deploys web, because it is set as runtime env on the web service:

1. deploy `knownworld-agents`, capture its URL (plus a second pass that sets
   `SERVICE_URL` on the service for Cloud Tasks self-enqueue)
2. write a **transient** `web/.env.production.local` containing
   `NEXT_PUBLIC_AGENTS_URL=/agents` (plus `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and
   `NEXT_PUBLIC_VIDEO_URL` when set; gitignored; deploy.sh verifies with
   `git check-ignore` and deletes it after), plus a transient
   `web/.gcloudignore` so the source upload doesn't drop the file
3. deploy `knownworld-web` with `AGENTS_UPSTREAM=<agents URL>` and
   `NEXT_PUBLIC_AGENTS_URL=/agents` as runtime env; Cloud Build's
   `npm run build` inlines the path

## Local dev

```sh
# web dashboard on http://localhost:3040
cd web && npm ci && npm run dev -- -p 3040

# agents service on http://localhost:8787 (on-disk store + deterministic
# FAKE model, so the whole loop runs offline: no GCP auth, no spend)
cd agents
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
./run-local.sh

# smoke check
curl -s localhost:8787/health
```

No env file is needed for local dev: `web/.env.development` already routes
the app through the same-origin session proxy to :8787. Every env var is
documented in `.env.example` (repo root); copy it to `.env` only if you
want to override something.

## Deploy

```sh
./deploy.sh
```

Deploys both Cloud Run services from source via Cloud Build, `us-central1`,
in the order described under **Deploy order** above:

1. `knownworld-agents` (from `agents/`): Vertex AI env preset, runs as the
   `knownworld-agents` service account. Publicly reachable **by design** (its
   callers, the web proxy and Cloud Tasks pushes, arrive over plain HTTPS
   with no IAM identity; the browser never calls it), but app-gated: every
   request must carry `AGENTS_API_TOKEN`, mounted from the `agents-api-token`
   secret via `--set-secrets`, plus `AUTH_SECRET` from `auth-secret` to
   verify session JWTs. Cloud Tasks env (`TASKS_MODE=cloud`, `TASKS_QUEUE`,
   `TASKS_SA_EMAIL`, then `SERVICE_URL` in a second pass) is set here too.
2. `knownworld-web` (from `web/`): gets the agents URL as runtime
   `AGENTS_UPSTREAM` for its `/agents/*` proxy (see **Deploy order**), mounts
   `agents-api-token` (the proxy attaches it) and the legacy `dashboard-auth`
   slot, and is session-gated by `web/src/proxy.ts` (per-account signup,
   httpOnly JWT cookie).

The script prints both service URLs at the end; open the web URL and create
an account.

Re-deploy = run `./deploy.sh` again; credentials live in Secret Manager, so
they stay stable across deploys with no env vars to remember.

## Deploy gotchas (hit and fixed on the real deploy; read before debugging)

1. **Cloud Tasks OVERWRITES the `Authorization` header** when an OIDC token
   is configured on the task. The app-level agents token therefore travels on
   a custom `X-Agents-Token` header for queue pushes (`app/tasks.py`), and the
   agents middleware accepts either `Authorization: Bearer <token>` or
   `X-Agents-Token: <token>`. If enrich pushes come back 401, check this
   first. Do not put the app token in `Authorization` on a task with OIDC.
2. **Google's frontend intercepts the literal `/healthz` path** on
   `*.run.app`; the request never reaches the container. The service exposes
   `/health` as an alias; use `/health` against the deployed URL (both paths
   work locally).
3. **Fresh GCP projects**: the first `gcloud run deploy --source` fails on
   `storage.objects.get` until the default compute service account holds
   Cloud Build roles. Grant `roles/cloudbuild.builds.builder` (plus
   `storage.objectViewer`, `artifactregistry.writer`, `logging.logWriter`).
   `infra/setup-gcp.sh` handles this; if you deploy into a project set up
   some other way, grant them manually.

## Budget

Hackathon credit is $150; our hard line is **$20**, enforced by the
`knownworld-cap` budget from setup. Alerts fire at $10 / $18 / $20. Budgets
alert but do not stop spend; if an alert fires, check Cloud Run + Vertex AI
usage immediately. Both services are capped at `--max-instances 3`.

## Self-deploy story (for the write-up)

Any user runs the same three commands (`gcloud auth login`,
`./infra/setup-gcp.sh`, `./deploy.sh`) against their own project id and gets
their own private stack: their browser parses their export locally, distill
batches pass through their own two containers in memory on the way to
Gemini under their billing, and their Firestore holds only what the app
stores per account (rows, cards, asks, tracked leads, activity log, job
runs, the account record), all of it visible in the app and wiped by the
Privacy switch except the account record. Nobody else is in the loop.
