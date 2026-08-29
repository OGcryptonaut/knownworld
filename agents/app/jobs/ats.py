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
