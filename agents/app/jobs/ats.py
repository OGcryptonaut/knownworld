"""Async clients for public ATS job feeds.

All requests are polite (honest User-Agent, 8s timeout) and read-only public
endpoints that companies deliberately publish. Every fetcher returns
list[RawPosting] on success (empty list = feed exists, zero jobs) and None on
404/timeout/parse failure — callers treat None as "no feed". probe() = does
the feed exist at all (HTTP 200 + parseable, ANY job count including 0).

Only company slugs ever travel over the network here — never person data.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Awaitable, Callable
from urllib.parse import urlsplit

import httpx

TIMEOUT_S = 8.0
USER_AGENT = "knownworld-jobscout/0.1"

# Probe order: cheapest/most common feeds first.
SOURCES: tuple[str, ...] = ("greenhouse", "lever", "ashby", "smartrecruiters", "workable")


@dataclass(frozen=True)
class RawPosting:
    title: str
    url: str
    location: str | None
    posted_at: str | None  # ISO 8601, or None when the feed has no date


def make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=TIMEOUT_S,
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
    )


def derive_job_id(url: str) -> str:
    """Stable per-posting id from the posting URL (last path segment; sha1
    fallback). Used to build JobPosting.id = '{source}:{slug}:{job_id}'."""
    path = urlsplit(url).path
    for segment in reversed(path.split("/")):
        cleaned = re.sub(r"[^A-Za-z0-9_-]", "", segment)
        if cleaned:
            return cleaned[:64]
    return hashlib.sha1(url.encode()).hexdigest()[:12]


def _iso_or_none(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _iso_from_ms(value: object) -> str | None:
    if isinstance(value, (int, float)) and value > 0:
        try:
            return datetime.fromtimestamp(value / 1000, tz=timezone.utc).isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    return None


async def _get_json(client: httpx.AsyncClient, url: str) -> object | None:
    """GET url -> parsed JSON, or None on any transport/HTTP/parse failure."""
    try:
        response = await client.get(url)
    except httpx.HTTPError:
        return None
    if response.status_code != 200:
        return None
    try:
        return response.json()
    except ValueError:
        return None


# ---- Per-source fetchers ----------------------------------------------------

async def fetch_greenhouse(client: httpx.AsyncClient, slug: str) -> list[RawPosting] | None:
    data = await _get_json(client, f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs")
    if not isinstance(data, dict) or not isinstance(data.get("jobs"), list):
        return None
    postings: list[RawPosting] = []
    for job in data["jobs"]:
        if not isinstance(job, dict):
            continue
        title, url = job.get("title"), job.get("absolute_url")
        if not title or not url:
            continue
        location = job.get("location")
        location_name = location.get("name") if isinstance(location, dict) else None
        postings.append(
            RawPosting(
                title=title,
                url=url,
                location=location_name if isinstance(location_name, str) and location_name else None,
                posted_at=_iso_or_none(job.get("updated_at")),
            )
        )
    return postings


async def fetch_lever(client: httpx.AsyncClient, slug: str) -> list[RawPosting] | None:
    data = await _get_json(client, f"https://api.lever.co/v0/postings/{slug}?mode=json")
    if not isinstance(data, list):
        return None
    postings: list[RawPosting] = []
    for job in data:
        if not isinstance(job, dict):
            continue
        title, url = job.get("text"), job.get("hostedUrl")
        if not title or not url:
            continue
        categories = job.get("categories")
        location = categories.get("location") if isinstance(categories, dict) else None
        postings.append(
            RawPosting(
                title=title,
                url=url,
                location=location if isinstance(location, str) and location else None,
                posted_at=_iso_from_ms(job.get("createdAt")),
            )
        )
    return postings


async def fetch_ashby(client: httpx.AsyncClient, slug: str) -> list[RawPosting] | None:
    data = await _get_json(client, f"https://api.ashbyhq.com/posting-api/job-board/{slug}")
    if not isinstance(data, dict) or not isinstance(data.get("jobs"), list):
        return None
    postings: list[RawPosting] = []
    for job in data["jobs"]:
        if not isinstance(job, dict):
            continue
        title = job.get("title")
        url = job.get("jobUrl") or job.get("url")
        if not title or not url:
            continue
        location = job.get("location")
        postings.append(
            RawPosting(
                title=title,
                url=url,
                location=location if isinstance(location, str) and location else None,
                posted_at=_iso_or_none(job.get("publishedAt") or job.get("publishedDate")),
            )
        )
    return postings


async def fetch_workable(client: httpx.AsyncClient, slug: str) -> list[RawPosting] | None:
    """Workable public widget API (live-verified 2026-08-29; see module tests
    for the shape). Falls back to the accounts API if the widget is gone."""
    data = await _get_json(client, f"https://apply.workable.com/api/v1/widget/accounts/{slug}")
    if not isinstance(data, dict) or not isinstance(data.get("jobs"), list):
        data = await _get_json(client, f"https://www.workable.com/api/accounts/{slug}")
    if not isinstance(data, dict) or not isinstance(data.get("jobs"), list):
        return None
    postings: list[RawPosting] = []
    for job in data["jobs"]:
        if not isinstance(job, dict):
            continue
        title, url = job.get("title"), job.get("url")
        if not title or not url:
            continue
        parts = [job.get("city"), job.get("country")]
        location = ", ".join(p for p in parts if isinstance(p, str) and p) or None
        postings.append(
            RawPosting(
                title=title,
                url=url,
                location=location,
                posted_at=_iso_or_none(job.get("published_on") or job.get("created_at")),
            )
        )
    return postings


async def fetch_smartrecruiters(client: httpx.AsyncClient, slug: str) -> list[RawPosting] | None:
    data = await _get_json(client, f"https://api.smartrecruiters.com/v1/companies/{slug}/postings")
    if not isinstance(data, dict) or not isinstance(data.get("content"), list):
        return None
    postings: list[RawPosting] = []
    for job in data["content"]:
        if not isinstance(job, dict):
            continue
        title, job_id = job.get("name"), job.get("id")
        if not title or not job_id:
            continue
        url = job.get("postingUrl") or f"https://jobs.smartrecruiters.com/{slug}/{job_id}"
        location = job.get("location")
        city = location.get("city") if isinstance(location, dict) else None
        postings.append(
            RawPosting(
                title=title,
                url=url,
                location=city if isinstance(city, str) and city else None,
                posted_at=_iso_or_none(job.get("releasedDate")),
            )
        )
    return postings


Fetcher = Callable[[httpx.AsyncClient, str], Awaitable[list[RawPosting] | None]]

FETCHERS: dict[str, Fetcher] = {
    "greenhouse": fetch_greenhouse,
    "lever": fetch_lever,
    "ashby": fetch_ashby,
    "workable": fetch_workable,
    "smartrecruiters": fetch_smartrecruiters,
}


async def fetch_postings(
    source: str, slug: str, client: httpx.AsyncClient | None = None
) -> list[RawPosting] | None:
    fetcher = FETCHERS.get(source)
    if fetcher is None:
        raise ValueError(f"unknown ATS source '{source}'")
    if client is not None:
        return await fetcher(client, slug)
    async with make_client() as owned:
        return await fetcher(owned, slug)


async def probe(source: str, slug: str, client: httpx.AsyncClient | None = None) -> bool:
    """Feed existence check: 200 + parseable, any job count including 0.

    EXCEPTION (live-verified 2026-08-29): the smartrecruiters postings API
    returns 200 + empty content for ANY identifier, real or not, and there is
    no public company-details endpoint to disambiguate — so an empty SR feed
    is indistinguishable from a nonexistent company. SR therefore only
    verifies with >= 1 posting; every other source 404s on unknown slugs, so
    200 + zero jobs there is a real (empty) feed.
    """
    postings = await fetch_postings(source, slug, client)
    if postings is None:
        return False
    if source == "smartrecruiters":
        return len(postings) > 0
    return True


# ---- Feed identity verification -------------------------------------------
# probe() proves a feed EXISTS at a slug; it does not prove the feed belongs
# to the company we derived the slug from ("NCC" must not match NCC Group's
# board). Where the API exposes the board's own name we compare it to ours;
# lever exposes no name, so we look for a distinctive company token in the
# first postings' descriptions.

_IDENTITY_STOPWORDS = {
    "the", "labs", "lab", "dao", "protocol", "crypto", "web3", "foundation",
    "network", "inc", "ltd", "llc", "corp", "co", "group", "team", "project",
    "official", "and", "of", "for",
}


def _name_tokens(name: str) -> set[str]:
    import re as _re

    return {
        t
        for t in _re.split(r"[^a-z0-9]+", (name or "").lower())
        if len(t) >= 3 and t not in _IDENTITY_STOPWORDS
    }


def names_match(board_name: str | None, company: str) -> bool:
    """Code-side identity check: containment either way or >=50% token overlap."""
    if not board_name:
        return False
    a, b = board_name.strip().lower(), company.strip().lower()
    if not a or not b:
        return False
    ta, tb = _name_tokens(a), _name_tokens(b)
    if not ta or not tb:
        return a == b
    # one-token names ("Juno", "Rain") are too ambiguous for containment:
    # require exact token equality so we never join another company's board
    if min(len(ta), len(tb)) == 1:
        return ta == tb
    if a in b or b in a:
        return True
    overlap = len(ta & tb) / min(len(ta), len(tb))
    return overlap >= 0.5


async def board_identity(
    client: httpx.AsyncClient, source: str, slug: str
) -> str | None:
    """The board's own display name, where the source's API exposes one."""
    if source == "greenhouse":
        data = await _get_json(client, f"https://boards-api.greenhouse.io/v1/boards/{slug}")
        if isinstance(data, dict):
            return data.get("name")
    elif source == "ashby":
        data = await _get_json(
            client, f"https://api.ashbyhq.com/posting-api/job-board/{slug}"
        )
        if isinstance(data, dict):
            name = data.get("organizationName") or data.get("name")
            if name:
                return name
            jobs = data.get("jobs")
            if isinstance(jobs, list) and jobs and isinstance(jobs[0], dict):
                return jobs[0].get("organizationName")
    elif source == "workable":
        data = await _get_json(
            client, f"https://apply.workable.com/api/v1/widget/accounts/{slug}"
        )
        if isinstance(data, dict):
            return data.get("name")
    elif source == "smartrecruiters":
        data = await _get_json(
            client, f"https://api.smartrecruiters.com/v1/companies/{slug}"
        )
        if isinstance(data, dict):
            return data.get("name")
    return None


async def verify_identity(
    client: httpx.AsyncClient, source: str, slug: str, company: str
) -> tuple[bool, str]:
    """(identity_ok, evidence). Name-bearing sources compare names; lever
    falls back to searching the first postings' descriptions for a
    distinctive company token."""
    if source == "lever":
        data = await _get_json(
            client, f"https://api.lever.co/v0/postings/{slug}?mode=json"
        )
        if not isinstance(data, list) or not data:
            return False, "lever: no postings to inspect"
        tokens = _name_tokens(company)
        if not tokens:
            return False, "lever: no distinctive company tokens"
        hay = " ".join(
            str(p.get("descriptionPlain") or p.get("description") or "")
            for p in data[:3]
            if isinstance(p, dict)
        ).lower()
        # ALL distinctive tokens must appear — a single common word like
        # "proof" or "capital" matches half the internet's job descriptions
        missing = [t for t in tokens if t not in hay]
        if not missing:
            return True, f"lever: all tokens {sorted(tokens)} found in posting descriptions"
        return False, f"lever: tokens {missing} absent from posting descriptions"
    name = await board_identity(client, source, slug)
    if names_match(name, company):
        return True, f"{source}: board name '{name}' matches"
    return False, f"{source}: board name '{name}' does not match '{company}'"
