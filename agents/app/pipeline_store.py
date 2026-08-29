"""Pipeline persistence behind a small interface, plus an in-memory twin.

Collections (real impl): 'pipeline' (doc id = PipelineItem.id, a uuid hex —
minted by the router at create time). Only distilled data ever lands here:
contact_name (real name — masked at RENDER time by the web app), company,
job refs, stage, notes, and the copy-out draft. Never messages.

PipelineItem mirrors web/src/lib/types.ts (D3) field-for-field; the TS file
is the single source of truth.
"""

from __future__ import annotations

from typing import Literal, Protocol

from pydantic import BaseModel

from . import config

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


class FirestorePipelineStore:
    """Real Firestore implementation. Instantiated lazily so FAKE modes never
    touch GCP credentials."""

    def __init__(self, project: str | None = None) -> None:
        from google.cloud import firestore  # imported here: fake modes skip it

        self._db = firestore.Client(project=project or config.GOOGLE_CLOUD_PROJECT)
        self._pipeline = self._db.collection("pipeline")

    def create(self, item: PipelineItem) -> None:
        self._pipeline.document(item.id).set(item.model_dump())

    def get_all(self) -> list[PipelineItem]:
        items = [PipelineItem.model_validate(doc.to_dict()) for doc in self._pipeline.stream()]
        items.sort(key=lambda i: i.created_at)
        return items

    def get(self, item_id: str) -> PipelineItem | None:
        doc = self._pipeline.document(item_id).get()
        return PipelineItem.model_validate(doc.to_dict()) if doc.exists else None

    def update(self, item_id: str, fields: dict) -> PipelineItem:
        ref = self._pipeline.document(item_id)
        snapshot = ref.get()
        if not snapshot.exists:
            raise KeyError(item_id)
        merged = {**snapshot.to_dict(), **dict(fields)}
        item = PipelineItem.model_validate(merged)  # validate BEFORE writing
        ref.set(item.model_dump())
        return item


class InMemoryPipelineStore:
    """Test / FAKE-mode twin of FirestorePipelineStore."""

    def __init__(self) -> None:
        self._items: dict[str, PipelineItem] = {}

    def create(self, item: PipelineItem) -> None:
        self._items[item.id] = item

    def get_all(self) -> list[PipelineItem]:
        items = list(self._items.values())
        items.sort(key=lambda i: i.created_at)
        return items

    def get(self, item_id: str) -> PipelineItem | None:
        return self._items.get(item_id)

    def update(self, item_id: str, fields: dict) -> PipelineItem:
        item = self._items[item_id]  # KeyError when absent — contract
        updated = PipelineItem.model_validate({**item.model_dump(), **dict(fields)})
        self._items[item_id] = updated
        return updated


_pipeline_store: PipelineStore | None = None


def get_pipeline_store() -> PipelineStore:
    """Factory: FAKE_FIRESTORE (or FAKE_LLM, unless explicitly overridden)
    selects the in-memory store; otherwise real Firestore."""
    global _pipeline_store
    if _pipeline_store is None:
        _pipeline_store = (
            InMemoryPipelineStore() if config.FAKE_FIRESTORE else FirestorePipelineStore()
        )
    return _pipeline_store


def set_pipeline_store(store: PipelineStore | None) -> None:
    """Test hook / dependency injection."""
    global _pipeline_store
    _pipeline_store = store
