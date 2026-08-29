"""Job-scout persistence behind a small interface, plus an in-memory twin.

Collections (real impl): 'jobs' (doc id = posting id), 'ats_slugs' (doc id =
normalized company name), 'job_runs' (doc id = run_id). Only company names,
verified slugs, public postings, and contact refs (tg_id/name/closeness —
masked at RENDER time by the web app) ever land here.

Pydantic models mirror web/src/lib/types.ts (D2 job scout types)
field-for-field; the TS file is the single source of truth.
"""

from __future__ import annotations

from typing import Literal, Protocol

from pydantic import BaseModel

from . import config

AtsSource = Literal["greenhouse", "lever", "ashby", "workable", "smartrecruiters"]

_FIRESTORE_BATCH_LIMIT = 450  # under the 500-op hard limit


# ---- Contract models (mirror web/src/lib/types.ts) --------------------------

class RoleFitProfile(BaseModel):
    targetRoles: list[str] = []
    industries: list[str] = []
    seniority: list[str] = []
    location: str = ""


class JobContactRef(BaseModel):
    tg_id: int
    name: str  # real name — masked only at render time by the web app
    closeness: float


class JobPosting(BaseModel):
    id: str  # '{source}:{slug}:{job_id}'
    company: str
    slug: str
    source: AtsSource
    title: str
    location: str | None = None
    url: str
    role_fit: bool
    fit_reasons: list[str]
    posted_at: str | None = None
    fetched_at: str
    contacts: list[JobContactRef]  # ranked by closeness desc


class JobsRunSummary(BaseModel):
    run_id: str
    companies_total: int
    companies_with_slug: int
    postings_total: int
    postings_fit: int
    started_at: str
    status: str  # 'running' | 'done' | 'error'


class AtsSlugRecord(BaseModel):
    """One live-verified company -> ATS feed mapping ('ats_slugs' doc)."""

    company: str  # display name as first seen
    slug: str
    source: AtsSource
    verified_at: str


# ---- Store interface --------------------------------------------------------

class JobsStore(Protocol):
    def upsert_slug(self, normalized: str, record: AtsSlugRecord) -> None: ...

    def get_slugs(self) -> dict[str, AtsSlugRecord]: ...

    def upsert_postings(self, postings: list[JobPosting]) -> None: ...

    def get_postings(self, fit_only: bool = False) -> list[JobPosting]: ...

    def save_run(self, summary: JobsRunSummary, no_feed: list[str] | None = None) -> None: ...

    def get_latest_run(self) -> JobsRunSummary | None: ...


class FirestoreJobsStore:
    """Real Firestore implementation. Instantiated lazily so FAKE modes never
    touch GCP credentials."""

    def __init__(self, project: str | None = None) -> None:
        from google.cloud import firestore  # imported here: fake modes skip it

        self._db = firestore.Client(project=project or config.GOOGLE_CLOUD_PROJECT)
        self._jobs = self._db.collection("jobs")
        self._slugs = self._db.collection("ats_slugs")
        self._runs = self._db.collection("job_runs")

    def upsert_slug(self, normalized: str, record: AtsSlugRecord) -> None:
        self._slugs.document(normalized).set(record.model_dump())

    def get_slugs(self) -> dict[str, AtsSlugRecord]:
        out: dict[str, AtsSlugRecord] = {}
        for doc in self._slugs.stream():
            try:
                out[doc.id] = AtsSlugRecord.model_validate(doc.to_dict())
            except ValueError:
                continue
        return out

    def upsert_postings(self, postings: list[JobPosting]) -> None:
        for start in range(0, len(postings), _FIRESTORE_BATCH_LIMIT):
            batch = self._db.batch()
            for posting in postings[start : start + _FIRESTORE_BATCH_LIMIT]:
                batch.set(self._jobs.document(posting.id), posting.model_dump())
            batch.commit()

    def get_postings(self, fit_only: bool = False) -> list[JobPosting]:
        postings = [JobPosting.model_validate(doc.to_dict()) for doc in self._jobs.stream()]
        if fit_only:
            postings = [p for p in postings if p.role_fit]
        postings.sort(key=lambda p: (p.company.lower(), p.title.lower()))
        return postings

    def save_run(self, summary: JobsRunSummary, no_feed: list[str] | None = None) -> None:
        doc = summary.model_dump()
        doc["no_feed"] = no_feed or []
        self._runs.document(summary.run_id).set(doc)

    def get_latest_run(self) -> JobsRunSummary | None:
        latest: JobsRunSummary | None = None
        for doc in self._runs.stream():
            try:
                summary = JobsRunSummary.model_validate(doc.to_dict())
            except ValueError:
                continue
            if latest is None or summary.started_at > latest.started_at:
                latest = summary
        return latest


class InMemoryJobsStore:
    """Test / FAKE-mode twin of FirestoreJobsStore."""

    def __init__(self) -> None:
        self._slugs: dict[str, AtsSlugRecord] = {}
        self._postings: dict[str, JobPosting] = {}
        self._runs: dict[str, dict] = {}

    def upsert_slug(self, normalized: str, record: AtsSlugRecord) -> None:
        self._slugs[normalized] = record

    def get_slugs(self) -> dict[str, AtsSlugRecord]:
        return dict(self._slugs)

    def upsert_postings(self, postings: list[JobPosting]) -> None:
        for posting in postings:
            self._postings[posting.id] = posting

    def get_postings(self, fit_only: bool = False) -> list[JobPosting]:
        postings = list(self._postings.values())
        if fit_only:
            postings = [p for p in postings if p.role_fit]
        postings.sort(key=lambda p: (p.company.lower(), p.title.lower()))
        return postings

    def save_run(self, summary: JobsRunSummary, no_feed: list[str] | None = None) -> None:
        doc = summary.model_dump()
        doc["no_feed"] = no_feed or []
        self._runs[summary.run_id] = doc

    def get_latest_run(self) -> JobsRunSummary | None:
        latest: JobsRunSummary | None = None
        for doc in self._runs.values():
            summary = JobsRunSummary.model_validate({k: v for k, v in doc.items() if k != "no_feed"})
            if latest is None or summary.started_at > latest.started_at:
                latest = summary
        return latest


_jobs_store: JobsStore | None = None


def get_jobs_store() -> JobsStore:
    """Factory: FAKE_FIRESTORE (or FAKE_LLM, unless explicitly overridden)
    selects the in-memory store; otherwise real Firestore."""
    global _jobs_store
    if _jobs_store is None:
        _jobs_store = InMemoryJobsStore() if config.FAKE_FIRESTORE else FirestoreJobsStore()
    return _jobs_store


def set_jobs_store(store: JobsStore | None) -> None:
    """Test hook / dependency injection."""
    global _jobs_store
    _jobs_store = store
