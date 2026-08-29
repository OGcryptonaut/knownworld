"""Environment configuration for the Knownworld agents service.

Every value is env-overridable; defaults target the hackathon GCP project.
"""

from __future__ import annotations

import os


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


GOOGLE_GENAI_USE_VERTEXAI: bool = _env_bool("GOOGLE_GENAI_USE_VERTEXAI", True)
GOOGLE_CLOUD_PROJECT: str = os.environ.get("GOOGLE_CLOUD_PROJECT", "project-b6de64c7-201b-4885-92d")
GOOGLE_CLOUD_LOCATION: str = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")
GEMINI_MODEL: str = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")
FAKE_LLM: bool = _env_bool("FAKE_LLM", False)
FAKE_FIRESTORE: bool = _env_bool("FAKE_FIRESTORE", FAKE_LLM)
FRONTEND_ORIGIN: str = os.environ.get("FRONTEND_ORIGIN", "http://localhost:3040")
PORT: int = int(os.environ.get("PORT", "8080"))

# The google-genai client (used by ADK under the hood) reads these from the
# environment; make our defaults visible to it without clobbering real env.
os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "TRUE" if GOOGLE_GENAI_USE_VERTEXAI else "FALSE")
os.environ.setdefault("GOOGLE_CLOUD_PROJECT", GOOGLE_CLOUD_PROJECT)
os.environ.setdefault("GOOGLE_CLOUD_LOCATION", GOOGLE_CLOUD_LOCATION)

# ---- Cost table -------------------------------------------------------------
# model-id prefix -> (usd per 1M input tokens, usd per 1M output tokens).
# Longest matching prefix wins. Overridable via COST_TABLE env var using the
# format: "prefix=in:out,prefix=in:out"  e.g. "gemini-3.5-flash=0.10:0.40".
# Unknown models cost 0 and the estimate carries a note (see estimate_cost).

_DEFAULT_COST_TABLE: dict[str, tuple[float, float]] = {
    # flash-class default pricing (USD / 1M tokens)
    "gemini-3.5-flash": (0.10, 0.40),
    "gemini-3-flash": (0.10, 0.40),
    "gemini-2.5-flash": (0.30, 2.50),
    "gemini-2.5-flash-lite": (0.10, 0.40),
    "gemini-2.5-pro": (1.25, 10.00),
}


def _parse_cost_table(raw: str) -> dict[str, tuple[float, float]]:
    table: dict[str, tuple[float, float]] = {}
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry or "=" not in entry:
            continue
        prefix, _, rates = entry.partition("=")
        parts = rates.split(":")
        if len(parts) != 2:
            continue
        try:
            table[prefix.strip()] = (float(parts[0]), float(parts[1]))
        except ValueError:
            continue
    return table


COST_TABLE: dict[str, tuple[float, float]] = {
    **_DEFAULT_COST_TABLE,
    **_parse_cost_table(os.environ.get("COST_TABLE", "")),
}


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> tuple[float, str | None]:
    """Estimated USD cost for a call, plus an optional note.

    Longest matching prefix in COST_TABLE wins; an unknown model returns
    (0.0, note) rather than a guess.
    """
    best_prefix: str | None = None
    for prefix in COST_TABLE:
        if model.startswith(prefix) and (best_prefix is None or len(prefix) > len(best_prefix)):
            best_prefix = prefix
    if best_prefix is None:
        return 0.0, f"unknown model '{model}': cost not estimated"
    usd_in, usd_out = COST_TABLE[best_prefix]
    cost = (input_tokens * usd_in + output_tokens * usd_out) / 1_000_000
    return round(cost, 8), None
