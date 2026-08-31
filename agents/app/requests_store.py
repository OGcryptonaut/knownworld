"""Requests persistence behind a small interface — tenant-aware (v2).

Triad: Firestore ('users/{uid}/requests'), local disk, in-memory. A request
doc stores the query, the planner's parsed intent, execution status, and a
result SNAPSHOT (postings / people matches at execution time) — re-running
the same query later legitimately yields different results.
"""

from __future__ import annotations

from typing import Literal, Protocol

from pydantic import BaseModel

from . import tenant
from .jobs_store import JobPosting


class RequestPeopleMatch(BaseModel):
    tg_id: int
    name: str  # real name — masked only at render time by the web app
    company: str | None = None
    role_guess: str | None = None
    closeness: float
    reason: str


class RequestResult(BaseModel):
    kind: Literal["jobs", "people", "intro"]
    postings: list[JobPosting] = []
    matches: list[RequestPeopleMatch] = []
    # intro intent: the drafted message (copy-out only — the app never sends
    # anything) and who it is addressed to
    message: str | None = None
    intro_to: RequestPeopleMatch | None = None
    stats: dict = {}


class UserRequest(BaseModel):
    id: str  # uuid hex
    query: str
    intent: Literal["jobs", "people"] | None = None
    note: str | None = None  # planner's one-line interpretation
    params: dict = {}
    status: Literal["running", "done", "rejected", "error"]
    error: str | None = None
    rejected_reasons: list[str] = []
    result: RequestResult | None = None
    created_at: str
    finished_at: str | None = None
    # conversation grouping: follow-ups share the first request's id here.
    # None (older docs) means "its own thread".
    thread_id: str | None = None


class RequestsStore(Protocol):
    def upsert(self, request: UserRequest) -> None: ...

    def get_all(self) -> list[UserRequest]: ...

    def get(self, request_id: str) -> UserRequest | None: ...

    def delete_all(self) -> None: ...


class FirestoreRequestsStore:
    def __init__(self, project: str | None = None) -> None:
        from google.cloud import firestore

        from . import config

        self._db = firestore.Client(project=project or config.GOOGLE_CLOUD_PROJECT)

    def _requests(self):
        return (
            self._db.collection("users")
            .document(tenant.current_uid())
            .collection("requests")
        )

    def upsert(self, request: UserRequest) -> None:
        self._requests().document(request.id).set(request.model_dump())

    def get_all(self) -> list[UserRequest]:
        items = [UserRequest.model_validate(doc.to_dict()) for doc in self._requests().stream()]
        items.sort(key=lambda r: r.created_at, reverse=True)
        return items

    def get(self, request_id: str) -> UserRequest | None:
        doc = self._requests().document(request_id).get()
        return UserRequest.model_validate(doc.to_dict()) if doc.exists else None

    def delete_all(self) -> None:
        from .store import firestore_wipe

        firestore_wipe(self._db, self._requests())


class LocalDiskRequestsStore:
    def _path(self):
        from . import localdisk

        return localdisk.tenant_dir(tenant.current_uid()) / "requests.json"

    def upsert(self, request: UserRequest) -> None:
        from . import localdisk

        def _apply(rows: dict) -> dict:
            rows[request.id] = request.model_dump()
            return rows

        localdisk.update_json(self._path(), {}, _apply)

    def get_all(self) -> list[UserRequest]:
        from . import localdisk

        rows = localdisk.read_json(self._path(), {})
        items = [UserRequest.model_validate(raw) for raw in rows.values()]
        items.sort(key=lambda r: r.created_at, reverse=True)
        return items

    def get(self, request_id: str) -> UserRequest | None:
        from . import localdisk

        raw = localdisk.read_json(self._path(), {}).get(request_id)
        return UserRequest.model_validate(raw) if raw else None

    def delete_all(self) -> None:
        from . import localdisk

        localdisk.write_json(self._path(), {})


class InMemoryRequestsStore:
    def __init__(self) -> None:
        self._items: dict[str, dict[str, UserRequest]] = {}

    def _items_for(self) -> dict[str, UserRequest]:
        return self._items.setdefault(tenant.current_uid(), {})

    def upsert(self, request: UserRequest) -> None:
        self._items_for()[request.id] = request

    def get_all(self) -> list[UserRequest]:
        items = list(self._items_for().values())
        items.sort(key=lambda r: r.created_at, reverse=True)
        return items

    def get(self, request_id: str) -> UserRequest | None:
        return self._items_for().get(request_id)

    def delete_all(self) -> None:
        self._items_for().clear()


_requests_store: RequestsStore | None = None


def get_requests_store() -> RequestsStore:
    global _requests_store
    if _requests_store is None:
        from .store import build_for_mode

        _requests_store = build_for_mode(
            InMemoryRequestsStore, LocalDiskRequestsStore, FirestoreRequestsStore
        )
    return _requests_store


def set_requests_store(store: RequestsStore | None) -> None:
    """Test hook / dependency injection."""
    global _requests_store
    _requests_store = store
