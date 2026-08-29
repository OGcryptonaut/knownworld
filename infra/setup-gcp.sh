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
# Override with PROJECT_ID=my-project ./infra/setup-gcp.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-knownworld}"
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
  billingbudgets.googleapis.com

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
for role in roles/aiplatform.user roles/datastore.user; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${role}" \
    --condition=None \
    --format='none'
  echo "    ${SA_EMAIL} -> ${role}"
done

echo "==> Budget '${BUDGET_NAME}' — \$20/month, alerts at 50% / 90% / 100%"
BILLING_ACCOUNT="$(gcloud billing projects describe "${PROJECT_ID}" --format='value(billingAccountName)')"
if [[ -z "${BILLING_ACCOUNT}" ]]; then
  echo "!! ERROR: no billing account attached to ${PROJECT_ID}. Attach one, then re-run." >&2
  exit 1
fi
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
  PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
  gcloud billing budgets create \
    --billing-account="${BILLING_ACCOUNT}" \
    --display-name="${BUDGET_NAME}" \
    --budget-amount=20USD \
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
echo "                  roles/aiplatform.user + roles/datastore.user"
echo "   Budget       : ${BUDGET_NAME} \$20 (50/90/100% alerts)"
echo " Next: ./deploy.sh"
echo "=================================================================="
