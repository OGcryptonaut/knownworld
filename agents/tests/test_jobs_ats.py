"""ATS feed parsers on synthetic fixtures via httpx.MockTransport — no live
network in tests. All company/job data here is invented."""

import asyncio
import json

import httpx

from app.jobs import ats


def run(coro):
    return asyncio.run(coro)


def client_returning(payload, status=200):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["User-Agent"] == ats.USER_AGENT
        body = payload if isinstance(payload, str) else json.dumps(payload)
        return httpx.Response(status, text=body, headers={"content-type": "application/json"})

    return httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        headers={"User-Agent": ats.USER_AGENT},
    )


async def fetch_with(source, payload, status=200, slug="acme"):
    async with client_returning(payload, status) as client:
        return await ats.fetch_postings(source, slug, client)


def test_greenhouse_parses_jobs():
    payload = {
        "jobs": [
            {
                "title": "Partnerships Lead",
                "absolute_url": "https://boards.greenhouse.io/acme/jobs/4012345",
                "location": {"name": "Remote - EMEA"},
                "updated_at": "2026-08-01T10:00:00-04:00",
            },
            {"title": "No URL — skipped"},
        ]
    }
    postings = run(fetch_with("greenhouse", payload))
    assert len(postings) == 1
    p = postings[0]
    assert p.title == "Partnerships Lead"
    assert p.url.endswith("/4012345")
    assert p.location == "Remote - EMEA"
    assert p.posted_at == "2026-08-01T10:00:00-04:00"


def test_lever_parses_array_and_ms_timestamp():
    payload = [
        {
            "text": "BD Manager",
            "hostedUrl": "https://jobs.lever.co/acme/11111111-2222-3333-4444-555555555555",
            "categories": {"location": "Lisbon"},
            "createdAt": 1754006400000,
        }
    ]
    postings = run(fetch_with("lever", payload))
    assert len(postings) == 1
    assert postings[0].location == "Lisbon"
    assert postings[0].posted_at.startswith("2025-08-01")  # ms epoch -> ISO


def test_ashby_parses_jobs():
    payload = {
        "jobs": [
            {
                "title": "Ecosystem Growth Lead",
                "jobUrl": "https://jobs.ashbyhq.com/acme/aaaa-bbbb",
                "location": "Remote",
            }
        ]
    }
    postings = run(fetch_with("ashby", payload))
    assert len(postings) == 1
    assert postings[0].location == "Remote"
    assert postings[0].posted_at is None


def test_workable_parses_jobs_and_joins_city_country():
    payload = {
        "name": "Acme",
        "jobs": [
            {
                "title": "Growth Marketer",
                "url": "https://apply.workable.com/acme/j/ABCD1234/",
                "city": "Lisbon",
                "country": "Portugal",
                "published_on": "2026-08-10",
            }
        ],
    }
    postings = run(fetch_with("workable", payload))
    assert len(postings) == 1
    assert postings[0].location == "Lisbon, Portugal"
    assert postings[0].posted_at == "2026-08-10"


def test_smartrecruiters_builds_posting_url():
    payload = {
        "content": [
            {
                "name": "Program Manager",
                "id": "744000012345",
                "location": {"city": "Berlin"},
                "releasedDate": "2026-07-01T00:00:00.000Z",
            }
        ]
    }
    postings = run(fetch_with("smartrecruiters", payload, slug="acme"))
    assert len(postings) == 1
    assert postings[0].url == "https://jobs.smartrecruiters.com/acme/744000012345"
    assert postings[0].location == "Berlin"


def test_404_and_malformed_return_none():
    assert run(fetch_with("greenhouse", {"error": "not found"}, status=404)) is None
    assert run(fetch_with("lever", {"ok": False})) is None          # not a list
    assert run(fetch_with("ashby", "not json at all")) is None      # parse failure
    assert run(fetch_with("smartrecruiters", [], status=200)) is None


def test_timeout_returns_none():
    def handler(request):
        raise httpx.ConnectTimeout("boom")

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await ats.fetch_postings("greenhouse", "acme", client)

    assert run(go()) is None


def test_probe_true_on_empty_feed_false_on_404():
    assert run_probe({"jobs": []}, 200) is True   # feed exists, zero jobs
    assert run_probe({"jobs": []}, 404) is False


def run_probe(payload, status):
    async def go():
        async with client_returning(payload, status) as client:
            return await ats.probe("greenhouse", "acme", client)

    return run(go())


def test_derive_job_id():
    assert ats.derive_job_id("https://boards.greenhouse.io/acme/jobs/4012345") == "4012345"
    assert ats.derive_job_id("https://apply.workable.com/acme/j/ABCD1234/") == "ABCD1234"
    assert ats.derive_job_id("https://example.com/") == ats.derive_job_id("https://example.com/")
    assert ats.derive_job_id("https://example.com/")  # sha1 fallback non-empty


def test_smartrecruiters_probe_requires_at_least_one_posting():
    # SR returns 200+empty for ANY identifier (incl. nonexistent companies) —
    # an empty SR feed must NOT verify, unlike every other source.
    empty = {"offset": 0, "limit": 100, "totalFound": 0, "content": []}
    nonempty = {"content": [{"name": "Grants Lead", "id": "1", "location": {"city": "Lisbon"}}]}

    async def go(payload):
        async with client_returning(payload) as client:
            return await ats.probe("smartrecruiters", "acme", client)

    assert run(go(empty)) is False
    assert run(go(nonempty)) is True
