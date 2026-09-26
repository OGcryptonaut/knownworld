"""Demo-knowledge sidecar (see sample-data/generate.py).

When the ingested contacts come from the demo dataset (WHOLLY FICTIONAL
people at real companies, invented conversations), the deterministic FAKE
agents consult this file so the no-credentials demo still produces coherent
answers — companies, cities, company pages — and the job scout then hits
those companies' live verified feeds. With a real model, the research step
also resolves demo contacts from here (`demo_entry`, labelled
'demo-sidecar:' in telemetry) because fictional people have no public
footprint to search. Unknown contacts fall back to the plain canned / live
behavior, so tests and arbitrary imports are unaffected.

This data never reaches any model.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

_DEFAULT_PATH = Path(__file__).resolve().parents[2] / "sample-data" / "demo-knowledge.json"

# Reserved tg_id block for the demo personas: sample-data/generate.py places
# every demo contact at 100000000 + n. The demo-sidecar research path answers
# from this file ONLY for ids inside this range whose stored name equals the
# sidecar entry's name — a real tenant's contact can never be resolved from
# demo data unless it carries both the reserved id and the invented name.
DEMO_TG_ID_RANGE: tuple[int, int] = (100000001, 100000099)

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


def demo_entry(tg_id: int | str | None, name: str | None) -> dict | None:
    """The sidecar entry for a DEMO contact, or None. Both guards apply: the
    id must sit in DEMO_TG_ID_RANGE and the name must match the entry
    (case-insensitive; blank matches blank for the handle-only contacts)."""
    try:
        tid = int(tg_id)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    low, high = DEMO_TG_ID_RANGE
    if not low <= tid <= high:
        return None
    entry = by_tg_id(tid)
    if entry is None:
        return None
    if (entry.get("name") or "").strip().lower() != (name or "").strip().lower():
        return None
    return entry
