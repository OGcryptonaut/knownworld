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
    # ('conference' in the query also wakes the web scout since needs_web)
    agents = {e["agent"] for e in client.get(f"/activity?run_id={doc['id']}").json()}
    assert {"planner", "matcher"} <= agents


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


def _located_person(tg_id, name, closeness, location):
    from app.schemas import DistilledPerson

    return DistilledPerson(
        tg_id=tg_id, name=name, summary="s", work_relevant=True,
        why_relevant="w", closeness=closeness, msg_volume=10,
        run_id="r", refined_at="2026-08-01T00:00:00+00:00", location=location,
    )


def test_region_question_narrows_to_the_one_european_contact(client, store):
    """'Who do I know from Europe?' must answer with the Stockholm contact —
    a single located match is the answer, not a reason to fall back to the
    whole network. The reply also carries a conversational answer."""
    store.upsert_people([
        _located_person(1, "Daniel Ek", 64, "Stockholm, Sweden"),
        _located_person(2, "Austin Person", 90, "Austin, Texas, US"),
        _located_person(3, "Sydney Person", 80, "Sydney, Australia"),
    ])
    doc = client.post("/requests", json={"query": "Who do I know from Europe?"}).json()
    assert doc["status"] == "done"
    assert doc["params"]["location"] == "Europe"
    assert doc["result"]["stats"]["city_matched"] == 1
    assert doc["result"]["stats"]["candidates"] == 1
    names = {m["name"] for m in doc["result"]["matches"]}
    assert names == {"Daniel Ek"}
    assert doc["result"]["answer"]  # the chat reply is part of the contract


def test_web_question_runs_the_grounded_scout_and_carries_sources(client, store):
    """A question needing FRESH public facts (conferences/events) routes
    people + needs_web: the web scout answers with findings + citations;
    matches from the stored network still ride along as warm paths."""
    store.upsert_people([
        _located_person(1, "Palmer Luckey", 80, "Costa Mesa, California"),
        _located_person(2, "Alex Karp", 70, "Denver, Colorado"),
    ])
    doc = client.post(
        "/requests",
        json={"query": "Find me conferences for 2026 my network attends"},
    ).json()
    assert doc["status"] == "done"
    assert doc["params"]["needs_web"] is True
    result = doc["result"]
    assert "FakeConf 2026" in result["answer"]  # findings are IN the reply
    assert [s["url"] for s in result["sources"]]  # citations rendered as links
    assert result["stats"]["web"] == "ok"
    assert result["stats"]["web_findings"] == 2
    assert len(result["matches"]) >= 1  # stored-network warm paths intact
    agents = {e["agent"] for e in client.get(f"/activity?run_id={doc['id']}").json()}
    assert "webscout" in agents

    # a ranking question WITHOUT web words never triggers the scout
    plain = client.post("/requests", json={"query": "who should I meet about AI?"}).json()
    assert plain["params"]["needs_web"] is False
    assert plain["result"]["stats"].get("web") is None


def test_brief_intent_composes_a_deliverable_for_a_named_contact(client, store):
    """'Prepare questions for a meeting with X': routes brief, the target
    resolves in code, the composer writes titled sections grounded on the
    full card. The doc re-validates (the intro-Literal regression class)."""
    _seed_person(client)
    doc = client.post(
        "/requests", json={"query": "Prepare questions for a meeting with Testy"}
    ).json()
    assert doc["status"] == "done"
    assert doc["intent"] == "brief"
    from app.requests_store import UserRequest

    UserRequest.model_validate(doc)  # disk/Firestore re-validate on read
    result = doc["result"]
    assert result["kind"] == "brief"
    assert "FAKE composer" in result["answer"]
    titles = [s["title"] for s in result["sections"]]
    assert "Questions to ask" in titles
    assert result["matches"][0]["tg_id"] == 42
    assert result["matches"][0]["reason"] == "the contact this brief is about"
    agents = {e["agent"] for e in client.get(f"/activity?run_id={doc['id']}").json()}
    assert "composer" in agents


def test_brief_without_a_name_scopes_via_the_matcher(client, store):
    store.upsert_people([
        _located_person(1, "Pay Person", 90, "New York, NY"),
        _located_person(2, "Other Person", 50, "Sydney, Australia"),
    ])
    doc = client.post(
        "/requests", json={"query": "Prepare a custdev strategy for payments"}
    ).json()
    assert doc["status"] == "done"
    assert doc["intent"] == "brief"
    assert len(doc["result"]["matches"]) >= 1
    assert doc["result"]["sections"]


def test_brief_with_web_words_carries_sources(client, store):
    _seed_person(client)
    doc = client.post(
        "/requests",
        json={"query": "Prepare questions for a meeting with Testy about his conference"},
    ).json()
    assert doc["status"] == "done"
    assert doc["intent"] == "brief"
    assert doc["params"]["needs_web"] is True
    assert doc["result"]["stats"]["web"] == "ok"
    assert doc["result"]["sources"]
    assert doc["result"]["sections"]


def test_web_scout_runs_even_when_the_matcher_finds_nobody(client, store, monkeypatch):
    """'Who attends NY conferences?' — no stored row says that, so the
    matcher honestly returns zero. That is exactly when the scout matters:
    it must run anyway, anchored on the top of the network (the owner's
    'такого не может быть' bug)."""
    from app.agents import planner as planner_agent
    from app.agents.planner import MatchOutput, UsageStats

    def empty_match(query, people, cards=None):
        return MatchOutput(matches=[], answer="Nobody is listed as attending."), UsageStats(
            model="fake:test", input_tokens=1, output_tokens=1
        )

    monkeypatch.setattr(planner_agent, "match_people", empty_match)
    store.upsert_people([
        _located_person(1, "Sam Altman", 94, "San Francisco, California"),
        _located_person(2, "Patrick Collison", 91, "San Francisco, California"),
    ])
    doc = client.post(
        "/requests",
        json={"query": "Who from my network is attending conferences in New York?"},
    ).json()
    assert doc["status"] == "done"
    result = doc["result"]
    assert result["matches"] == []  # the stored ranking stays honest
    assert result["stats"]["web"] == "ok"  # but the scout RAN
    assert result["stats"]["web_scope"] == "top-closeness"
    assert "FakeConf 2026" in result["answer"]  # and answered from the web
    assert result["sources"]


def test_web_scout_retries_transient_429s_before_answering(client, store, monkeypatch):
    """A Vertex RESOURCE_EXHAUSTED on the first attempt must not kill the
    lookup — the scout retries with backoff (the owner's second 'stupid
    answer' was exactly one un-retried 429)."""
    import time as time_mod

    from app.agents import webscout
    from app.agents.refine_agent import ModelCallError

    real = webscout.run_web_answer
    calls = {"n": 0}

    def flaky(question, contacts):
        calls["n"] += 1
        if calls["n"] == 1:
            raise ModelCallError("web search failed: 429 RESOURCE_EXHAUSTED")
        return real(question, contacts)

    monkeypatch.setattr(webscout, "run_web_answer", flaky)
    monkeypatch.setattr(time_mod, "sleep", lambda _s: None)
    store.upsert_people([_located_person(1, "Sam Altman", 94, "San Francisco, California")])
    doc = client.post(
        "/requests", json={"query": "Who attends conferences in New York?"}
    ).json()
    assert doc["status"] == "done"
    assert calls["n"] == 2  # failed once, retried, answered
    assert doc["result"]["stats"]["web"] == "ok"
    assert "FakeConf 2026" in doc["result"]["answer"]


def test_web_lookup_failure_degrades_to_the_stored_answer(client, store, monkeypatch):
    """The scout failing must never sink the request: the stored-rows answer
    stands with an honest note, status stays done."""
    import time as time_mod

    from app.agents import webscout
    from app.agents.refine_agent import ModelCallError

    def boom(question, contacts):
        raise ModelCallError("web down")

    monkeypatch.setattr(webscout, "run_web_answer", boom)
    monkeypatch.setattr(time_mod, "sleep", lambda _s: None)
    store.upsert_people([_located_person(1, "Palmer Luckey", 80, "Costa Mesa, California")])
    doc = client.post(
        "/requests", json={"query": "Find me conferences for 2026 my network attends"}
    ).json()
    assert doc["status"] == "done"
    assert doc["result"]["stats"]["web"] == "failed"
    assert "web lookup failed" in " ".join(
        e["detail"] or "" for e in client.get(f"/activity?run_id={doc['id']}").json()
    )
    assert "stored network" in doc["result"]["answer"]


def test_jobs_place_filter_understands_la_metro_and_zero_match_is_said_out_loud(
    client, store, monkeypatch, tmp_path
):
    """'in LA' keeps the Costa Mesa posting (metro) and drops Sydney; a place
    with zero matches keeps the honest fallback AND says so in the answer."""
    _seed_person(client)
    slugs_file = tmp_path / "slugs.json"
    slugs_file.write_text(json.dumps({
        "fakecorp": {
            "company": "FakeCorp", "slug": "fakecorp", "source": "greenhouse",
            "verified_at": "2026-08-01T00:00:00+00:00",
        }
    }))
    monkeypatch.setenv("ATS_SLUGS_FILE", str(slugs_file))

    async def fake_fetch(source, slug, client_):
        return [
            ats.RawPosting(
                title="BD Lead (Costa Mesa)",
                url="https://boards.example.com/fakecorp/1",
                location="Costa Mesa, California, United States",
                posted_at="2026-08-25T00:00:00+00:00",
            ),
            ats.RawPosting(
                title="BD Lead (Sydney)",
                url="https://boards.example.com/fakecorp/2",
                location="Sydney, New South Wales, Australia",
                posted_at="2026-08-25T00:00:00+00:00",
            ),
        ]

    monkeypatch.setattr(ats, "fetch_postings", fake_fetch)
    profile = {"targetRoles": ["BD lead"], "industries": [], "seniority": [], "location": ""}

    doc = client.post(
        "/requests", json={"query": "Is there a BD job for me in LA?", "profile": profile}
    ).json()
    assert doc["status"] == "done"
    assert doc["params"]["location"] == "LA"
    assert doc["result"]["stats"]["location_matched"] == 1
    assert [p["title"] for p in doc["result"]["postings"]] == ["BD Lead (Costa Mesa)"]
    assert "Found 1" in doc["result"]["answer"]

    miss = client.post(
        "/requests", json={"query": "Is there a BD job for me in Bangkok?", "profile": profile}
    ).json()
    assert miss["status"] == "done"
    assert miss["result"]["stats"]["location_matched"] == 0
    # honest fallback: elsewhere-postings stay, the answer says so out loud
    assert len(miss["result"]["postings"]) == 2
    assert "could not find" in miss["result"]["answer"].lower()
    assert "Bangkok" in miss["result"]["answer"]
