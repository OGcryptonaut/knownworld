# Deployment (Cloud Run)

## Live services

| Service | URL | Auth |
|---|---|---|
| knownworld-web | https://knownworld-web-ncr73a6xhq-uc.a.run.app | Account signup (email + password, or Google). Every account is its own isolated tenant; the session is an httpOnly JWT cookie. |
| knownworld-agents | https://knownworld-agents-ncr73a6xhq-uc.a.run.app | Service token (`agents-api-token`) checked on every request, plus a per-user session JWT signed with `auth-secret`. `/health` is open. |

There is no shared password: judges create their own account and press
"Try the demo network". Secrets live in Secret Manager (`agents-api-token`,
`auth-secret`; `dashboard-auth` is a legacy v1 slot, unused by v2).

Verified live on the deployed instance (real Gemini 3.5 Flash on Vertex,
`fake:false`): the 15-contact demo distills in one batch, all 15 research
cards come back verdict=match through the Cloud Tasks fan-out, and a jobs
request scans 9 live feeds, several thousand postings, with role-fit
filtering and warm paths.

## Deploy from scratch (any GCP project; self-deploy is the product)

```bash
gcloud auth login && gcloud auth application-default login
PROJECT_ID=<yours> bash infra/setup-gcp.sh   # APIs, Firestore, SA + roles, Tasks queue, secrets, budget
PROJECT_ID=<yours> bash deploy.sh            # agents first, then web (the web build needs the agents URL)
```

New-project gotcha (hit and fixed here): grant the default compute service
account `roles/cloudbuild.builds.builder` plus storage.objectViewer,
artifactregistry.writer and logging.logWriter, or the first
`gcloud run deploy --source` fails on `storage.objects.get`.
`infra/setup-gcp.sh` does this for you; the note is here in case you run
the pieces by hand.

See [infra/README-DEPLOY.md](infra/README-DEPLOY.md) for the full
walkthrough with expected output at every step.
