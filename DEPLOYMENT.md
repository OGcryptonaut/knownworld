# Deployment (Cloud Run) + Google Cloud Proof Pack

## Live services (v2 deployed 30 Aug — multi-account)
| Service | URL | Auth |
|---|---|---|
| knownworld-web | https://knownworld-web-ncr73a6xhq-uc.a.run.app | **Account signup** (email+password on /signup) — every account is its own isolated tenant; session = httpOnly JWT cookie |
| knownworld-agents (ADK service) | https://knownworld-agents-ncr73a6xhq-uc.a.run.app | Service token (`agents-api-token`) app-side + per-user session JWT (`auth-secret` signs it); `/health` open |

v2 auth: no shared basic-auth password anymore — judges create their own
account and click "Try the demo network". Secrets stay in Secret Manager
(`agents-api-token`, `auth-secret`; `dashboard-auth` is legacy/unused).

Verified live 30 Aug on the deployed instance (real Gemini 3.5 Flash on
Vertex, `fake:false`): 15-contact demo distilled in one batch, 15/15
grounded research cards all verdict=match via Cloud Tasks fan-out, jobs
request → 9 live feeds, ~6.7k postings, 108 role-fit within a 30-day
window, warm paths + drafts.

## Deploy from scratch (any GCP project — self-deploy IS the product)
```
gcloud auth login && gcloud auth application-default login
PROJECT_ID=<yours> bash infra/setup-gcp.sh   # APIs, Firestore, SA+roles, Tasks queue, secrets, €20 budget
PROJECT_ID=<yours> bash deploy.sh            # agents → web (order matters: web build needs the agents URL)
```
New-project gotcha (hit + fixed here): grant the default compute SA
`roles/cloudbuild.builds.builder` (+ storage.objectViewer, artifactregistry.writer,
logging.logWriter) or the first `gcloud run deploy --source` fails on
`storage.objects.get`.

## Proof-pack capture walkthrough (docs/PROOF-PACK.md — record DURING the live run)
1. **Cloud Run services green** — Console → Cloud Run: `knownworld-web`, `knownworld-agents` both ✓.
2. **Metrics moving** — Cloud Run → knownworld-agents → Metrics: request count/latency climbing from the demo's own refine/enrich traffic.
3. **Log tail with model ID** — Cloud Run → knownworld-agents → Logs, filter `refine`; every batch logs the resolved `gemini-3.5-flash`. (Or: `gcloud run services logs read knownworld-agents --region us-central1 | grep model`.)
4. **Vertex AI usage** — Console → Vertex AI → Dashboard/usage for the project.
5. **Firestore counts ONLY** — Console → Firestore: collections `people`, `activity_log`, `enrichments`, `jobs`, `ats_slugs`, `pipeline` with doc counts. **NEVER expand a person document on camera** (real names, no masking in the console).

## Video-run choreography (~45s of the ~4 min)
Address bar visible on the .run.app URL → basic-auth login on camera →
dashboard already masked (Privacy display mode ON) → run the live flow →
flip to the console tabs (pre-opened) for captures 1-5 → back to the app.
