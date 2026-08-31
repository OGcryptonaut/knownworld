#!/usr/bin/env bash
# Knownworld — one-time GCP project setup. Idempotent: safe to re-run.
#
# Prereqs:
#   gcloud auth login
#   gcloud auth application-default login   # for any local tooling that needs ADC
#
# Usage:
#   ./infra/setup-gcp.sh
#
# Self-deploy note: this runs against YOUR OWN project (default 'knownworld').
# Required: PROJECT_ID=my-project ./infra/setup-gcp.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?set PROJECT_ID=<your-gcp-project> (self-deploy goes into YOUR own project)}"
REGION="${REGION:-us-central1}"
SA_NAME="knownworld-agents"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
BUDGET_NAME="knownworld-cap"

echo "==> Project: ${PROJECT_ID}  Region: ${REGION}"
gcloud config set project "${PROJECT_ID}"

echo "==> Enabling APIs (no-op if already enabled)"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  aiplatform.googleapis.com \
  secretmanager.googleapis.com \
  billingbudgets.googleapis.com \
  cloudtasks.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com

echo "==> Firestore database '(default)' — native mode, ${REGION}"
if gcloud firestore databases describe --database='(default)' >/dev/null 2>&1; then
  echo "    already exists — skipping"
else
  gcloud firestore databases create \
    --database='(default)' \
    --location="${REGION}" \
    --type=firestore-native
fi

echo "==> Artifact Registry docker repo 'knownworld' — ${REGION}"
if gcloud artifacts repositories describe knownworld --location="${REGION}" >/dev/null 2>&1; then
  echo "    already exists — skipping"
else
  gcloud artifacts repositories create knownworld \
    --repository-format=docker \
    --location="${REGION}" \
    --description="Knownworld Cloud Run images"
fi

echo "==> Service account ${SA_EMAIL}"
if gcloud iam service-accounts describe "${SA_EMAIL}" >/dev/null 2>&1; then
  echo "    already exists — skipping create"
else
  gcloud iam service-accounts create "${SA_NAME}" \
    --display-name="Knownworld agents (Vertex AI + Firestore)"
fi

echo "==> Binding roles (add-iam-policy-binding is idempotent)"
# aiplatform.user + datastore.user : Vertex AI calls + Firestore reads/writes
# secretmanager.secretAccessor     : Cloud Run mounts secrets via --set-secrets
# cloudtasks.enqueuer              : agents service enqueues per-person enrich jobs
# run.invoker                      : Cloud Tasks OIDC pushes back into the service
# logging.logWriter                : structured per-batch logs
for role in \
    roles/aiplatform.user \
    roles/datastore.user \
    roles/secretmanager.secretAccessor \
    roles/cloudtasks.enqueuer \
    roles/run.invoker \
    roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${role}" \
    --condition=None \
    --format='none'
  echo "    ${SA_EMAIL} -> ${role}"
done

# Creating a Cloud Tasks task WITH an OIDC token requires actAs on the token's
# service account — even when the caller IS that account. Grant it to itself.
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser" \
  --format='none'
echo "    ${SA_EMAIL} -> roles/iam.serviceAccountUser (on itself, for OIDC tasks)"

# ---- Cloud Build roles for the DEFAULT COMPUTE service account ---------------
# 'gcloud run deploy --source' runs Cloud Build as PROJECT_NUMBER-compute@...
# In a NEW project that SA lacks the build roles, and the deploy fails with an
# opaque permissions error (this bit the first deploy). Grant them up front —
# add-iam-policy-binding is idempotent, so re-runs are safe.
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
echo "==> Cloud Build roles for default compute SA ${COMPUTE_SA}"
for role in \
    roles/cloudbuild.builds.builder \
    roles/storage.objectViewer \
    roles/artifactregistry.writer \
    roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${COMPUTE_SA}" \
    --role="${role}" \
    --condition=None \
    --format='none'
  echo "    ${COMPUTE_SA} -> ${role}"
done

echo "==> Cloud Tasks queue 'knownworld-enrich' — ${REGION}"
if gcloud tasks queues describe knownworld-enrich --location="${REGION}" >/dev/null 2>&1; then
  echo "    already exists — skipping"
else
  gcloud tasks queues create knownworld-enrich --location="${REGION}"
  echo "    queue created"
fi

# ---- Secrets (create-once: an existing secret is NEVER overwritten) ----------
# secret_exists NAME
secret_exists() {
  gcloud secrets describe "$1" >/dev/null 2>&1
}

# create_secret NAME VALUE  (automatic replication, value from stdin)
create_secret() {
  printf '%s' "$2" | gcloud secrets create "$1" \
    --replication-policy=automatic \
    --data-file=-
}

echo "==> Secret 'dashboard-auth' (dashboard basic-auth password)"
if secret_exists dashboard-auth; then
  echo "    already exists — NOT rotating. Retrieve with:"
  echo "    gcloud secrets versions access latest --secret=dashboard-auth"
else
  DASHBOARD_PASS="$(openssl rand -base64 18)"
  create_secret dashboard-auth "${DASHBOARD_PASS}"
  echo ""
  echo "!! =========================================================================="
  echo "!! SAVE THIS — dashboard login password (printed ONCE, never again):"
  echo "!!"
  echo "!!     user: knownworld    password: ${DASHBOARD_PASS}"
  echo "!!"
  echo "!! Later retrieval: gcloud secrets versions access latest --secret=dashboard-auth"
  echo "!! =========================================================================="
  echo ""
fi

echo "==> Secret 'auth-secret' (v2: signs user session JWTs)"
if secret_exists auth-secret; then
  echo "    exists — kept as-is (rotating it logs every user out)"
else
  create_secret auth-secret "$(openssl rand -hex 32)"
  echo "    created (random 64-hex; never printed — the app is its only consumer)"
fi

echo "==> Secret 'agents-api-token' (app-level auth for the public agents URL)"
if secret_exists agents-api-token; then
  echo "    already exists — NOT rotating. Retrieve with:"
  echo "    gcloud secrets versions access latest --secret=agents-api-token"
else
  AGENTS_TOKEN="$(openssl rand -hex 16)"
  create_secret agents-api-token "${AGENTS_TOKEN}"
  echo ""
  echo "!! =========================================================================="
  echo "!! SAVE THIS — agents API token (printed ONCE, never again):"
  echo "!!"
  echo "!!     AGENTS_API_TOKEN=${AGENTS_TOKEN}"
  echo "!!"
  echo "!! Later retrieval: gcloud secrets versions access latest --secret=agents-api-token"
  echo "!! =========================================================================="
  echo ""
fi

echo "==> Secret 'app-config' (OPTIONAL fallback slot — not used by the build)"
# Owner decision: enrichment uses NATIVE Gemini Google Search grounding only.
# This slot exists so a self-deployer COULD plug in an external search key
# (e.g. Tavily) without schema changes; the shipped code never reads it.
if secret_exists app-config; then
  echo "    already exists — skipping"
else
  create_secret app-config '{"TAVILY_API_KEY": ""}'
  echo "    created (empty Tavily slot; unused fallback)"
fi

echo "==> Budget '${BUDGET_NAME}' — 20/month in the billing account's currency, alerts at 50% / 90% / 100%"
BILLING_ACCOUNT="$(gcloud billing projects describe "${PROJECT_ID}" --format='value(billingAccountName)')"
if [[ -z "${BILLING_ACCOUNT}" ]]; then
  echo "!! ERROR: no billing account attached to ${PROJECT_ID}. Attach one, then re-run." >&2
  exit 1
fi
# The budget amount's currency MUST match the billing account's currency or the
# create call fails. Auto-detect it; override with BUDGET_CURRENCY=USD etc.
DETECTED_CURRENCY="$(gcloud billing accounts describe "${BILLING_ACCOUNT#billingAccounts/}" \
  --format='value(currencyCode)' 2>/dev/null || true)"
BUDGET_CURRENCY="${BUDGET_CURRENCY:-${DETECTED_CURRENCY:-EUR}}"
echo "    billing account currency: ${BUDGET_CURRENCY}"
if gcloud billing budgets list \
    --billing-account="${BILLING_ACCOUNT}" \
    --format='value(displayName)' | grep -Fxq "${BUDGET_NAME}"; then
  echo ""
  echo "!! =========================================================================="
  echo "!! WARNING: a budget named '${BUDGET_NAME}' ALREADY EXISTS on ${BILLING_ACCOUNT}."
  echo "!! NOT creating a second one. Verify manually that it is \$20 with 50/90/100%"
  echo "!! threshold alerts:  gcloud billing budgets list --billing-account=${BILLING_ACCOUNT}"
  echo "!! =========================================================================="
  echo ""
else
  gcloud billing budgets create \
    --billing-account="${BILLING_ACCOUNT}" \
    --display-name="${BUDGET_NAME}" \
    --budget-amount="20.00${BUDGET_CURRENCY}" \
    --filter-projects="projects/${PROJECT_NUMBER}" \
    --threshold-rule=percent=0.5 \
    --threshold-rule=percent=0.9 \
    --threshold-rule=percent=1.0
  echo "    budget created"
fi

echo ""
echo "=================================================================="
echo " Setup complete for project '${PROJECT_ID}' (${REGION})"
echo "   APIs enabled : run, cloudbuild, artifactregistry, firestore,"
echo "                  aiplatform, secretmanager, billingbudgets"
echo "   Firestore    : (default) native mode, ${REGION}"
echo "   Artifact repo: knownworld (docker), ${REGION}"
echo "   Service acct : ${SA_EMAIL}"
echo "                  aiplatform.user + datastore.user + secretAccessor +"
echo "                  cloudtasks.enqueuer + run.invoker + logging.logWriter"
echo "   Compute SA   : ${COMPUTE_SA}"
echo "                  cloudbuild.builds.builder + storage.objectViewer +"
echo "                  artifactregistry.writer + logging.logWriter (for --source builds)"
echo "   Cloud Tasks  : queue knownworld-enrich, ${REGION}"
echo "   Secrets      : agents-api-token, auth-secret, dashboard-auth (legacy), app-config"
echo "                  (Tavily slot = optional fallback, unused by the build)"
echo "   Budget       : ${BUDGET_NAME} 20 ${BUDGET_CURRENCY} (50/90/100% alerts)"
echo " Next: ./deploy.sh"
echo "=================================================================="
