"""Firestore access behind a small interface, plus an in-memory twin.

Collections (real impl): 'people' (doc id = str(tg_id)), 'activity_log',
'runs'. Only distilled rows and telemetry ever land here — never messages.
"""

from __future__ import annotations

from typing import Protocol

from . import config
from .schemas import ActivityEntry, DistilledPerson


class Store(Protocol):
    def upsert_people(self, people: list[DistilledPerson]) -> None: ...

    def log_activity(self, entry: ActivityEntry) -> None: ...

    def get_people(self) -> list[DistilledPerson]: ...

    def get_activity(self, run_id: str | None = None) -> list[ActivityEntry]: ...

    def delete_all(self) -> None: ...


class FirestoreStore:
    """Real Firestore implementation. Instantiated lazily so FAKE modes never
    touch GCP credentials."""

    def __init__(self, project: str | None = None) -> None:
        from google.cloud import firestore  # imported here: fake modes skip it

        self._db = firestore.Client(project=project or config.GOOGLE_CLOUD_PROJECT)
        self._people = self._db.collection("people")
        self._activity = self._db.collection("activity_log")
        self._runs = self._db.collection("runs")

    def upsert_people(self, people: list[DistilledPerson]) -> None:
        batch = self._db.batch()
        for person in people:
            ref = self._people.document(str(person.tg_id))
            batch.set(ref, person.model_dump())
        batch.commit()

    def log_activity(self, entry: ActivityEntry) -> None:
        self._activity.add(entry.model_dump())

    def get_people(self) -> list[DistilledPerson]:
        return [DistilledPerson.model_validate(doc.to_dict()) for doc in self._people.stream()]

    def get_activity(self, run_id: str | None = None) -> list[ActivityEntry]:
        query = self._activity
        if run_id is not None:
            query = query.where("run_id", "==", run_id)
        entries = [ActivityEntry.model_validate(doc.to_dict()) for doc in query.stream()]
        entries.sort(key=lambda e: e.ts)
        return entries

    def delete_all(self) -> None:
        for collection in (self._people, self._activity, self._runs):
            for doc in collection.stream():
                doc.reference.delete()


class InMemoryStore:
    """Test / FAKE-mode twin of FirestoreStore."""

    def __init__(self) -> None:
        self._people: dict[str, DistilledPerson] = {}
        self._activity: list[ActivityEntry] = []

    def upsert_people(self, people: list[DistilledPerson]) -> None:
        for person in people:
            self._people[str(person.tg_id)] = person

    def log_activity(self, entry: ActivityEntry) -> None:
        self._activity.append(entry)

    def get_people(self) -> list[DistilledPerson]:
        return list(self._people.values())

    def get_activity(self, run_id: str | None = None) -> list[ActivityEntry]:
        if run_id is None:
            return list(self._activity)
        return [e for e in self._activity if e.run_id == run_id]

    def delete_all(self) -> None:
        self._people.clear()
        self._activity.clear()


_store: Store | None = None


def get_store() -> Store:
    """Factory: FAKE_FIRESTORE (or FAKE_LLM, unless explicitly overridden)
    selects the in-memory store; otherwise real Firestore."""
    global _store
    if _store is None:
        _store = InMemoryStore() if config.FAKE_FIRESTORE else FirestoreStore()
    return _store


def set_store(store: Store | None) -> None:
    """Test hook / dependency injection."""
    global _store
    _store = store
