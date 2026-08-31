#!/usr/bin/env bash
# Knownworld — deploy BOTH Cloud Run services from source (Cloud Build).
#
# Prereqs: ./infra/setup-gcp.sh ran once (creates the Secret Manager secrets,
#          the Cloud Tasks queue and all IAM); gcloud auth login done.
#
# Usage:
#   ./deploy.sh
#   BASIC_AUTH_USER=someone ./deploy.sh
#   GEMINI_MODEL=gemini-3.5-flash ./deploy.sh
#
# Deploy ORDER matters: agents first, then web — the web BUILD needs the live
# agents URL (NEXT_PUBLIC_* is inlined into the browser bundle at build time).
#
# Self-deploy note: deploys into YOUR OWN project (default 'knownworld').
# Override with PROJECT_ID=my-project ./deploy.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-project-b6de64c7-201b-4885-92d}"
REGION="${REGION:-us-central1}"
SA_EMAIL="knownworld-agents@${PROJECT_ID}.iam.gserviceaccount.com"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.5-flash}"
TASKS_QUEUE="${TASKS_QUEUE:-knownworld-enrich}"
BASIC_AUTH_USER="${BASIC_AUTH_USER:-knownworld}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="${REPO_ROOT}/web"

gcloud config set project "${PROJECT_ID}" --quiet

# --- Preflight: secrets must exist (created by infra/setup-gcp.sh) ------------
for secret in agents-api-token dashboard-auth auth-secret; do
  if ! gcloud secrets describe "${secret}" >/dev/null 2>&1; then
    echo "!! ERROR: Secret Manager secret '${secret}' not found in ${PROJECT_ID}." >&2
    echo "!!        Run ./infra/setup-gcp.sh first, then re-run ./deploy.sh." >&2
    exit 1
  fi
done
# --- HACKATHON MANDATE GUARD: submission deploys run Gemini, never Claude ----
# MODEL_BACKEND=claude is the local-dev backend (Anthropic subscription).
# Deploying it would break the mandated stack (Gemini + ADK + GCP).
if [ "${MODEL_BACKEND:-gemini}" != "gemini" ]; then
  echo "!! ERROR: MODEL_BACKEND='${MODEL_BACKEND}' — deploys must run Gemini." >&2
  echo "!! Unset MODEL_BACKEND (or set it to 'gemini') and redeploy." >&2
  exit 1
fi

echo "==> Preflight OK: secrets agents-api-token + dashboard-auth + auth-secret exist"

# --- Cleanup of transient web build files, whatever happens -------------------
# deploy.sh materializes two files under web/ for the WEB build only and must
# never leave them behind (see the web section below for why they exist).
cleanup() {
  rm -f "${WEB_DIR}/.env.production.local"
  rm -f "${WEB_DIR}/.gcloudignore"
  if [[ -f "${WEB_DIR}/.gcloudignore.deploy-bak" ]]; then
    mv "${WEB_DIR}/.gcloudignore.deploy-bak" "${WEB_DIR}/.gcloudignore"
  fi
}
trap cleanup EXIT

# --- 1/2: agents service ------------------------------------------------------
# --allow-unauthenticated is DELIBERATE: refine batches go browser -> agents
# directly (raw text must never route through our web server). The real gate is
# AGENTS_API_TOKEN — now mounted from Secret Manager, checked app-side on every
# request. TASKS_* switch the enrich pipeline to Cloud Tasks fan-out; the
# handler pushes back into this same service with an OIDC token for SA_EMAIL.
echo "==> Deploying knownworld-agents from agents/ ..."
gcloud run deploy knownworld-agents \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --source "${REPO_ROOT}/agents" \
  --service-account "${SA_EMAIL}" \
  --allow-unauthenticated \
  --memory 1Gi \
  --max-instances 3 \
  --set-secrets "AGENTS_API_TOKEN=agents-api-token:latest,AUTH_SECRET=auth-secret:latest" \
  --set-env-vars "GOOGLE_GENAI_USE_VERTEXAI=TRUE,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${GENAI_LOCATION:-global},GEMINI_MODEL=${GEMINI_MODEL},MODEL_BACKEND=gemini,STORE_MODE=firestore,TASKS_MODE=cloud,TASKS_QUEUE=${TASKS_QUEUE},TASKS_SA_EMAIL=${SA_EMAIL},GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_CLIENT_ID:-}"

AGENTS_URL="$(gcloud run services describe knownworld-agents \
  --project "${PROJECT_ID}" --region "${REGION}" \
  --format='value(status.url)')"
if [[ -z "${AGENTS_URL}" ]]; then
  echo "!! ERROR: could not resolve the knownworld-agents URL after deploy." >&2
  exit 1
fi
echo "==> agents URL: ${AGENTS_URL}"

# Second pass: the service must know ITS OWN public URL so the enrich run can
# enqueue Cloud Tasks that push back to /enrich/task on this service. The URL
# only exists after the first deploy, hence deploy -> describe -> update.
# --update-env-vars MERGES (never use --set-env-vars here: it would wipe the rest).
echo "==> Wiring SERVICE_URL=${AGENTS_URL} into knownworld-agents ..."
gcloud run services update knownworld-agents \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --update-env-vars "SERVICE_URL=${AGENTS_URL}"

# --- 2/2: web dashboard -------------------------------------------------------
# NEXT_PUBLIC_* is inlined into the BROWSER bundle at BUILD time; runtime env
# on Cloud Run is invisible to it. So the agents URL is materialized as
# web/.env.production.local BEFORE the build ('npm run build' inside Cloud
# Build picks .env.production.local up) and deleted right after the deploy.
echo "==> Writing transient web/.env.production.local (build-time agents URL)"
if command -v git >/dev/null 2>&1 && git -C "${REPO_ROOT}" rev-parse --git-dir >/dev/null 2>&1; then
  if ! git -C "${REPO_ROOT}" check-ignore -q web/.env.production.local; then
    echo "!! ERROR: web/.env.production.local is NOT gitignored — refusing to write it." >&2
    echo "!!        Fix .gitignore (.env.* must stay ignored), then re-run." >&2
    exit 1
  fi
else
  echo "    (not a git checkout — skipping the check-ignore guard)"
fi
printf 'NEXT_PUBLIC_AGENTS_URL=/agents\n' > "${WEB_DIR}/.env.production.local"
# landing explainer video: VIDEO_URL=https://youtu.be/... bash deploy.sh
if [ -n "${VIDEO_URL:-}" ]; then
  printf 'NEXT_PUBLIC_VIDEO_URL=%s\n' "${VIDEO_URL}" >> "${WEB_DIR}/.env.production.local"
fi
# Sign in with Google: GOOGLE_CLIENT_ID=<...>.apps.googleusercontent.com bash deploy.sh
# (build-time for the button, runtime env above for the token audience check;
# without it the button hides and /auth/google answers 503 — password auth
# is unaffected)
if [ -n "${GOOGLE_CLIENT_ID:-}" ]; then
  printf 'NEXT_PUBLIC_GOOGLE_CLIENT_ID=%s\n' "${GOOGLE_CLIENT_ID}" >> "${WEB_DIR}/.env.production.local"
fi

# gcloud's source upload honors web/.gitignore (which ignores .env*) when no
# .gcloudignore exists — that would silently DROP the file we just wrote. So
# also materialize a transient web/.gcloudignore that keeps the upload small
# but explicitly re-includes .env.production.local. Removed by cleanup().
if [[ -f "${WEB_DIR}/.gcloudignore" ]]; then
  mv "${WEB_DIR}/.gcloudignore" "${WEB_DIR}/.gcloudignore.deploy-bak"
fi
cat > "${WEB_DIR}/.gcloudignore" <<'EOF'
.gcloudignore
.gcloudignore.deploy-bak
.git
.gitignore
node_modules/
.next/
out/
coverage/
*.tsbuildinfo
.env*
!.env.production.local
EOF

# Web runs as the same service account so Cloud Run can mount the
# dashboard-auth secret (SA has secretmanager.secretAccessor from setup).
# BASIC_AUTH_PASS activates the basic-auth gate in web/middleware.ts.
# NEXT_PUBLIC_AGENTS_URL is ALSO passed at runtime for server-side readers.
echo "==> Deploying knownworld-web from web/ ..."
gcloud run deploy knownworld-web \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --source "${WEB_DIR}" \
  --service-account "${SA_EMAIL}" \
  --allow-unauthenticated \
  --max-instances 3 \
  --set-secrets "BASIC_AUTH_PASS=dashboard-auth:latest,AGENTS_API_TOKEN=agents-api-token:latest" \
  --set-env-vars "NEXT_PUBLIC_AGENTS_URL=/agents,AGENTS_UPSTREAM=${AGENTS_URL},BASIC_AUTH_USER=${BASIC_AUTH_USER}"

WEB_URL="$(gcloud run services describe knownworld-web \
  --project "${PROJECT_ID}" --region "${REGION}" \
  --format='value(status.url)')"

# Transient build files go away immediately (trap also covers failure paths).
cleanup
trap - EXIT

echo ""
echo "=================================================================="
echo " Deployed."
echo "   agents : ${AGENTS_URL}"
echo "   web    : ${WEB_URL}"
echo ""
echo " Dashboard login: ${BASIC_AUTH_USER} / <password from Secret Manager>:"
echo "   gcloud secrets versions access latest --secret=dashboard-auth"
echo " Agents API token (browser refine page asks for it):"
echo "   gcloud secrets versions access latest --secret=agents-api-token"
echo ""
echo " REMINDER: the dashboard must STAY auth-gated (middleware enforces it"
echo " whenever BASIC_AUTH_PASS is set). Do not remove the gate before"
echo " judging ends. Rotate: add a new secret version, redeploy web."
echo "=================================================================="
