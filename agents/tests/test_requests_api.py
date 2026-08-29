"""v2: the Requests flow — planner routing, jobs execution with a recency
window, people matching with in-code tg_id validation, tenant isolation.

All synthetic; FAKE_LLM planner/matcher; ATS fetch monkeypatched.
"""

from __future__ import annotations

import json

import pytest

from app.jobs import ats
from app.jobs_store import InMemoryJobsStore, set_jobs_store
from app.requests_store import InMemoryRequestsStore, set_requests_store
from tests.conftest import make_batch_request


@pytest.fixture(autouse=True)
def fresh_stores():
    set_requests_store(InMemoryRequestsStore())
    set_jobs_store(InMemoryJobsStore())
    yield
    set_requests_store(None)
    set_jobs_store(None)


def _seed_person(client, headers=None, name="Testy McTestface", company="AlphaPay", tg_id=42):
    batch = make_batch_request()
    batch["chats"][0]["tg_id"] = tg_id
    batch["chats"][0]["name"] = name
    res = client.post("/refine/batch", json=batch, headers=headers or {})
    assert res.status_code == 200
    return res


def test_empty_query_422(client):
    assert client.post("/requests", json={"query": "   "}).status_code == 422


def test_people_request_matches_with_reasons(client, store):
    _seed_person(client)
    res = client.post(
        "/requests", json={"query": "who should I meet at a conference in New York?"}
    )
    assert res.status_code == 200
    doc = res.json()
    assert doc["status"] == "done"
    assert doc["intent"] == "people"
    matches = doc["result"]["matches"]
    assert len(matches) == 1
    # joined fields come from the DB row, never the model
    assert matches[0]["tg_id"] == 42
    assert matches[0]["name"] == "Testy McTestface"
    assert matches[0]["closeness"] == 73.0
    assert matches[0]["reason"]

    # telemetry: planner + matcher entries with the request id as run_id
    agents = {e["agent"] for e in client.get(f"/activity?run_id={doc['id']}").json()}
    assert agents == {"planner", "matcher"}


def test_jobs_request_runs_scout_with_window(client, store, monkeypatch, tmp_path):
    _seed_person(client)

    slugs_file = tmp_path / "slugs.json"
    slugs_file.write_text(
        json.dumps(
            {
                "fakecorp": {
                    "company": "FakeCorp",
                    "slug": "fakecorp",
                    "source": "greenhouse",
                    "verified_at": "2026-08-01T00:00:00+00:00",
                }
            }
        )
    )
    monkeypatch.setenv("ATS_SLUGS_FILE", str(slugs_file))

    async def fake_fetch(source, slug, client_):
        return [
            ats.RawPosting(
                title="Senior BD Lead",
                url="https://boards.example.com/fakecorp/1",
                location="Remote EMEA",
                posted_at="2026-08-25T00:00:00+00:00",
            ),
            ats.RawPosting(
                title="Senior BD Lead (stale)",
                url="https://boards.example.com/fakecorp/2",
                location="Remote EMEA",
                posted_at="2025-01-01T00:00:00+00:00",
            ),
        ]

    monkeypatch.setattr(ats, "fetch_postings", fake_fetch)

    res = client.post(
        "/requests",
        json={
            "query": "find me a job posted in the last 30 days",
            "profile": {"targetRoles": ["BD lead"], "industries": [], "seniority": [], "location": ""},
        },
    )
    assert res.status_code == 200
    doc = res.json()
    assert doc["status"] == "done"
    assert doc["intent"] == "jobs"
    postings = doc["result"]["postings"]
    assert [p["title"] for p in postings] == ["Senior BD Lead"]  # stale one windowed out
    assert postings[0]["contacts"][0]["tg_id"] == 42  # warm path joined
    assert doc["result"]["stats"]["window_days"] == 30

    # request history persists and is retrievable
    listed = client.get("/requests").json()
    assert [r["id"] for r in listed] == [doc["id"]]
    assert client.get(f"/requests/{doc['id']}").json()["status"] == "done"


def test_requests_are_tenant_isolated(client):
    _seed_person(client, headers={"X-User-Id": "user-a"})
    res = client.post(
        "/requests", json={"query": "who should I meet?"}, headers={"X-User-Id": "user-a"}
    )
    assert res.status_code == 200
    assert len(client.get("/requests", headers={"X-User-Id": "user-a"}).json()) == 1
    assert client.get("/requests", headers={"X-User-Id": "user-b"}).json() == []
