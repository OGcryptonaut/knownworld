"""v2: account auth + tenant isolation + local-disk store.

All synthetic data; no GCP anywhere. Tenancy contract: a session JWT (or the
proxy's X-User-Id) scopes every store call — one user can never see another
user's rows, and delete_all() only wipes the caller's tenant.
"""

from __future__ import annotations

import pytest

from app import auth_router, config, tenant
from app.store import LocalDiskStore
from app.users import InMemoryUsersStore, set_users_store
from tests.conftest import make_batch_request


@pytest.fixture(autouse=True)
def fresh_users():
    set_users_store(InMemoryUsersStore())
    auth_router._failures.clear()
    yield
    set_users_store(None)


def _signup(client, email="a@example.com", password="hunter2hunter2"):
    res = client.post("/auth/signup", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return res.json()


# ---- auth basics ------------------------------------------------------------


def test_signup_login_me_roundtrip(client):
    session = _signup(client)
    assert session["email"] == "a@example.com"

    login = client.post(
        "/auth/login", json={"email": "A@Example.com ", "password": "hunter2hunter2"}
    )
    assert login.status_code == 200
    assert login.json()["uid"] == session["uid"]

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {session['token']}"})
    assert me.status_code == 200
    assert me.json() == {"uid": session["uid"], "email": "a@example.com"}


def test_duplicate_email_conflicts(client):
    _signup(client)
    res = client.post(
        "/auth/signup", json={"email": "a@example.com", "password": "hunter2hunter2"}
    )
    assert res.status_code == 409


def test_signup_validation(client):
    assert client.post("/auth/signup", json={"email": "nope", "password": "hunter2hunter2"}).status_code == 422
    assert client.post("/auth/signup", json={"email": "b@example.com", "password": "short"}).status_code == 422


def test_wrong_password_401_and_throttles(client):
    _signup(client)
    for _ in range(10):
        res = client.post("/auth/login", json={"email": "a@example.com", "password": "wrong-wrong"})
        assert res.status_code == 401
    res = client.post("/auth/login", json={"email": "a@example.com", "password": "hunter2hunter2"})
    assert res.status_code == 429  # even the right password is throttled now


def test_garbage_token_rejected(client):
    assert client.get("/auth/me", headers={"Authorization": "Bearer nonsense"}).status_code == 401


# ---- tenant isolation through the API ---------------------------------------


def test_people_are_tenant_isolated(client):
    alice = _signup(client, "alice@example.com")
    bob = _signup(client, "bob@example.com")
    alice_auth = {"Authorization": f"Bearer {alice['token']}"}
    bob_auth = {"Authorization": f"Bearer {bob['token']}"}

    res = client.post("/refine/batch", json=make_batch_request(), headers=alice_auth)
    assert res.status_code == 200
    assert len(res.json()["people"]) == 1

    assert len(client.get("/people", headers=alice_auth).json()) == 1
    assert client.get("/people", headers=bob_auth).json() == []
    assert client.get("/people").json() == []  # no session -> '_default' tenant

    # Bob's delete-everything must not touch Alice
    assert client.delete("/data", headers=bob_auth).status_code == 200
    assert len(client.get("/people", headers=alice_auth).json()) == 1


def test_x_user_id_header_scopes_tenant(client):
    """The trusted web proxy forwards X-User-Id; it must scope stores the
    same way a session JWT does."""
    res = client.post(
        "/refine/batch", json=make_batch_request(), headers={"X-User-Id": "proxy-uid-1"}
    )
    assert res.status_code == 200
    assert len(client.get("/people", headers={"X-User-Id": "proxy-uid-1"}).json()) == 1
    assert client.get("/people", headers={"X-User-Id": "proxy-uid-2"}).json() == []


# ---- local disk store -------------------------------------------------------


def test_localdisk_store_persists_and_isolates(tmp_path, monkeypatch, store):
    monkeypatch.setattr(config, "LOCAL_STORE_DIR", str(tmp_path))
    disk = LocalDiskStore()

    from app.schemas import DistilledPerson

    row = DistilledPerson(
        tg_id=7,
        name="Disk Person",
        summary="s",
        work_relevant=True,
        why_relevant="w",
        closeness=50,
        msg_volume=10,
        run_id="r1",
        refined_at="2026-08-29T00:00:00+00:00",
    )

    token = tenant.set_uid("tenant-a")
    try:
        disk.upsert_people([row])
        assert [p.tg_id for p in disk.get_people()] == [7]
        assert [p.tg_id for p in LocalDiskStore().get_people()] == [7]  # fresh instance: persisted
    finally:
        tenant.reset_uid(token)

    token = tenant.set_uid("tenant-b")
    try:
        assert disk.get_people() == []  # other tenant sees nothing
        disk.delete_all()
    finally:
        tenant.reset_uid(token)

    token = tenant.set_uid("tenant-a")
    try:
        assert len(disk.get_people()) == 1  # b's wipe didn't touch a
    finally:
        tenant.reset_uid(token)


def test_delete_data_wipes_all_tenant_stores(client):
    """The privacy switch clears people, cards, jobs, pipeline, requests —
    for the calling tenant only."""
    from app.enrich_store import InMemoryEnrichStore, set_enrich_store
    from app.jobs_store import InMemoryJobsStore, set_jobs_store
    from app.requests_store import InMemoryRequestsStore, set_requests_store

    set_enrich_store(InMemoryEnrichStore())
    set_jobs_store(InMemoryJobsStore())
    set_requests_store(InMemoryRequestsStore())
    try:
        headers = {"X-User-Id": "wipe-me"}
        client.post("/refine/batch", json=make_batch_request(), headers=headers)
        client.post("/enrich/person", json={"tg_id": 42}, headers=headers)
        client.post("/requests", json={"query": "who should I meet?"}, headers=headers)
        assert len(client.get("/people", headers=headers).json()) == 1
        assert len(client.get("/enrichments", headers=headers).json()) == 1
        assert len(client.get("/requests", headers=headers).json()) == 1

        other = {"X-User-Id": "bystander"}
        client.post("/refine/batch", json=make_batch_request(), headers=other)

        assert client.delete("/data", headers=headers).json() == {"deleted": True}
        assert client.get("/people", headers=headers).json() == []
        assert client.get("/enrichments", headers=headers).json() == []
        assert client.get("/requests", headers=headers).json() == []
        assert len(client.get("/people", headers=other).json()) == 1  # untouched
    finally:
        set_enrich_store(None)
        set_jobs_store(None)
        set_requests_store(None)
