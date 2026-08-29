#!/usr/bin/env bash
# Knownworld — deploy BOTH Cloud Run services from source (Cloud Build).
#
# Prereqs: ./infra/setup-gcp.sh ran once; gcloud auth login done.
#
# Usage:
#   ./deploy.sh
#   AGENTS_API_TOKEN=... BASIC_AUTH_USER=... BASIC_AUTH_PASS=... ./deploy.sh
#   GEMINI_MODEL=gemini-3.5-flash ./deploy.sh
#
# Self-deploy note: deploys into YOUR OWN project (default 'knownworld').
# Override with PROJECT_ID=my-project ./deploy.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-knownworld}"
REGION="${REGION:-us-central1}"
SA_EMAIL="knownworld-agents@${PROJECT_ID}.iam.gserviceaccount.com"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.5-flash}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Secrets for this deploy (generated once if not supplied; SAVE the output) ---

# App-level auth for the agents service: the URL is public (the browser must
# reach it directly), so every request must carry this token instead.
if [[ -z "${AGENTS_API_TOKEN:-}" ]]; then
  AGENTS_API_TOKEN="$(openssl rand -hex 16)"
  echo "==> Generated AGENTS_API_TOKEN (printed ONCE — save it):"
  echo "    AGENTS_API_TOKEN=${AGENTS_API_TOKEN}"
fi

# Dashboard basic-auth gate (D3 wires enforcement; deploy passes the env now).
if [[ -z "${BASIC_AUTH_USER:-}" ]]; then
  BASIC_AUTH_USER="knownworld"
  echo "==> BASIC_AUTH_USER not set — defaulting to '${BASIC_AUTH_USER}'"
fi
if [[ -z "${BASIC_AUTH_PASS:-}" ]]; then
  BASIC_AUTH_PASS="$(openssl rand -hex 12)"
  echo "==> Generated BASIC_AUTH_PASS (printed ONCE — save it):"
  echo "    BASIC_AUTH_PASS=${BASIC_AUTH_PASS}"
fi

# --- 1/2: agents service ------------------------------------------------------
# --allow-unauthenticated is DELIBERATE: refine batches go browser -> agents
# directly (raw text must never route through our web server). The real gate is
# AGENTS_API_TOKEN, checked app-side on every request.
echo "==> Deploying knownworld-agents from agents/ ..."
gcloud run deploy knownworld-agents \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --source "${REPO_ROOT}/agents" \
  --service-account "${SA_EMAIL}" \
  --allow-unauthenticated \
  --memory 1Gi \
  --max-instances 3 \
  --set-env-vars "GOOGLE_GENAI_USE_VERTEXAI=TRUE,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${REGION},GEMINI_MODEL=${GEMINI_MODEL},AGENTS_API_TOKEN=${AGENTS_API_TOKEN}"

AGENTS_URL="$(gcloud run services describe knownworld-agents \
  --project "${PROJECT_ID}" --region "${REGION}" \
  --format='value(status.url)')"
echo "==> agents URL: ${AGENTS_URL}"

# --- 2/2: web dashboard -------------------------------------------------------
# NOTE: NEXT_PUBLIC_* is normally inlined at BUILD time; with --source the env
# below is runtime-only. The dashboard therefore reads the agents URL
# server-side at request time (D3 wires that); we pass it here as agreed.
echo "==> Deploying knownworld-web from web/ ..."
gcloud run deploy knownworld-web \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --source "${REPO_ROOT}/web" \
  --allow-unauthenticated \
  --max-instances 3 \
  --set-env-vars "NEXT_PUBLIC_AGENTS_URL=${AGENTS_URL},BASIC_AUTH_USER=${BASIC_AUTH_USER},BASIC_AUTH_PASS=${BASIC_AUTH_PASS}"

WEB_URL="$(gcloud run services describe knownworld-web \
  --project "${PROJECT_ID}" --region "${REGION}" \
  --format='value(status.url)')"

echo ""
echo "=================================================================="
echo " Deployed."
echo "   agents : ${AGENTS_URL}"
echo "   web    : ${WEB_URL}"
echo ""
echo " REMINDER: the dashboard must stay auth-gated (BASIC_AUTH_USER /"
echo " BASIC_AUTH_PASS). Do not remove the gate before judging ends."
echo "=================================================================="
