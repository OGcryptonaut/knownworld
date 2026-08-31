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


def test_intro_intent_drafts_a_message_for_a_named_contact(client, store):
    """Chat-requested intro: the planner routes 'draft an intro to X', the
    target resolves in code by name, the drafter writes copy-out text."""
    _seed_person(client)
    doc = client.post(
        "/requests", json={"query": "Draft an intro to Testy about payments"}
    ).json()
    assert doc["status"] == "done"
    assert doc["intent"] == "intro"
    # disk/Firestore stores re-validate on every read — an intent the model
    # emits but UserRequest rejects would 500 the whole page (regression!)
    from app.requests_store import UserRequest

    UserRequest.model_validate(doc)
    result = doc["result"]
    assert result["kind"] == "intro"
    assert result["intro_to"]["tg_id"] == 42
    assert result["intro_to"]["name"] == "Testy McTestface"
    assert result["message"] and "Testy" in result["message"]
    assert result["stats"]["resolved"] is True

    # an unknown name gets an honest empty answer, never a guess
    miss = client.post(
        "/requests", json={"query": "Draft an intro to Nobody Wholikesthat"}
    ).json()
    assert miss["status"] == "done"
    assert miss["result"]["kind"] == "intro"
    assert miss["result"]["message"] is None
    assert miss["result"]["stats"]["resolved"] is False


def test_follow_up_joins_the_thread_with_a_client_id(client, store):
    """Iterating on a request is a conversation: a follow-up carries the
    first request's id as thread_id, the client may pre-pick the doc id (so
    it can watch the activity log from second one), and prior answers become
    planner context."""
    _seed_person(client)
    first_id = "a" * 32
    first = client.post(
        "/requests",
        json={"query": "who should I meet at a conference?", "id": first_id},
    ).json()
    assert first["id"] == first_id  # client-supplied id is honored
    assert first["thread_id"] == first_id  # a fresh request roots its own thread

    follow = client.post(
        "/requests",
        json={"query": "dig deeper, give me more options", "thread_id": first_id},
    ).json()
    assert follow["status"] == "done"
    assert follow["thread_id"] == first_id
    assert follow["id"] != first_id

    listed = client.get("/requests").json()
    assert {r["thread_id"] for r in listed} == {first_id}

    # malformed ids are refused, never silently replaced
    assert client.post("/requests", json={"query": "x", "id": "nope"}).status_code == 422
    assert (
        client.post("/requests", json={"query": "x", "thread_id": "nope"}).status_code
        == 422
    )


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


def test_city_filter_narrows_candidates_in_code(client, store):
    """atlas --ask shape: structured filters narrow BEFORE the model ranks.
    A city-bound query considers only located contacts (when >=3 match);
    stats say so honestly."""
    from app.schemas import DistilledPerson

    def person(tg_id, name, closeness, location):
        return DistilledPerson(
            tg_id=tg_id, name=name, summary="s", work_relevant=True,
            why_relevant="w", closeness=closeness, msg_volume=10,
            run_id="r", refined_at="2026-08-01T00:00:00+00:00", location=location,
        )

    store.upsert_people([
        person(1, "SF One", 90, "San Francisco, California, US"),
        person(2, "SF Two", 80, "San Francisco, California, US"),
        person(3, "SF Three", 70, "San Francisco, California, US"),
        person(4, "Berlin Person", 95, "Berlin, Germany"),
        person(5, "Nowhere Person", 99, None),
    ])
    doc = client.post(
        "/requests", json={"query": "who should I meet in San Francisco?"}
    ).json()
    assert doc["status"] == "done"
    assert doc["params"]["location"] == "San Francisco"
    assert doc["result"]["stats"]["considered"] == 5
    assert doc["result"]["stats"]["candidates"] == 3
    assert doc["result"]["stats"]["city_matched"] == 3
    names = {m["name"] for m in doc["result"]["matches"]}
    assert "Berlin Person" not in names and "Nowhere Person" not in names
