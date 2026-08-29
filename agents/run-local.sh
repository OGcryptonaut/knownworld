#!/usr/bin/env bash
# Local dev runner: JSON-on-disk store + Claude Haiku via the Anthropic
# subscription (`ant auth login` once). DEV ONLY — deploys run Gemini
# (hackathon mandate; deploy.sh enforces it).
#   FAKE_LLM=1 ./run-local.sh                      -> deterministic stub, no network
#   MODEL_BACKEND=gemini GOOGLE_GENAI_USE_VERTEXAI=FALSE GOOGLE_API_KEY=<AI Studio key> ./run-local.sh
cd "$(dirname "$0")"
export STORE_MODE="${STORE_MODE:-local}"
export MODEL_BACKEND="${MODEL_BACKEND:-claude}"
export FAKE_LLM="${FAKE_LLM:-0}"
exec .venv/bin/uvicorn app.main:app --port "${PORT:-8787}" "$@"
