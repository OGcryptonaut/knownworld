"""Enrichment cards behind a small interface — tenant-aware (v2).

Triad: Firestore ('users/{uid}/enrichments'), local disk, in-memory. The
tenant comes from tenant.current_uid() per call. Enrichment passes and owner
corrections merge evidence fields into the tenant's people rows via
merge_person_fields — linkedin_url, location, current_employer, verified,
and (match-verdict or owner statement only) company_definite / name. Only
distilled + evidence data ever lands here — never messages.
"""

from __future__ import annotations

from typing import Protocol

from . import config, tenant
from .agents.enrich import EnrichmentCard
from .schemas import DistilledPerson


class EnrichStore(Protocol):
    def upsert_card(self, card: EnrichmentCard) -> None: ...

    def get_cards(self, status: str | None = None) -> list[EnrichmentCard]: ...

    def get_card(self, tg_id: int) -> EnrichmentCard | None: ...

    def merge_person_fields(self, tg_id: int, fields: dict) -> None: ...

    def delete_all(self) -> None: ...


def _sorted_cards(cards: list[EnrichmentCard], status: str | None) -> list[EnrichmentCard]:
    if status is not None:
        cards = [c for c in cards if c.status == status]
    cards.sort(key=lambda c: c.created_at)
    return cards


class FirestoreEnrichStore:
    """Real Firestore implementation. Instantiated lazily so non-GCP modes
    never touch credentials."""

    def __init__(self, project: str | None = None) -> None:
        from google.cloud import firestore  # imported here: other modes skip it

        self._db = firestore.Client(project=project or config.GOOGLE_CLOUD_PROJECT)

    def _tenant(self):
        return self._db.collection("users").document(tenant.current_uid())

    def _cards(self):
        return self._tenant().collection("enrichments")

    def upsert_card(self, card: EnrichmentCard) -> None:
        self._cards().document(str(card.tg_id)).set(card.model_dump())

    def get_cards(self, status: str | None = None) -> list[EnrichmentCard]:
        cards = [EnrichmentCard.model_validate(doc.to_dict()) for doc in self._cards().stream()]
        return _sorted_cards(cards, status)

    def get_card(self, tg_id: int) -> EnrichmentCard | None:
        doc = self._cards().document(str(tg_id)).get()
        return EnrichmentCard.model_validate(doc.to_dict()) if doc.exists else None

    def merge_person_fields(self, tg_id: int, fields: dict) -> None:
        """Merge enrichment fields into the tenant's people doc (merge-set:
        extra fields live alongside the DistilledPerson row)."""
        self._tenant().collection("people").document(str(tg_id)).set(dict(fields), merge=True)

    def delete_all(self) -> None:
        from .store import firestore_wipe

        firestore_wipe(self._db, self._cards())


class LocalDiskEnrichStore:
    """STORE_MODE=local — JSON files per tenant dir."""

    def _path(self):
        from . import localdisk

        return localdisk.tenant_dir(tenant.current_uid()) / "enrich_cards.json"

    def _person_fields_path(self):
        from . import localdisk

        return localdisk.tenant_dir(tenant.current_uid()) / "person_fields.json"

    def upsert_card(self, card: EnrichmentCard) -> None:
        from . import localdisk

        def _apply(cards: dict) -> dict:
            cards[str(card.tg_id)] = card.model_dump()
            return cards

        localdisk.update_json(self._path(), {}, _apply)

    def get_cards(self, status: str | None = None) -> list[EnrichmentCard]:
        from . import localdisk

        raw = localdisk.read_json(self._path(), {})
        return _sorted_cards([EnrichmentCard.model_validate(v) for v in raw.values()], status)

    def get_card(self, tg_id: int) -> EnrichmentCard | None:
        from . import localdisk

        raw = localdisk.read_json(self._path(), {}).get(str(tg_id))
        return EnrichmentCard.model_validate(raw) if raw else None

    def merge_person_fields(self, tg_id: int, fields: dict) -> None:
        from . import localdisk

        # extra (non-native) fields recorded alongside, mirroring Firestore merge-set
        def _apply(store: dict) -> dict:
            store.setdefault(str(tg_id), {}).update(fields)
            return store

        localdisk.update_json(self._person_fields_path(), {}, _apply)
        _apply_native_fields(tg_id, fields)

    def delete_all(self) -> None:
        from . import localdisk

        localdisk.write_json(self._path(), {})
        localdisk.write_json(self._person_fields_path(), {})


class InMemoryEnrichStore:
    """Test / FAKE-mode twin — per-tenant dicts.

    person_fields records every merge per tg_id (the extra fields a Firestore
    people doc would carry); fields that exist on DistilledPerson (e.g.
    company_definite, name) are also applied to the people store so
    get_people() reflects them, mirroring the real merge-set."""

    def __init__(self) -> None:
        self._cards: dict[str, dict[str, EnrichmentCard]] = {}
        self._person_fields: dict[str, dict[str, dict]] = {}

    @property
    def person_fields(self) -> dict[str, dict]:
        return self._person_fields.setdefault(tenant.current_uid(), {})

    def _cards_for(self) -> dict[str, EnrichmentCard]:
        return self._cards.setdefault(tenant.current_uid(), {})

    def upsert_card(self, card: EnrichmentCard) -> None:
        self._cards_for()[str(card.tg_id)] = card

    def get_cards(self, status: str | None = None) -> list[EnrichmentCard]:
        return _sorted_cards(list(self._cards_for().values()), status)

    def get_card(self, tg_id: int) -> EnrichmentCard | None:
        return self._cards_for().get(str(tg_id))

    def merge_person_fields(self, tg_id: int, fields: dict) -> None:
        self.person_fields.setdefault(str(tg_id), {}).update(fields)
        _apply_native_fields(tg_id, fields)

    def delete_all(self) -> None:
        self._cards_for().clear()
        self.person_fields.clear()


def _apply_native_fields(tg_id: int, fields: dict) -> None:
    """Apply DistilledPerson-native fields to the people store so
    get_people() reflects them (mirrors the Firestore merge-set)."""
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
    global _enrich_store
    if _enrich_store is None:
        from .store import build_for_mode

        _enrich_store = build_for_mode(
            InMemoryEnrichStore, LocalDiskEnrichStore, FirestoreEnrichStore
        )
    return _enrich_store


def set_enrich_store(store: EnrichStore | None) -> None:
    """Test hook / dependency injection."""
    global _enrich_store
    _enrich_store = store
