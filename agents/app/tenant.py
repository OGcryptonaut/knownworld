"""Per-request tenant context (v2 multi-tenancy).

The uid is set once per request by the tenant middleware in main.py and read
by every store implementation, so store method signatures (and the routers
and tests calling them) stay unchanged. Outside a request (tests, scripts)
the default tenant '_default' applies — equivalent to the old single-tenant
behavior.
"""

from __future__ import annotations

from contextvars import ContextVar

DEFAULT_UID = "_default"

_current_uid: ContextVar[str] = ContextVar("knownworld_uid", default=DEFAULT_UID)


def current_uid() -> str:
    return _current_uid.get()


def set_uid(uid: str):
    """Returns the reset token (used by middleware to restore after request)."""
    return _current_uid.set(uid)


def reset_uid(token) -> None:
    _current_uid.reset(token)
