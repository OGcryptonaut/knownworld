#!/usr/bin/env bash
# Local dev runner: JSON-on-disk store + deterministic FAKE model — zero
# network, zero credentials. The full system runs end-to-end on canned
# model output; swap in a real model later with ONE env var:
#   FAKE_LLM=0 MODEL_BACKEND=claude ANTHROPIC_API_KEY=... ./run-local.sh   (dev only)
#   MODEL_BACKEND=gemini GOOGLE_GENAI_USE_VERTEXAI=FALSE GOOGLE_API_KEY=<AI Studio key> ./run-local.sh
cd "$(dirname "$0")"
export STORE_MODE="${STORE_MODE:-local}"
export MODEL_BACKEND="${MODEL_BACKEND:-gemini}"
export FAKE_LLM="${FAKE_LLM:-1}"
exec .venv/bin/uvicorn app.main:app --port "${PORT:-8787}" "$@"
