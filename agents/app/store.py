"""People/activity persistence behind a small interface — tenant-aware (v2).

Triad: FirestoreStore ('users/{uid}/people', 'users/{uid}/activity_log'),
LocalDiskStore (JSON per tenant dir; STORE_MODE=local dev without GCP), and
InMemoryStore (tests / FAKE modes). The current tenant comes from
tenant.current_uid() per call — method signatures are unchanged from v1, so
routers and tests are untouched; outside a request the '_default' tenant
applies (old single-tenant behavior).

Only distilled rows and telemetry ever land here — never messages.
"""

from __future__ import annotations

from typing import Protocol

from . import config, tenant
from .schemas import ActivityEntry, DistilledPerson


class Store(Protocol):
    def upsert_people(self, people: list[DistilledPerson]) -> None: ...

    def log_activity(self, entry: ActivityEntry) -> None: ...

    def get_people(self) -> list[DistilledPerson]: ...

    def get_activity(self, run_id: str | None = None) -> list[ActivityEntry]: ...

    def delete_all(self) -> None: ...


class FirestoreStore:
    """Real Firestore implementation. Instantiated lazily so non-GCP modes
    never touch credentials. All collections are scoped under the tenant's
    'users/{uid}' document."""

    def __init__(self, project: str | None = None) -> None:
        from google.cloud import firestore  # imported here: other modes skip it

        self._db = firestore.Client(project=project or config.GOOGLE_CLOUD_PROJECT)

    def _tenant(self):
        return self._db.collection("users").document(tenant.current_uid())

    def _people(self):
        return self._tenant().collection("people")

    def _activity(self):
        return self._tenant().collection("activity_log")

    def upsert_people(self, people: list[DistilledPerson]) -> None:
        batch = self._db.batch()
        collection = self._people()
        for person in people:
            batch.set(collection.document(str(person.tg_id)), person.model_dump())
        batch.commit()

    def log_activity(self, entry: ActivityEntry) -> None:
        self._activity().add(entry.model_dump())

    def get_people(self) -> list[DistilledPerson]:
        return [DistilledPerson.model_validate(doc.to_dict()) for doc in self._people().stream()]

    def get_activity(self, run_id: str | None = None) -> list[ActivityEntry]:
        query = self._activity()
        if run_id is not None:
            query = query.where("run_id", "==", run_id)
        entries = [ActivityEntry.model_validate(doc.to_dict()) for doc in query.stream()]
        entries.sort(key=lambda e: e.ts)
        return entries

    def delete_all(self) -> None:
        for collection in (self._people(), self._activity()):
            for doc in collection.stream():
                doc.reference.delete()


class LocalDiskStore:
    """STORE_MODE=local — JSON files per tenant dir, no GCP anywhere."""

    def _paths(self):
        from . import localdisk

        base = localdisk.tenant_dir(tenant.current_uid())
        return base / "people.json", base / "activity.json"

    def upsert_people(self, people: list[DistilledPerson]) -> None:
        from . import localdisk

        people_path, _ = self._paths()

        def _apply(rows: dict) -> dict:
            for person in people:
                rows[str(person.tg_id)] = person.model_dump()
            return rows

        localdisk.update_json(people_path, {}, _apply)

    def log_activity(self, entry: ActivityEntry) -> None:
        from . import localdisk

        _, activity_path = self._paths()
        localdisk.update_json(activity_path, [], lambda rows: rows + [entry.model_dump()])

    def get_people(self) -> list[DistilledPerson]:
        from . import localdisk

        people_path, _ = self._paths()
        rows = localdisk.read_json(people_path, {})
        return [DistilledPerson.model_validate(raw) for raw in rows.values()]

    def get_activity(self, run_id: str | None = None) -> list[ActivityEntry]:
        from . import localdisk

        _, activity_path = self._paths()
        entries = [
            ActivityEntry.model_validate(raw)
            for raw in localdisk.read_json(activity_path, [])
        ]
        if run_id is not None:
            entries = [e for e in entries if e.run_id == run_id]
        entries.sort(key=lambda e: e.ts)
        return entries

    def delete_all(self) -> None:
        from . import localdisk

        people_path, activity_path = self._paths()
        localdisk.write_json(people_path, {})
        localdisk.write_json(activity_path, [])


class InMemoryStore:
    """Test / FAKE-mode twin — per-tenant dicts in process memory."""

    def __init__(self) -> None:
        self._people: dict[str, dict[str, DistilledPerson]] = {}
        self._activity: dict[str, list[ActivityEntry]] = {}

    def _people_for(self) -> dict[str, DistilledPerson]:
        return self._people.setdefault(tenant.current_uid(), {})

    def _activity_for(self) -> list[ActivityEntry]:
        return self._activity.setdefault(tenant.current_uid(), [])

    def upsert_people(self, people: list[DistilledPerson]) -> None:
        rows = self._people_for()
        for person in people:
            rows[str(person.tg_id)] = person

    def log_activity(self, entry: ActivityEntry) -> None:
        self._activity_for().append(entry)

    def get_people(self) -> list[DistilledPerson]:
        return list(self._people_for().values())

    def get_activity(self, run_id: str | None = None) -> list[ActivityEntry]:
        entries = self._activity_for()
        if run_id is None:
            return list(entries)
        return [e for e in entries if e.run_id == run_id]

    def delete_all(self) -> None:
        self._people_for().clear()
        self._activity_for().clear()


_store: Store | None = None


def build_for_mode(memory_cls, local_cls, firestore_cls):
    """Shared factory logic for every store triad in the service."""
    mode = config.STORE_MODE
    if mode == "memory":
        return memory_cls()
    if mode == "local":
        return local_cls()
    return firestore_cls()


def get_store() -> Store:
    global _store
    if _store is None:
        _store = build_for_mode(InMemoryStore, LocalDiskStore, FirestoreStore)
    return _store


def set_store(store: Store | None) -> None:
    """Test hook / dependency injection."""
    global _store
    _store = store
