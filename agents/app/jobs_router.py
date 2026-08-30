"""Job scout endpoints (D2).

Contract (mirrors web/src/lib/types.ts):
  POST /jobs/run   {profile: RoleFitProfile} -> JobsRunSummary
                   (dedupe companies -> ATS feeds -> role-fit filter)
  GET  /jobs?fit=1 -> JobPosting[] (contacts joined from people, ranked by
                     closeness desc; names masked at RENDER time by the web app)
  GET  /jobs/summary -> latest JobsRunSummary

Company slugs come from the 'ats_slugs' store (populated by
scripts/probe_slugs.py) merged with the repo seed data/ats-slugs.json (loaded
at call time; the repo file wins on conflict). Companies WITHOUT a verified
slug are counted in the summary and listed in the run doc as 'no_feed' —
deliberately NO web-search fallback in this build (native ATS feeds only).

Role-fit verdicts are computed IN CODE (jobs/rolefit.py) — never by a model;
the single 'jobscout' activity entry logs model '-', 0 tokens, $0.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .jobs import ats
from .jobs.rolefit import fits
from .jobs.slugs import normalize_company
from .jobs_store import (
    AtsSlugRecord,
    JobContactRef,
    JobPosting,
    JobsRunSummary,
    RoleFitProfile,
    get_jobs_store,
)
from .schemas import ActivityEntry
from .store import get_store

router = APIRouter()

FETCH_CONCURRENCY = 8

_REPO_SLUGS_FILE = Path(__file__).resolve().parents[2] / "data" / "ats-slugs.json"
# the Docker image ships only app/ — the same registry is baked in as a seed
_BAKED_SLUGS_FILE = Path(__file__).resolve().parent / "seed" / "ats-slugs.json"


class JobsRunRequest(BaseModel):
    profile: RoleFitProfile


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_repo_slugs() -> dict[str, AtsSlugRecord]:
    """Repo seed file, read fresh at call time. Missing/invalid file -> {};
    invalid entries skipped. Path overridable via ATS_SLUGS_FILE (tests)."""
    override = os.environ.get("ATS_SLUGS_FILE")
    candidates = [Path(override)] if override else [_REPO_SLUGS_FILE, _BAKED_SLUGS_FILE]
    raw = None
    for path in candidates:
        try:
            raw = json.loads(path.read_text())
            break
        except (OSError, ValueError):
            continue
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, AtsSlugRecord] = {}
    for normalized, value in raw.items():
        try:
            out[normalized] = AtsSlugRecord.model_validate(value)
        except ValueError:
            continue
    return out


def _collect_companies(people) -> tuple[dict[str, dict], dict[str, list[JobContactRef]]]:
    """Dedupe companies over people rows by normalized name — definite rows
    claim a company first; inferred-only companies are marked 'inferred'
    (definite and inferred never merge in the people rows themselves; this is
    only the scout's dedupe of where to look). Second return: normalized
    company -> contacts sorted by closeness desc."""
    companies: dict[str, dict] = {}
    for person in people:
        if person.company_definite:
            key = normalize_company(person.company_definite)
            if key and key not in companies:
                companies[key] = {"name": person.company_definite, "origin": "definite"}
    for person in people:
        if person.company_inferred:
            key = normalize_company(person.company_inferred)
            if key and key not in companies:
                companies[key] = {"name": person.company_inferred, "origin": "inferred"}

    contacts: dict[str, list[JobContactRef]] = {}
    for person in people:
        keys = {
            normalize_company(c)
            for c in (person.company_definite, person.company_inferred)
            if c
        }
        for key in keys:
            if key in companies:
                contacts.setdefault(key, []).append(
                    JobContactRef(tg_id=person.tg_id, name=person.name, closeness=person.closeness)
                )
    for refs in contacts.values():
        refs.sort(key=lambda r: r.closeness, reverse=True)
    return companies, contacts


@router.post("/jobs/run", response_model=JobsRunSummary)
async def jobs_run(request: JobsRunRequest) -> JobsRunSummary:
    started = time.monotonic()
    started_at = _now_iso()
    run_id = f"jobs-{uuid.uuid4().hex[:8]}"

    people = get_store().get_people()
    companies, contacts = _collect_companies(people)

    jobs_store = get_jobs_store()
    slugs = {**jobs_store.get_slugs(), **_load_repo_slugs()}  # repo file wins

    with_slug = {key: slugs[key] for key in companies if key in slugs}
    no_feed = [companies[key]["name"] for key in companies if key not in slugs]

    semaphore = asyncio.Semaphore(FETCH_CONCURRENCY)

    async def fetch_one(key: str, record: AtsSlugRecord, client) -> tuple[str, list | None]:
        async with semaphore:
            return key, await ats.fetch_postings(record.source, record.slug, client)

    async with ats.make_client() as client:
        results = await asyncio.gather(
            *(fetch_one(key, record, client) for key, record in with_slug.items())
        )

    fetched_at = _now_iso()
    profile = request.profile.model_dump()
    postings: list[JobPosting] = []
    fetch_failed = 0
    for key, raw_postings in results:
        if raw_postings is None:
            fetch_failed += 1
            continue
        record = with_slug[key]
        for raw in raw_postings:
            role_fit, reasons = fits(raw.title, profile)
            postings.append(
                JobPosting(
                    id=f"{record.source}:{record.slug}:{ats.derive_job_id(raw.url)}",
                    company=companies[key]["name"],
                    slug=record.slug,
                    source=record.source,
                    title=raw.title,
                    location=raw.location,
                    url=raw.url,
                    role_fit=role_fit,
                    fit_reasons=reasons,
                    posted_at=raw.posted_at,
                    fetched_at=fetched_at,
                    contacts=contacts.get(key, []),
                )
            )

    summary = JobsRunSummary(
        run_id=run_id,
        companies_total=len(companies),
        companies_with_slug=len(with_slug),
        postings_total=len(postings),
        postings_fit=sum(1 for p in postings if p.role_fit),
        started_at=started_at,
        status="done",
    )
    jobs_store.upsert_postings(postings)
    jobs_store.save_run(summary, no_feed=no_feed)

    origins = [meta["origin"] for meta in companies.values()]
    get_store().log_activity(
        ActivityEntry(
            ts=_now_iso(),
            agent="jobscout",
            model="-",  # no model call: feeds + in-code filtering only
            run_id=run_id,
            input_tokens=0,
            output_tokens=0,
            est_cost_usd=0.0,
            duration_ms=int((time.monotonic() - started) * 1000),
            status="ok",
            detail=(
                f"companies {summary.companies_total} "
                f"(definite {origins.count('definite')}, inferred {origins.count('inferred')}), "
                f"with_feed {summary.companies_with_slug}, no_feed {len(no_feed)}, "
                f"fetch_failed {fetch_failed}, "
                f"postings {summary.postings_total}, fit {summary.postings_fit}"
            ),
        )
    )
    return summary


@router.get("/jobs", response_model=list[JobPosting])
def get_jobs(fit: int = 0) -> list[JobPosting]:
    return get_jobs_store().get_postings(fit_only=bool(fit))


@router.get("/jobs/summary", response_model=JobsRunSummary)
def get_jobs_summary() -> JobsRunSummary:
    latest = get_jobs_store().get_latest_run()
    if latest is None:
        raise HTTPException(status_code=404, detail="no job runs yet")
    return latest
