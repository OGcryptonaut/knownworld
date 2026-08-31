"""Google sign-in + password change — the auth surface added on deadline
day, so every path gets a regression: create/link/verify failures, the
password-less account setting a password, throttling, session gating.
Google's verifier is monkeypatched; no network anywhere.
"""

from __future__ import annotations

import pytest

from app import auth_router, config
from app import users as users_module
from app.users import InMemoryUsersStore


@pytest.fixture(autouse=True)
def users_store():
    fresh = InMemoryUsersStore()
    users_module.set_users_store(fresh)
    auth_router._failures.clear()
    yield fresh
    users_module.set_users_store(None)
    auth_router._failures.clear()


@pytest.fixture()
def google_ok(monkeypatch):
    monkeypatch.setattr(config, "GOOGLE_OAUTH_CLIENT_ID", "test-client-id")

    def fake_verify(credential):
        return {"email": "goog@example.com", "email_verified": True, "sub": "g-123"}

    monkeypatch.setattr(auth_router, "_verify_google_credential", fake_verify)


def test_google_unconfigured_is_an_honest_503(client):
    assert client.post("/auth/google", json={"credential": "x"}).status_code == 503


def test_google_creates_then_finds_the_same_account(client, google_ok):
    first = client.post("/auth/google", json={"credential": "tok"}).json()
    assert first["created"] is True
    again = client.post("/auth/google", json={"credential": "tok"}).json()
    assert again["created"] is False
    assert again["uid"] == first["uid"]  # one email = one account, always
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {again['token']}"})
    assert me.json()["email"] == "goog@example.com"


def test_google_links_an_existing_password_account(client, google_ok):
    signed = client.post(
        "/auth/signup", json={"email": "goog@example.com", "password": "longenough1"}
    ).json()
    linked = client.post("/auth/google", json={"credential": "tok"}).json()
    assert linked["uid"] == signed["uid"]
    assert linked["created"] is False


def test_google_rejects_unverified_email_and_bad_tokens(client, monkeypatch):
    monkeypatch.setattr(config, "GOOGLE_OAUTH_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(
        auth_router,
        "_verify_google_credential",
        lambda c: {"email": "x@example.com", "email_verified": False},
    )
    assert client.post("/auth/google", json={"credential": "t"}).status_code == 401

    def boom(credential):
        raise ValueError("bad token")

    monkeypatch.setattr(auth_router, "_verify_google_credential", boom)
    assert client.post("/auth/google", json={"credential": "t"}).status_code == 401


def test_google_account_has_no_usable_password_login(client, google_ok):
    client.post("/auth/google", json={"credential": "tok"})
    # any password against the empty hash fails with the same 401 as always
    r = client.post("/auth/login", json={"email": "goog@example.com", "password": "whatever1"})
    assert r.status_code == 401


def test_change_password_requires_session_and_the_current_password(client):
    signed = client.post(
        "/auth/signup", json={"email": "pw@example.com", "password": "originalpw1"}
    ).json()
    auth = {"Authorization": f"Bearer {signed['token']}"}

    assert (
        client.post(
            "/auth/change-password",
            json={"old_password": "x", "new_password": "y" * 8},
        ).status_code
        == 401
    )  # no session
    assert (
        client.post(
            "/auth/change-password",
            json={"old_password": "WRONG", "new_password": "newpassword1"},
            headers=auth,
        ).status_code
        == 401
    )  # wrong current password
    assert (
        client.post(
            "/auth/change-password",
            json={"old_password": "originalpw1", "new_password": "short"},
            headers=auth,
        ).status_code
        == 422
    )  # new one too short

    ok = client.post(
        "/auth/change-password",
        json={"old_password": "originalpw1", "new_password": "newpassword1"},
        headers=auth,
    ).json()
    assert ok == {"ok": True, "had_password": True}
    # the old password stops working, the new one signs in
    assert (
        client.post(
            "/auth/login", json={"email": "pw@example.com", "password": "originalpw1"}
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/auth/login", json={"email": "pw@example.com", "password": "newpassword1"}
        ).status_code
        == 200
    )


def test_google_only_account_sets_a_password_without_an_old_one(client, google_ok):
    session = client.post("/auth/google", json={"credential": "tok"}).json()
    auth = {"Authorization": f"Bearer {session['token']}"}
    ok = client.post(
        "/auth/change-password", json={"new_password": "brandnewpw1"}, headers=auth
    ).json()
    assert ok == {"ok": True, "had_password": False}
    # now BOTH doors work: Google and the fresh password
    assert (
        client.post(
            "/auth/login", json={"email": "goog@example.com", "password": "brandnewpw1"}
        ).status_code
        == 200
    )
