#!/usr/bin/env bash
# Local dev runner: JSON-on-disk store, deterministic FAKE model — zero GCP.
# Real Gemini locally: FAKE_LLM=0 GOOGLE_GENAI_USE_VERTEXAI=FALSE GOOGLE_API_KEY=<AI Studio key> ./run-local.sh
cd "$(dirname "$0")"
export STORE_MODE="${STORE_MODE:-local}"
export FAKE_LLM="${FAKE_LLM:-1}"
exec .venv/bin/uvicorn app.main:app --port "${PORT:-8080}" "$@"
