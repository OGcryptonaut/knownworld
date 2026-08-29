"""API surface: healthz, refine happy path, people, activity, delete."""

from app import config
from app.agents.refine_agent import FAKE_INPUT_TOKENS, FAKE_OUTPUT_TOKENS

from .conftest import make_batch_request


def test_healthz_reports_model_and_flags(client):
    body = client.get("/healthz").json()
    assert body["status"] == "ok"
    assert body["model"] == config.GEMINI_MODEL
    assert body["fake"] is True
    assert isinstance(body["vertex"], bool)


def test_refine_batch_happy_path_persists_and_logs(client, store):
    response = client.post("/refine/batch", json=make_batch_request())
    assert response.status_code == 200
    body = response.json()

    # people: canned fake echoes the first chat, definite company FakeCorp
    assert len(body["people"]) == 1
    person = body["people"][0]
    assert person["tg_id"] == 42
    assert person["name"] == "Testy McTestface"
    assert person["company_definite"] == "FakeCorp"
    assert person["run_id"] == "run-test-1"
    assert person["refined_at"]
    assert len(person["summary"].splitlines()) <= 2

    # activity: model + tokens + cost + duration logged
    activity = body["activity"]
    assert activity["agent"] == "refine"
    assert activity["model"].startswith("fake:")
    assert activity["input_tokens"] == FAKE_INPUT_TOKENS
    assert activity["output_tokens"] == FAKE_OUTPUT_TOKENS
    assert activity["est_cost_usd"] >= 0
    assert activity["duration_ms"] >= 0
    assert activity["status"] == "ok"
    assert activity["batch_index"] == 0

    # persisted
    stored_people = store.get_people()
    assert [p.tg_id for p in stored_people] == [42]
    assert store.get_activity()[0].status == "ok"


def test_get_people_returns_persisted_rows(client):
    client.post("/refine/batch", json=make_batch_request())
    people = client.get("/people").json()
    assert len(people) == 1
    assert people[0]["tg_id"] == 42


def test_get_activity_filters_by_run_id(client):
    client.post("/refine/batch", json=make_batch_request())
    assert len(client.get("/activity").json()) == 1
    assert len(client.get("/activity", params={"run_id": "run-test-1"}).json()) == 1
    assert client.get("/activity", params={"run_id": "other-run"}).json() == []


def test_delete_data_wipes_everything(client):
    client.post("/refine/batch", json=make_batch_request())
    assert client.get("/people").json()

    response = client.delete("/data")
    assert response.json() == {"deleted": True}
    assert client.get("/people").json() == []
    assert client.get("/activity").json() == []


def test_bearer_middleware_accepts_x_agents_token(monkeypatch):
    """Cloud Tasks overwrites Authorization when OIDC is set, so the app
    token must also be honored from X-Agents-Token."""
    import importlib

    monkeypatch.setenv("AGENTS_API_TOKEN", "tok123")
    monkeypatch.setenv("FAKE_LLM", "1")
    from app import config as cfg
    importlib.reload(cfg)
    from app import main as mainmod
    importlib.reload(mainmod)
    from fastapi.testclient import TestClient

    client = TestClient(mainmod.app)
    assert client.get("/people").status_code == 401
    assert client.get("/people", headers={"X-Agents-Token": "tok123"}).status_code == 200
    assert client.get("/people", headers={"Authorization": "Bearer tok123"}).status_code == 200
    assert client.get("/health").status_code == 200
    monkeypatch.delenv("AGENTS_API_TOKEN")
    importlib.reload(cfg)
    importlib.reload(mainmod)
