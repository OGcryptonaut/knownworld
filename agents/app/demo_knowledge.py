"""Demo-knowledge sidecar for FAKE mode (see sample-data/generate.py).

When the ingested contacts come from the demo dataset (real public figures,
openly fictional conversations), the deterministic FAKE agents consult this
file so the no-credentials demo still produces REAL answers: actual
companies, cities, public links — and the job scout then hits those
companies' live verified feeds. Unknown contacts fall back to the plain
canned behavior, so tests and arbitrary imports are unaffected.

This data never reaches any model — FAKE mode makes no network calls.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

_DEFAULT_PATH = Path(__file__).resolve().parents[2] / "sample-data" / "demo-knowledge.json"

_cache: dict | None = None
_cache_path: str | None = None


def _load() -> dict:
    global _cache, _cache_path
    path = os.environ.get("DEMO_KNOWLEDGE_FILE") or str(_DEFAULT_PATH)
    if _cache is not None and _cache_path == path:
        return _cache
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        people = raw.get("people", {})
    except (OSError, ValueError):
        people = {}
    _cache = people if isinstance(people, dict) else {}
    _cache_path = path
    return _cache


def by_tg_id(tg_id: int | str) -> dict | None:
    return _load().get(str(tg_id))


def by_name(name: str) -> dict | None:
    wanted = (name or "").strip().lower()
    if not wanted:
        return None
    for entry in _load().values():
        if entry.get("name", "").strip().lower() == wanted:
            return entry
    return None
