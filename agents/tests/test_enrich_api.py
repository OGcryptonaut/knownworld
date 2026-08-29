"""Enrich endpoints in FAKE mode with in-memory stores — no GCP anywhere.
All test data is synthetic — invented names only."""

import asyncio

import httpx
import pytest

from app import enrich_store as enrich_store_module
from app import tasks as tasks_module
from app.agents.enrich import (
    FAKE_EXTRACT_INPUT_TOKENS,
    FAKE_EXTRACT_OUTPUT_TOKENS,
    FAKE_MISMATCH_EMPLOYER,
    FAKE_RESOLVED_NAME,
    FAKE_SEARCH_INPUT_TOKENS,
    FAKE_SEARCH_OUTPUT_TOKENS,
)
from app.enrich_store import InMemoryEnrichStore
from app.main import app
from app.schemas import DistilledPerson
from app.store import InMemoryStore
from app.tasks import LocalTaskQueue

FAKE_INPUT_SUM = FAKE_SEARCH_INPUT_TOKENS + FAKE_EXTRACT_INPUT_TOKENS
FAKE_OUTPUT_SUM = FAKE_SEARCH_OUTPUT_TOKENS + FAKE_EXTRACT_OUTPUT_TOKENS


@pytest.fixture()
def enrich_store(store: InMemoryStore) -> InMemoryEnrichStore:
    fresh = InMemoryEnrichStore()
    enrich_store_module.set_enrich_store(fresh)
    yield fresh
    enrich_store_module.set_enrich_store(None)


@pytest.fixture()
def task_queue() -> LocalTaskQueue:
    queue = LocalTaskQueue()
    tasks_module.set_task_queue(queue)
    yield queue
    tasks_module.set_task_queue(None)


def seed_person(
    store: InMemoryStore,
    tg_id: int = 42,
    name: str = "Testy McTestface",
    company_definite: str | None = "FakeCorp",
    company_inferred: str | None = None,
    closeness: float = 80.0,
    work_relevant: bool = True,
) -> DistilledPerson:
    person = DistilledPerson(
        tg_id=tg_id,
        name=name,
        company_definite=company_definite,
        company_inferred=company_inferred,
        role_guess="Founder",
        summary="Synthetic seed row.",
        work_relevant=work_relevant,
        why_relevant="seeded for tests",
        closeness=closeness,
        msg_volume=100,
        last_contact="2026-08-01T12:00:00+00:00",
        run_id="seed-run",
        refined_at="2026-08-01T12:00:00+00:00",
    )
    store.upsert_people([person])
    return person


def get_person(store: InMemoryStore, tg_id: int) -> DistilledPerson:
    return next(p for p in store.get_people() if p.tg_id == tg_id)


# ---- /enrich/person ---------------------------------------------------------


def test_enrich_person_happy_path_auto_applies_findings(
    client, store, enrich_store
):
    seed_person(store)
    response = client.post("/enrich/person", json={"tg_id": 42})
    assert response.status_code == 200
    card = response.json()

    assert card["tg_id"] == 42
    assert card["status"] == "approved"  # v2: findings auto-apply, owner edits
    assert card["verdict"] == "match"
    assert "FakeCorp" in card["verdict_reason"]
    assert card["db_company"] == "FakeCorp"
    assert card["current_employer"] == "FakeCorp"
    assert card["linkedin_url"].startswith("https://www.linkedin.com/in/")
    assert len(card["citations"]) == 2
    assert card["citations"][0]["url"]
    assert card["citations"][0]["title"]
    assert card["footprint"]

    # card persisted; evidence auto-merged into the person doc IN CODE
    stored = enrich_store.get_card(42)
    assert stored is not None and stored.status == "approved"
    merged = enrich_store.person_fields["42"]
    assert merged["verified"] == "match"
    assert merged["current_employer"] == "FakeCorp"
    assert merged["company_definite"] == "FakeCorp"  # match -> safe to write

    # telemetry: both steps' tokens summed on one 'enrich' entry
    entries = [e for e in store.get_activity() if e.agent == "enrich"]
    assert len(entries) == 1
    activity = entries[0]
    assert activity.model.startswith("fake:")
    assert activity.input_tokens == FAKE_INPUT_SUM
    assert activity.output_tokens == FAKE_OUTPUT_SUM
    assert activity.status == "ok"
    assert "verdict=match" in activity.detail
    assert "citations=2" in activity.detail
    assert activity.duration_ms >= 0


def test_enrich_person_unknown_tg_id_404s(client, store, enrich_store):
    assert client.post("/enrich/person", json={"tg_id": 999}).status_code == 404


def test_unidentified_person_gets_unverified_never_a_guess(client, store, enrich_store):
    seed_person(store, tg_id=7, name="Norman Nobody", company_definite="Acme")
    card = client.post("/enrich/person", json={"tg_id": 7}).json()
    assert card["verdict"] == "unverified"
    assert card["current_employer"] is None
    assert card["citations"] == []


def test_db_company_override_flags_mismatch_without_touching_person(
    client, store, enrich_store
):
    seed_person(store)  # stored company FakeCorp; fake evidence echoes it
    response = client.post(
        "/enrich/person",
        json={"tg_id": 42, "db_company_override": "Different Labs"},
    )
    assert response.status_code == 200
    card = response.json()
    assert card["verdict"] == "possible_mismatch"
    assert card["db_company"] == "Different Labs"
    assert "evidence says 'FakeCorp'" in card["verdict_reason"]
    assert "DB says 'Different Labs'" in card["verdict_reason"]

    # the override is comparison-only: the stored company is untouched —
    # a mismatch NEVER silently rewrites company_definite (owner Edit does)
    person = get_person(store, 42)
    assert person.company_definite == "FakeCorp"
    assert person.company_inferred is None
    merged = enrich_store.person_fields["42"]
    assert "company_definite" not in merged
    assert merged["verified"] == "possible_mismatch"


def test_enrichments_listing_filters_by_status(client, store, enrich_store):
    seed_person(store, tg_id=1, name="Alice Alpha")
    seed_person(store, tg_id=2, name="Bob Beta")
    client.post("/enrich/person", json={"tg_id": 1})
    client.post("/enrich/person", json={"tg_id": 2})

    assert len(client.get("/enrichments").json()) == 2
    assert client.get("/enrichments", params={"status": "pending"}).json() == []
    approved = client.get("/enrichments", params={"status": "approved"}).json()
    assert sorted(c["tg_id"] for c in approved) == [1, 2]


def test_resolved_name_auto_applies_only_to_blank_names(client, store, enrich_store):
    seed_person(store, tg_id=8, name="", company_definite="FakeCorp")
    card = client.post("/enrich/person", json={"tg_id": 8}).json()
    assert card["resolved_name"] == FAKE_RESOLVED_NAME
    assert get_person(store, 8).name == FAKE_RESOLVED_NAME  # auto-applied

    seed_person(store, tg_id=9, name="Named Person", company_definite="FakeCorp")
    client.post("/enrich/person", json={"tg_id": 9})
    assert get_person(store, 9).name == "Named Person"  # never renamed


# ---- /enrich/run via LocalTaskQueue ----------------------------------------


def test_enrich_run_local_queue_processes_all_queued(store, enrich_store, task_queue):
    seed_person(store, tg_id=1, name="Alice Alpha", closeness=90)
    seed_person(store, tg_id=2, name="Bob Beta", closeness=70)
    seed_person(store, tg_id=3, name="Paula Personal", closeness=99, work_relevant=False)

    async def scenario():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            response = await ac.post("/enrich/run", json={})
            assert response.status_code == 200
            body = response.json()
            assert body["queued"] == 2  # work_relevant only
            assert body["run_id"].startswith("enrich-")
            await task_queue.drain()
            cards = (await ac.get("/enrichments")).json()
            return body, cards

    body, cards = asyncio.run(scenario())
    assert sorted(c["tg_id"] for c in cards) == [1, 2]
    assert all(c["status"] == "approved" for c in cards)
    assert all(c["run_id"] == body["run_id"] for c in cards)
    run_entries = [e for e in store.get_activity(body["run_id"]) if e.agent == "enrich"]
    assert len(run_entries) == 2
    assert all(e.status == "ok" for e in run_entries)


def test_enrich_run_explicit_tg_ids_and_top_limit(store, enrich_store, task_queue):
    for tg_id, closeness in ((1, 10), (2, 50), (3, 90)):
        seed_person(store, tg_id=tg_id, name=f"Person Number{tg_id}", closeness=closeness)

    async def scenario():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            explicit = (await ac.post("/enrich/run", json={"tg_ids": [2, 999]})).json()
            assert explicit["queued"] == 1  # only existing people enqueue
            top = (await ac.post("/enrich/run", json={"top": 2})).json()
            assert top["queued"] == 2
            await task_queue.drain()
            cards = (await ac.get("/enrichments")).json()
            return top, cards

    top, cards = asyncio.run(scenario())
    # top-2 by closeness = tg 3 and 2; explicit run added tg 2 as well
    assert sorted(c["tg_id"] for c in cards) == [2, 3]
    top_ids = {c["tg_id"] for c in cards if c["run_id"] == top["run_id"]}
    assert top_ids == {2, 3}


def test_owner_correction_writes_person_and_clears_flag(client, store):
    """SPEC v1.1 item 5: inline correction on any card, incl. mismatch."""
    seed_person(store, tg_id=7, name="Testy McTestface")
    resp = client.post("/enrich/person", json={"tg_id": 7, "db_company_override": "WrongCorp"})
    assert resp.status_code == 200
    assert resp.json()["verdict"] in ("possible_mismatch", "match", "unverified")

    r = client.post(
        "/enrichments/7/correct",
        json={"name": "Corrected Name", "company": "RightCorp", "role": "BD Lead"},
    )
    assert r.status_code == 200, r.text
    person = r.json()
    assert person["name"] == "Corrected Name"
    assert person["company_definite"] == "RightCorp"
    assert person["verified"] == "owner"

    cards = client.get("/enrichments", params={"status": "approved"}).json()
    card = next(c for c in cards if c["tg_id"] == 7)
    assert card["verified_by"] == "owner"
    assert card["current_employer"] == "RightCorp"
    assert card["name"] == "Corrected Name"

    acts = client.get("/activity").json()
    owner_acts = [a for a in acts if a["agent"] == "owner"]
    assert owner_acts and "verified_by=owner" in owner_acts[-1]["detail"]


def test_owner_correction_requires_a_field(client, store):
    seed_person(store, tg_id=7, name="Testy McTestface")
    client.post("/enrich/person", json={"tg_id": 7})
    r = client.post("/enrichments/7/correct", json={})
    assert r.status_code == 422
