"""The data inventory is the server half of the privacy manifest. Two
things must hold or the manifest lies:

  1. DATA_INVENTORY names EXACTLY the Firestore collections the store
     modules use — introspected from their source, not hand-mirrored.
  2. DELETE /data really empties every tenant-scoped collection (driven
     through the real endpoint, in memory mode).

All synthetic data; no GCP anywhere."""

from __future__ import annotations

import inspect
import re
from contextlib import contextmanager

import pytest

from app import (
    config,
    enrich_store,
    jobs_store,
    pipeline_store,
    requests_store,
    store,
    tenant,
    users,
)
from app.inventory import (
    DATA_INVENTORY,
    InventoryEntry,
    account_collections,
    tenant_collections,
)
from tests.conftest import make_batch_request

# every module that persists anything — a new store module must be added here
# (and the test below fails loudly if it names a collection the inventory lacks)
STORE_MODULES = (store, enrich_store, jobs_store, pipeline_store, requests_store, users)
_COLLECTION_RE = re.compile(r'\.collection\(\s*"([A-Za-z_]+)"\s*\)')


def collections_used_by_stores() -> set[str]:
    found: set[str] = set()
    for module in STORE_MODULES:
        found |= set(_COLLECTION_RE.findall(inspect.getsource(module)))
    return found


@contextmanager
def bound_tenant(uid: str):
    token = tenant.set_uid(uid)
    try:
        yield
    finally:
        tenant.reset_uid(token)


# ---- the list itself --------------------------------------------------------


def test_inventory_names_exactly_the_store_collections():
    used = collections_used_by_stores()
    listed = [e.collection for e in DATA_INVENTORY]
    assert used, "no .collection(\"…\") calls found — did the stores change shape?"
    assert used - set(listed) == set(), f"used by a store, missing from DATA_INVENTORY: {used - set(listed)}"
    assert set(listed) - used == set(), f"in DATA_INVENTORY, used by no store: {set(listed) - used}"
    assert len(listed) == len(set(listed)), "duplicate collection entries"


def test_inventory_covers_the_known_collections():
    assert set(tenant_collections()) == {
        "people", "activity_log", "enrichments", "jobs", "job_runs", "pipeline", "requests",
    }
    assert set(account_collections()) == {"users", "email_index"}
    assert [e.collection for e in DATA_INVENTORY if e.scope == "global"] == ["ats_slugs"]


def test_scope_decides_the_wipe_switch_and_entries_are_complete():
    switch = {"tenant": "DELETE /data", "account": "delete-account", "global": "never"}
    for entry in DATA_INVENTORY:
        assert isinstance(entry, InventoryEntry)
        assert entry.wiped_by == switch[entry.scope], entry.collection
        assert entry.fields, f"{entry.collection} lists no fields"
        assert len(entry.fields) == len(set(entry.fields)), entry.collection
        assert entry.purpose.strip(), entry.collection


def test_fields_track_the_persisted_models():
    """Field lists derive from the pydantic models the stores write, so a
    new model field cannot silently go unlisted."""
    from app.agents.enrich import EnrichmentCard
    from app.pipeline_store import PipelineItem
    from app.requests_store import UserRequest
    from app.schemas import ActivityEntry, DistilledPerson
    from app.users import UserRecord

    by_name = {e.collection: e for e in DATA_INVENTORY}
    for collection, model in (
        ("people", DistilledPerson),
        ("activity_log", ActivityEntry),
        ("enrichments", EnrichmentCard),
        ("pipeline", PipelineItem),
        ("requests", UserRequest),
        ("users", UserRecord),
    ):
        missing = set(model.model_fields) - set(by_name[collection].fields)
        assert not missing, f"{collection}: model fields not in inventory: {missing}"
    # the research pass merge-sets card fields onto the people doc that the
    # DistilledPerson model itself does not declare — they must be listed
    for extra in ("location_lat", "location_lng", "current_focus", "how_useful", "history"):
        assert extra in by_name["people"].fields
    assert "no_feed" in by_name["job_runs"].fields  # save_run adds it alongside the summary


# ---- the endpoint -----------------------------------------------------------


def test_privacy_inventory_endpoint_is_public(client, monkeypatch):
    """Static metadata: reachable with no service token and no session, and
    also with the service token alone (the web proxy always attaches it).
    Data paths stay gated."""
    monkeypatch.setattr(config, "AGENTS_API_TOKEN", "svc-secret")

    res = client.get("/privacy/inventory")
    assert res.status_code == 200
    assert res.json() == [e.model_dump() for e in DATA_INVENTORY]
    assert set(res.json()[0]) == {"collection", "scope", "fields", "purpose", "wiped_by"}

    assert client.get("/privacy/inventory", headers={"X-Agents-Token": "svc-secret"}).status_code == 200
    assert client.get("/privacy/inventory", headers={"Authorization": "Bearer svc-secret"}).status_code == 200
    assert client.get("/people").status_code == 401
    assert client.get("/people", headers={"X-Agents-Token": "svc-secret"}).status_code == 200


# ---- the wipe ---------------------------------------------------------------


@pytest.fixture()
def all_stores(store):
    fresh = {
        "enrich": enrich_store.InMemoryEnrichStore(),
        "jobs": jobs_store.InMemoryJobsStore(),
        "pipeline": pipeline_store.InMemoryPipelineStore(),
        "requests": requests_store.InMemoryRequestsStore(),
    }
    enrich_store.set_enrich_store(fresh["enrich"])
    jobs_store.set_jobs_store(fresh["jobs"])
    pipeline_store.set_pipeline_store(fresh["pipeline"])
    requests_store.set_requests_store(fresh["requests"])
    yield fresh
    enrich_store.set_enrich_store(None)
    jobs_store.set_jobs_store(None)
    pipeline_store.set_pipeline_store(None)
    requests_store.set_requests_store(None)


def _seed_jobs(js: jobs_store.InMemoryJobsStore, uid: str) -> None:
    with bound_tenant(uid):
        js.upsert_postings(
            [
                jobs_store.JobPosting(
                    id="greenhouse:acme:1",
                    company="Acme.io",
                    slug="acme",
                    source="greenhouse",
                    title="Head of Partnerships",
                    location="Remote",
                    url="https://boards.example.com/acme/1",
                    role_fit=True,
                    fit_reasons=["target role"],
                    posted_at=None,
                    fetched_at="2026-09-01T00:00:00+00:00",
                    contacts=[jobs_store.JobContactRef(tg_id=42, name="Testy McTestface", closeness=73.0)],
                )
            ]
        )
        js.save_run(
            jobs_store.JobsRunSummary(
                run_id="jobs-seed",
                companies_total=1,
                companies_with_slug=1,
                postings_total=1,
                postings_fit=1,
                started_at="2026-09-01T00:00:00+00:00",
                status="done",
            ),
            no_feed=["Zephyr Labs"],
        )


def test_delete_data_empties_every_tenant_collection(client, all_stores):
    """One doc into every tenant-scoped collection through the real
    endpoints (jobs via the store — the scout hits the network), then the
    real DELETE /data. A probe per collection; adding a tenant collection to
    DATA_INVENTORY without a probe here fails the test on purpose."""
    uid = "inventory-tenant"
    headers = {"X-User-Id": uid}
    assert client.post("/refine/batch", json=make_batch_request(), headers=headers).status_code == 200
    assert client.post("/enrich/person", json={"tg_id": 42}, headers=headers).status_code == 200
    assert client.post("/pipeline", json={"tg_id": 42}, headers=headers).status_code == 200
    assert client.post("/requests", json={"query": "who should I meet?"}, headers=headers).status_code == 200
    _seed_jobs(all_stores["jobs"], uid)

    def latest_run():
        with bound_tenant(uid):
            run = all_stores["jobs"].get_latest_run()
        return [] if run is None else [run]

    probes = {
        "people": lambda: client.get("/people", headers=headers).json(),
        "activity_log": lambda: client.get("/activity", headers=headers).json(),
        "enrichments": lambda: client.get("/enrichments", headers=headers).json(),
        "jobs": lambda: client.get("/jobs", headers=headers).json(),
        "job_runs": latest_run,
        "pipeline": lambda: client.get("/pipeline", headers=headers).json(),
        "requests": lambda: client.get("/requests", headers=headers).json(),
    }
    assert set(probes) == set(tenant_collections()), "every tenant collection needs a probe"
    for name, probe in probes.items():
        assert probe(), f"{name} should hold data before the wipe"

    # a bystander tenant and the global slug cache must survive
    other = {"X-User-Id": "bystander"}
    assert client.post("/refine/batch", json=make_batch_request(), headers=other).status_code == 200
    all_stores["jobs"].upsert_slug(
        "acme", jobs_store.AtsSlugRecord(company="Acme.io", slug="acme", source="greenhouse",
                                         verified_at="2026-09-01T00:00:00+00:00")
    )

    assert client.delete("/data", headers=headers).json() == {"deleted": True}

    for name, probe in probes.items():
        assert probe() == [], f"{name} was not emptied by DELETE /data"
    assert len(client.get("/people", headers=other).json()) == 1
    assert "acme" in all_stores["jobs"].get_slugs()
