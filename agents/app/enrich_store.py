"""Enrichment cards behind a small interface, plus an in-memory twin.

Collections (real impl): 'enrichments' (doc id = str(tg_id)). Approve/reject
also merge enrichment fields into the 'people' doc (merge_person_fields) —
linkedin_url, location, current_employer, verified, and (only on explicit
user approval) company_definite / name. Only distilled + evidence data ever
lands here — never messages.
"""

from __future__ import annotations

from typing import Protocol

from . import config
from .agents.enrich import EnrichmentCard
from .schemas import DistilledPerson


class EnrichStore(Protocol):
    def upsert_card(self, card: EnrichmentCard) -> None: ...

    def get_cards(self, status: str | None = None) -> list[EnrichmentCard]: ...

    def get_card(self, tg_id: int) -> EnrichmentCard | None: ...

    def set_status(self, tg_id: int, status: str) -> EnrichmentCard | None: ...

    def merge_person_fields(self, tg_id: int, fields: dict) -> None: ...


class FirestoreEnrichStore:
    """Real Firestore implementation. Instantiated lazily so FAKE modes never
    touch GCP credentials."""

    def __init__(self, project: str | None = None) -> None:
        from google.cloud import firestore  # imported here: fake modes skip it

        self._db = firestore.Client(project=project or config.GOOGLE_CLOUD_PROJECT)
        self._cards = self._db.collection("enrichments")
        self._people = self._db.collection("people")

    def upsert_card(self, card: EnrichmentCard) -> None:
        self._cards.document(str(card.tg_id)).set(card.model_dump())

    def get_cards(self, status: str | None = None) -> list[EnrichmentCard]:
        query = self._cards
        if status is not None:
            query = query.where("status", "==", status)
        cards = [EnrichmentCard.model_validate(doc.to_dict()) for doc in query.stream()]
        cards.sort(key=lambda c: c.created_at)
        return cards

    def get_card(self, tg_id: int) -> EnrichmentCard | None:
        doc = self._cards.document(str(tg_id)).get()
        return EnrichmentCard.model_validate(doc.to_dict()) if doc.exists else None

    def set_status(self, tg_id: int, status: str) -> EnrichmentCard | None:
        card = self.get_card(tg_id)
        if card is None:
            return None
        card = card.model_copy(update={"status": status})
        self.upsert_card(card)
        return card

    def merge_person_fields(self, tg_id: int, fields: dict) -> None:
        """Merge enrichment fields into the people doc (Firestore merge-set:
        extra fields live alongside the DistilledPerson row)."""
        self._people.document(str(tg_id)).set(dict(fields), merge=True)


class InMemoryEnrichStore:
    """Test / FAKE-mode twin of FirestoreEnrichStore.

    person_fields records every merge per tg_id (the extra fields a Firestore
    people doc would carry); fields that exist on DistilledPerson (e.g.
    company_definite, name) are also applied to the in-memory people store so
    get_people() reflects them, mirroring the real merge-set."""

    def __init__(self) -> None:
        self._cards: dict[str, EnrichmentCard] = {}
        self.person_fields: dict[str, dict] = {}

    def upsert_card(self, card: EnrichmentCard) -> None:
        self._cards[str(card.tg_id)] = card

    def get_cards(self, status: str | None = None) -> list[EnrichmentCard]:
        cards = list(self._cards.values())
        if status is not None:
            cards = [c for c in cards if c.status == status]
        cards.sort(key=lambda c: c.created_at)
        return cards

    def get_card(self, tg_id: int) -> EnrichmentCard | None:
        return self._cards.get(str(tg_id))

    def set_status(self, tg_id: int, status: str) -> EnrichmentCard | None:
        card = self._cards.get(str(tg_id))
        if card is None:
            return None
        card = card.model_copy(update={"status": status})
        self._cards[str(tg_id)] = card
        return card

    def merge_person_fields(self, tg_id: int, fields: dict) -> None:
        self.person_fields.setdefault(str(tg_id), {}).update(fields)
        native = {k: v for k, v in fields.items() if k in DistilledPerson.model_fields}
        if not native:
            return
        from .store import get_store  # local import: mirrors lazy-GCP style

        people_store = get_store()
        person = next((p for p in people_store.get_people() if p.tg_id == tg_id), None)
        if person is not None:
            people_store.upsert_people([person.model_copy(update=native)])


_enrich_store: EnrichStore | None = None


def get_enrich_store() -> EnrichStore:
    """Factory: FAKE_FIRESTORE (or FAKE_LLM, unless explicitly overridden)
    selects the in-memory store; otherwise real Firestore."""
    global _enrich_store
    if _enrich_store is None:
        _enrich_store = InMemoryEnrichStore() if config.FAKE_FIRESTORE else FirestoreEnrichStore()
    return _enrich_store


def set_enrich_store(store: EnrichStore | None) -> None:
    """Test hook / dependency injection."""
    global _enrich_store
    _enrich_store = store
