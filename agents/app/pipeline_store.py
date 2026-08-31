"""Pipeline persistence behind a small interface — tenant-aware (v2).

Triad: Firestore ('users/{uid}/pipeline'), local disk, in-memory. Only
distilled data ever lands here: contact_name (real name — masked at RENDER
time by the web app), company, job refs, stage, notes, and the copy-out
draft. Never messages.

PipelineItem mirrors web/src/lib/types.ts (D3) field-for-field; the TS file
is the single source of truth.
"""

from __future__ import annotations

from typing import Literal, Protocol

from pydantic import BaseModel

from . import config, tenant

PipelineStage = Literal["lead", "outreach", "referred", "interview", "offer", "closed"]
PIPELINE_STAGES: list[str] = ["lead", "outreach", "referred", "interview", "offer", "closed"]


class PipelineItem(BaseModel):
    id: str  # uuid hex
    tg_id: int
    contact_name: str  # real name — masked only at render time by the web app
    company: str
    job_id: str | None = None
    job_title: str | None = None
    job_url: str | None = None
    stage: PipelineStage
    follow_up_date: str | None = None  # ISO date
    note: str = ""
    draft_message: str | None = None
    created_at: str
    updated_at: str


# ---- Store interface --------------------------------------------------------


class PipelineStore(Protocol):
    def create(self, item: PipelineItem) -> None: ...

    def get_all(self) -> list[PipelineItem]: ...

    def get(self, item_id: str) -> PipelineItem | None: ...

    def update(self, item_id: str, fields: dict) -> PipelineItem:
        """Merge fields into one item. Raises KeyError when absent."""
        ...

    def delete_all(self) -> None: ...


class FirestorePipelineStore:
    """Real Firestore implementation. Instantiated lazily so non-GCP modes
    never touch credentials."""

    def __init__(self, project: str | None = None) -> None:
        from google.cloud import firestore  # imported here: other modes skip it

        self._db = firestore.Client(project=project or config.GOOGLE_CLOUD_PROJECT)

    def _pipeline(self):
        return (
            self._db.collection("users")
            .document(tenant.current_uid())
            .collection("pipeline")
        )

    def create(self, item: PipelineItem) -> None:
        self._pipeline().document(item.id).set(item.model_dump())

    def get_all(self) -> list[PipelineItem]:
        items = [PipelineItem.model_validate(doc.to_dict()) for doc in self._pipeline().stream()]
        items.sort(key=lambda i: i.created_at)
        return items

    def get(self, item_id: str) -> PipelineItem | None:
        doc = self._pipeline().document(item_id).get()
        return PipelineItem.model_validate(doc.to_dict()) if doc.exists else None

    def update(self, item_id: str, fields: dict) -> PipelineItem:
        ref = self._pipeline().document(item_id)
        snapshot = ref.get()
        if not snapshot.exists:
            raise KeyError(item_id)
        merged = {**snapshot.to_dict(), **dict(fields)}
        item = PipelineItem.model_validate(merged)  # validate BEFORE writing
        ref.set(item.model_dump())
        return item

    def delete_all(self) -> None:
        from .store import firestore_wipe

        firestore_wipe(self._db, self._pipeline())


class LocalDiskPipelineStore:
    """STORE_MODE=local — JSON file per tenant dir."""

    def _path(self):
        from . import localdisk

        return localdisk.tenant_dir(tenant.current_uid()) / "pipeline.json"

    def create(self, item: PipelineItem) -> None:
        from . import localdisk

        def _apply(rows: dict) -> dict:
            rows[item.id] = item.model_dump()
            return rows

        localdisk.update_json(self._path(), {}, _apply)

    def get_all(self) -> list[PipelineItem]:
        from . import localdisk

        rows = localdisk.read_json(self._path(), {})
        items = [PipelineItem.model_validate(raw) for raw in rows.values()]
        items.sort(key=lambda i: i.created_at)
        return items

    def get(self, item_id: str) -> PipelineItem | None:
        from . import localdisk

        raw = localdisk.read_json(self._path(), {}).get(item_id)
        return PipelineItem.model_validate(raw) if raw else None

    def update(self, item_id: str, fields: dict) -> PipelineItem:
        from . import localdisk

        result: dict = {}

        def _apply(rows: dict) -> dict:
            if item_id not in rows:
                raise KeyError(item_id)
            merged = {**rows[item_id], **dict(fields)}
            item = PipelineItem.model_validate(merged)  # validate BEFORE writing
            rows[item_id] = item.model_dump()
            result.update(rows[item_id])
            return rows

        localdisk.update_json(self._path(), {}, _apply)
        return PipelineItem.model_validate(result)

    def delete_all(self) -> None:
        from . import localdisk

        localdisk.write_json(self._path(), {})


class InMemoryPipelineStore:
    """Test / FAKE-mode twin — per-tenant dicts."""

    def __init__(self) -> None:
        self._items: dict[str, dict[str, PipelineItem]] = {}

    def _items_for(self) -> dict[str, PipelineItem]:
        return self._items.setdefault(tenant.current_uid(), {})

    def create(self, item: PipelineItem) -> None:
        self._items_for()[item.id] = item

    def get_all(self) -> list[PipelineItem]:
        items = list(self._items_for().values())
        items.sort(key=lambda i: i.created_at)
        return items

    def get(self, item_id: str) -> PipelineItem | None:
        return self._items_for().get(item_id)

    def update(self, item_id: str, fields: dict) -> PipelineItem:
        items = self._items_for()
        item = items[item_id]  # KeyError when absent — contract
        updated = PipelineItem.model_validate({**item.model_dump(), **dict(fields)})
        items[item_id] = updated
        return updated

    def delete_all(self) -> None:
        self._items_for().clear()


_pipeline_store: PipelineStore | None = None


def get_pipeline_store() -> PipelineStore:
    global _pipeline_store
    if _pipeline_store is None:
        from .store import build_for_mode

        _pipeline_store = build_for_mode(
            InMemoryPipelineStore, LocalDiskPipelineStore, FirestorePipelineStore
        )
    return _pipeline_store


def set_pipeline_store(store: PipelineStore | None) -> None:
    """Test hook / dependency injection."""
    global _pipeline_store
    _pipeline_store = store
