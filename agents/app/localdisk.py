"""JSON-on-disk persistence for STORE_MODE=local (v2).

One directory per tenant under LOCAL_STORE_DIR (gitignored), one JSON file
per logical collection. Writes are atomic (tmp file + os.replace) behind a
process-wide lock — good enough for the single-process local dev server, and
the interface mirrors what Firestore gives us so switching to GCP is purely
an env change (STORE_MODE=firestore).
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

from . import config

_lock = threading.RLock()


def tenant_dir(uid: str) -> Path:
    root = Path(config.LOCAL_STORE_DIR)
    safe = "".join(c for c in uid if c.isalnum() or c in "-_") or "_default"
    path = root / safe
    path.mkdir(parents=True, exist_ok=True)
    return path


def root_dir() -> Path:
    root = Path(config.LOCAL_STORE_DIR)
    root.mkdir(parents=True, exist_ok=True)
    return root


def read_json(path: Path, default):
    with _lock:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            return default


def write_json(path: Path, value) -> None:
    with _lock:
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(value, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, path)


def update_json(path: Path, default, fn):
    """Read-modify-write under the lock; fn mutates and returns the value."""
    with _lock:
        value = read_json(path, default)
        value = fn(value)
        write_json(path, value)
        return value
