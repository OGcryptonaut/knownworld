# VLAD-TEST — cold deploy into YOUR OWN GCP project

Vlad: this is the end-to-end portability test. You deploy Knownworld into a
fresh GCP project of your own, with your own data. Two commands, then the
pass gates below. Budget impact: cents (owner's full run cost ~$0.19 total).

## Prerequisites

- Your own GCP project (fresh is best) with **billing attached**.
- `gcloud` CLI installed, then BOTH logins:
  ```bash
  gcloud auth login
  gcloud auth application-default login
  ```
- Node 22+ (`node --version`), Python 3.12 (`python3 --version`).
  (Cloud Build compiles both services remotely — local Node/Python are only
  needed if you also want to run tests or the dev servers.)
- A clone of this repo, `main` branch.

## Deploy (exactly two commands)

```bash
export PROJECT_ID=<your-project-id>

bash infra/setup-gcp.sh   # one-time infra; idempotent, safe to re-run
bash deploy.sh            # deploys agents, then web (order matters)
```

**setup-gcp.sh success looks like:** APIs enabled; Firestore `(default)`
created; Artifact Registry repo `knownworld`; service account
`knownworld-agents@<your-project>.iam.gserviceaccount.com` with 6 roles;
**default compute SA granted the 4 Cloud Build roles** (this is automated now —
see gotcha 1); Cloud Tasks queue `knownworld-enrich`; two `SAVE THIS` blocks
printing your dashboard password and agents API token **once** (save both —
retrieval commands are printed alongside); a `knownworld-cap` budget of 20 in
your billing currency with 50/90/100% alerts; final banner
`Setup complete for project '<your-project>'`.

**deploy.sh success looks like:** preflight `secrets ... exist`; a Cloud Build
for `knownworld-agents` (a few minutes), then `agents URL: https://...run.app`;
a `SERVICE_URL` wiring update; a Cloud Build for `knownworld-web`; final banner
with both URLs and the login/retrieval commands.

## Pass gates

- [ ] Both Cloud Run services green:
  `gcloud run services list --project $PROJECT_ID --region us-central1`
  shows `knownworld-agents` and `knownworld-web` Ready.
- [ ] Dashboard auth gate works: opening the web URL logged-out gives **401**;
  with user `knownworld` + password it loads (200). Password:
  ```bash
  gcloud secrets versions access latest --secret=dashboard-auth
  ```
- [ ] Agents health: `curl https://<your-agents-url>/health` returns
  `{"status":"ok","model":"gemini-3.5-flash","vertex":true,"fake":false}`.
- [ ] Onboarding ingests **your own** Telegram export fully client-side.
  Export instructions: `docs/01-export.md`. Load it on the dashboard root
  page with DevTools → Network open: parsing happens in-browser (IndexedDB);
  **zero chat content leaves the browser during parse** — no request bodies
  containing your messages.
- [ ] One refine run over a small batch completes (refine page; it asks for
  the agents API token — `gcloud secrets versions access latest
  --secret=agents-api-token`). The activity telemetry row shows the model id
  `gemini-3.5-flash`.
- [ ] Estimated cost is visible on the run telemetry and is tiny
  (fractions of a cent per batch).
- [ ] Budget alert exists in YOUR billing:
  ```bash
  gcloud billing budgets list --billing-account=$(gcloud billing projects describe $PROJECT_ID --format='value(billingAccountName)')
  ```
  shows `knownworld-cap`.

## Troubleshooting (the known gotchas)

1. **Cloud Build permissions on a fresh project.** `gcloud run deploy --source`
   runs Cloud Build as `<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`,
   which lacks the build roles in a new project — the deploy fails with an
   opaque IAM/storage error. `infra/setup-gcp.sh` now grants
   `cloudbuild.builds.builder`, `storage.objectViewer`,
   `artifactregistry.writer`, `logging.logWriter` automatically. If you still
   hit it, re-run setup-gcp.sh and wait ~1 min for IAM propagation.
2. **`/healthz` vs `/health`.** Google's frontend intercepts the literal
   `/healthz` path on `*.run.app` — it never reaches the container. Use
   `/health` (the service serves both paths; only `/health` is reachable
   through run.app).
3. **Budget currency.** The budget amount's currency must match your billing
   account's. setup-gcp.sh auto-detects it; if detection fails, re-run with
   `BUDGET_CURRENCY=USD` (or your currency) exported.
4. **First grounded call can transiently 502** (cold Vertex grounding path) —
   just retry; subsequent calls are fine.

Also: `web/.env.development.local` is machine-specific and gitignored — you
won't have one and don't need one for this cloud test. Only if you run the web
app locally in dev, create your own pointing `DEV_EXPORT_PATH` at your own
export file.

## Privacy

Your deploy is YOUR instance with YOUR data: use your own Telegram export
only — do **not** load the owner's export or data into your project. If you
record anything against the owner's prod URL, Privacy display mode must be ON
(masking at render). Firestore in your project stores distilled rows only;
the raw export never leaves your browser.
