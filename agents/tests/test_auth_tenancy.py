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
    assert me.json() == {"uid": session["uid"], "email": "a@example.com", "has_password": True}


def test_me_reports_has_password_false_for_google_only_accounts(client):
    from app.users import get_users_store, new_google_user

    google = new_google_user("g@example.com")
    get_users_store().create(google)
    token = auth_router.mint_token(google.uid, google.email)
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["has_password"] is False


def test_me_401_when_the_account_is_gone(client):
    """A cryptographically valid JWT for a uid that no longer exists is a
    dead session, not a user."""
    token = auth_router.mint_token("ghost-uid", "ghost@example.com")
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


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


# ---- delete account ---------------------------------------------------------


@pytest.fixture()
def fresh_stores(store):
    """Fresh in-memory twins of every tenant store, so a delete test sees
    exactly what it seeded (the module singletons persist across tests)."""
    from app.enrich_store import InMemoryEnrichStore, set_enrich_store
    from app.jobs_store import InMemoryJobsStore, set_jobs_store
    from app.pipeline_store import InMemoryPipelineStore, set_pipeline_store
    from app.requests_store import InMemoryRequestsStore, set_requests_store

    set_enrich_store(InMemoryEnrichStore())
    set_jobs_store(InMemoryJobsStore())
    set_pipeline_store(InMemoryPipelineStore())
    set_requests_store(InMemoryRequestsStore())
    yield
    set_enrich_store(None)
    set_jobs_store(None)
    set_pipeline_store(None)
    set_requests_store(None)


def _auth(session: dict) -> dict:
    return {"Authorization": f"Bearer {session['token']}"}


def _seed_tenant(client, headers: dict) -> None:
    """One row in people/activity, a research card, a tracked lead, an ask."""
    assert client.post("/refine/batch", json=make_batch_request(), headers=headers).status_code == 200
    assert client.post("/enrich/person", json={"tg_id": 42}, headers=headers).status_code == 200
    assert client.post("/pipeline", json={"tg_id": 42}, headers=headers).status_code == 200
    assert client.post("/requests", json={"query": "who should I meet?"}, headers=headers).status_code == 200


def _tenant_is_empty(client, headers: dict) -> bool:
    return all(
        client.get(path, headers=headers).json() == []
        for path in ("/people", "/activity", "/enrichments", "/pipeline", "/requests")
    )


def test_delete_account_requires_a_session(client):
    assert client.post("/auth/delete-account", json={"password": "hunter2hunter2"}).status_code == 401
    assert client.post(
        "/auth/delete-account", json={"password": "x"}, headers={"Authorization": "Bearer nonsense"}
    ).status_code == 401


def test_delete_account_password_account_reauth_401_and_throttles(client):
    session = _signup(client)
    headers = _auth(session)
    # missing password counts as wrong — and nothing is deleted
    assert client.post("/auth/delete-account", json={}, headers=headers).status_code == 401
    for _ in range(9):
        res = client.post("/auth/delete-account", json={"password": "wrong-wrong"}, headers=headers)
        assert res.status_code == 401
    # 10 failures: throttled like login, even with the right password
    res = client.post("/auth/delete-account", json={"password": "hunter2hunter2"}, headers=headers)
    assert res.status_code == 429
    assert client.get("/auth/me", headers=headers).status_code == 200  # still here


def test_delete_account_password_account_end_to_end(client, fresh_stores):
    alice = _signup(client, "alice@example.com")
    bob = _signup(client, "bob@example.com")
    _seed_tenant(client, _auth(alice))
    _seed_tenant(client, _auth(bob))

    res = client.post(
        "/auth/delete-account", json={"password": "hunter2hunter2"}, headers=_auth(alice)
    )
    assert res.status_code == 200, res.text
    assert res.json() == {"deleted": True}

    # the old JWT is dead everywhere an account is looked up
    assert client.get("/auth/me", headers=_auth(alice)).status_code == 401
    assert client.post(
        "/auth/change-password", json={"new_password": "hunter3hunter3"}, headers=_auth(alice)
    ).status_code == 401
    assert client.post(
        "/auth/delete-account", json={"password": "hunter2hunter2"}, headers=_auth(alice)
    ).status_code == 401
    # login fails: the record is gone (same message as unknown email)
    assert client.post(
        "/auth/login", json={"email": "alice@example.com", "password": "hunter2hunter2"}
    ).status_code == 401
    # the tenant's data is gone (probed via the trusted-proxy header path)
    assert _tenant_is_empty(client, {"X-User-Id": alice["uid"]})
    # the bystander is untouched, account and data alike
    assert client.get("/auth/me", headers=_auth(bob)).status_code == 200
    assert len(client.get("/people", headers=_auth(bob)).json()) == 1
    assert len(client.get("/pipeline", headers=_auth(bob)).json()) == 1
    # the email is registrable again — a NEW account with an empty tenant
    again = _signup(client, "alice@example.com")
    assert again["uid"] != alice["uid"]
    assert _tenant_is_empty(client, _auth(again))


def test_delete_account_google_only_requires_the_retyped_email(client, fresh_stores):
    from app.users import get_users_store, new_google_user

    google = new_google_user("goog@example.com")
    get_users_store().create(google)
    headers = {"Authorization": f"Bearer {auth_router.mint_token(google.uid, google.email)}"}
    _seed_tenant(client, headers)

    # no password to check — a retyped email is the re-auth, and it must match
    assert client.post("/auth/delete-account", json={}, headers=headers).status_code == 422
    assert client.post(
        "/auth/delete-account", json={"confirm_email": "other@example.com"}, headers=headers
    ).status_code == 422
    assert client.post(
        "/auth/delete-account", json={"password": "whatever-whatever"}, headers=headers
    ).status_code == 422
    assert client.get("/auth/me", headers=headers).status_code == 200  # nothing deleted yet

    res = client.post(
        "/auth/delete-account", json={"confirm_email": " Goog@Example.com "}, headers=headers
    )
    assert res.status_code == 200, res.text
    assert client.get("/auth/me", headers=headers).status_code == 401
    assert _tenant_is_empty(client, {"X-User-Id": google.uid})
    assert client.post(
        "/auth/signup", json={"email": "goog@example.com", "password": "hunter2hunter2"}
    ).status_code == 200


def test_delete_account_wipes_the_session_tenant_not_the_proxy_header(client, fresh_stores):
    """X-User-Id wins in the tenant middleware; delete-account must still
    bind the wipe to the SESSION's uid, never to a header-supplied one."""
    alice = _signup(client, "alice@example.com")
    _seed_tenant(client, _auth(alice))
    other = {"X-User-Id": "someone-else"}
    _seed_tenant(client, other)

    res = client.post(
        "/auth/delete-account",
        json={"password": "hunter2hunter2"},
        headers={**_auth(alice), **other},
    )
    assert res.status_code == 200, res.text
    assert _tenant_is_empty(client, {"X-User-Id": alice["uid"]})
    assert len(client.get("/people", headers=other).json()) == 1


def test_delete_account_localdisk_users_store(tmp_path, monkeypatch):
    """The disk twin: the record and its email go in one atomic rewrite, and
    the email is registrable again afterwards."""
    from app.users import LocalDiskUsersStore, new_user

    monkeypatch.setattr(config, "LOCAL_STORE_DIR", str(tmp_path))
    disk = LocalDiskUsersStore()
    user = new_user("disk@example.com", "hunter2hunter2")
    disk.create(user)
    assert disk.get_by_email("disk@example.com") is not None

    disk.delete(user.uid, user.email)
    assert disk.get_by_uid(user.uid) is None
    assert disk.get_by_email("disk@example.com") is None
    disk.delete(user.uid, user.email)  # idempotent
    disk.create(new_user("disk@example.com", "hunter2hunter2"))  # email free again
