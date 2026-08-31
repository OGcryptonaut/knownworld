"""Job-scout persistence behind a small interface — tenant-aware (v2).

Postings and runs are TENANT-scoped ('users/{uid}/jobs', 'users/{uid}/job_runs'):
they embed contact refs. Verified ATS slugs stay GLOBAL ('ats_slugs' root
collection / shared file): a company->feed mapping is public knowledge with
no personal data, and sharing the cache saves probing across tenants.

Pydantic models mirror web/src/lib/types.ts (D2 job scout types)
field-for-field; the TS file is the single source of truth.
"""

from __future__ import annotations

from typing import Literal, Protocol

from pydantic import BaseModel

from . import config, tenant

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

    def delete_all(self) -> None:
        """Wipe the TENANT's postings and runs. Global slugs stay — they are
        public company->feed knowledge with no personal data."""
        ...


def _sorted_postings(postings: list[JobPosting], fit_only: bool) -> list[JobPosting]:
    if fit_only:
        postings = [p for p in postings if p.role_fit]
    postings.sort(key=lambda p: (p.company.lower(), p.title.lower()))
    return postings


def _latest(summaries: list[JobsRunSummary]) -> JobsRunSummary | None:
    latest: JobsRunSummary | None = None
    for summary in summaries:
        if latest is None or summary.started_at > latest.started_at:
            latest = summary
    return latest


class FirestoreJobsStore:
    """Real Firestore implementation. Instantiated lazily so non-GCP modes
    never touch credentials."""

    def __init__(self, project: str | None = None) -> None:
        from google.cloud import firestore  # imported here: other modes skip it

        self._db = firestore.Client(project=project or config.GOOGLE_CLOUD_PROJECT)
        self._slugs = self._db.collection("ats_slugs")  # global, cross-tenant

    def _tenant(self):
        return self._db.collection("users").document(tenant.current_uid())

    def _jobs(self):
        return self._tenant().collection("jobs")

    def _runs(self):
        return self._tenant().collection("job_runs")

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
        jobs = self._jobs()
        for start in range(0, len(postings), _FIRESTORE_BATCH_LIMIT):
            batch = self._db.batch()
            for posting in postings[start : start + _FIRESTORE_BATCH_LIMIT]:
                batch.set(jobs.document(posting.id), posting.model_dump())
            batch.commit()

    def get_postings(self, fit_only: bool = False) -> list[JobPosting]:
        postings = [JobPosting.model_validate(doc.to_dict()) for doc in self._jobs().stream()]
        return _sorted_postings(postings, fit_only)

    def save_run(self, summary: JobsRunSummary, no_feed: list[str] | None = None) -> None:
        doc = summary.model_dump()
        doc["no_feed"] = no_feed or []
        self._runs().document(summary.run_id).set(doc)

    def get_latest_run(self) -> JobsRunSummary | None:
        summaries = []
        for doc in self._runs().stream():
            try:
                summaries.append(JobsRunSummary.model_validate(doc.to_dict()))
            except ValueError:
                continue
        return _latest(summaries)

    def delete_all(self) -> None:
        from .store import firestore_wipe

        firestore_wipe(self._db, self._jobs(), self._runs())


class LocalDiskJobsStore:
    """STORE_MODE=local — JSON files; slugs at the root, the rest per tenant."""

    def _slugs_path(self):
        from . import localdisk

        return localdisk.root_dir() / "ats_slugs.json"

    def _jobs_path(self):
        from . import localdisk

        return localdisk.tenant_dir(tenant.current_uid()) / "jobs.json"

    def _runs_path(self):
        from . import localdisk

        return localdisk.tenant_dir(tenant.current_uid()) / "job_runs.json"

    def upsert_slug(self, normalized: str, record: AtsSlugRecord) -> None:
        from . import localdisk

        def _apply(slugs: dict) -> dict:
            slugs[normalized] = record.model_dump()
            return slugs

        localdisk.update_json(self._slugs_path(), {}, _apply)

    def get_slugs(self) -> dict[str, AtsSlugRecord]:
        from . import localdisk

        out: dict[str, AtsSlugRecord] = {}
        for key, raw in localdisk.read_json(self._slugs_path(), {}).items():
            try:
                out[key] = AtsSlugRecord.model_validate(raw)
            except ValueError:
                continue
        return out

    def upsert_postings(self, postings: list[JobPosting]) -> None:
        from . import localdisk

        def _apply(rows: dict) -> dict:
            for posting in postings:
                rows[posting.id] = posting.model_dump()
            return rows

        localdisk.update_json(self._jobs_path(), {}, _apply)

    def get_postings(self, fit_only: bool = False) -> list[JobPosting]:
        from . import localdisk

        rows = localdisk.read_json(self._jobs_path(), {})
        return _sorted_postings([JobPosting.model_validate(v) for v in rows.values()], fit_only)

    def save_run(self, summary: JobsRunSummary, no_feed: list[str] | None = None) -> None:
        from . import localdisk

        doc = summary.model_dump()
        doc["no_feed"] = no_feed or []

        def _apply(runs: dict) -> dict:
            runs[summary.run_id] = doc
            return runs

        localdisk.update_json(self._runs_path(), {}, _apply)

    def get_latest_run(self) -> JobsRunSummary | None:
        from . import localdisk

        runs = localdisk.read_json(self._runs_path(), {})
        summaries = [
            JobsRunSummary.model_validate({k: v for k, v in doc.items() if k != "no_feed"})
            for doc in runs.values()
        ]
        return _latest(summaries)

    def delete_all(self) -> None:
        from . import localdisk

        localdisk.write_json(self._jobs_path(), {})
        localdisk.write_json(self._runs_path(), {})


class InMemoryJobsStore:
    """Test / FAKE-mode twin — slugs global, the rest per tenant."""

    def __init__(self) -> None:
        self._slugs: dict[str, AtsSlugRecord] = {}
        self._postings: dict[str, dict[str, JobPosting]] = {}
        self._runs: dict[str, dict[str, dict]] = {}

    def _postings_for(self) -> dict[str, JobPosting]:
        return self._postings.setdefault(tenant.current_uid(), {})

    def _runs_for(self) -> dict[str, dict]:
        return self._runs.setdefault(tenant.current_uid(), {})

    def upsert_slug(self, normalized: str, record: AtsSlugRecord) -> None:
        self._slugs[normalized] = record

    def get_slugs(self) -> dict[str, AtsSlugRecord]:
        return dict(self._slugs)

    def upsert_postings(self, postings: list[JobPosting]) -> None:
        rows = self._postings_for()
        for posting in postings:
            rows[posting.id] = posting

    def get_postings(self, fit_only: bool = False) -> list[JobPosting]:
        return _sorted_postings(list(self._postings_for().values()), fit_only)

    def save_run(self, summary: JobsRunSummary, no_feed: list[str] | None = None) -> None:
        doc = summary.model_dump()
        doc["no_feed"] = no_feed or []
        self._runs_for()[summary.run_id] = doc

    def get_latest_run(self) -> JobsRunSummary | None:
        summaries = [
            JobsRunSummary.model_validate({k: v for k, v in doc.items() if k != "no_feed"})
            for doc in self._runs_for().values()
        ]
        return _latest(summaries)

    def delete_all(self) -> None:
        self._postings_for().clear()
        self._runs_for().clear()


_jobs_store: JobsStore | None = None


def get_jobs_store() -> JobsStore:
    global _jobs_store
    if _jobs_store is None:
        from .store import build_for_mode

        _jobs_store = build_for_mode(InMemoryJobsStore, LocalDiskJobsStore, FirestoreJobsStore)
    return _jobs_store


def set_jobs_store(store: JobsStore | None) -> None:
    """Test hook / dependency injection."""
    global _jobs_store
    _jobs_store = store
