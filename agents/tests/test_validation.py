"""Validation discipline: malformed output rejected with reasons, foreign
tg_ids dropped with reasons, closeness NEVER taken from the model."""

import json

from app.agents import refine_agent
from app.agents.refine_agent import UsageStats

from .conftest import make_batch_request


def test_malformed_model_output_rejects_whole_batch(client, store, monkeypatch):
    def bad_model(batch_text: str):
        return '{"people": [{"tg_id": "not-an-int"}]}', UsageStats(1, 1, "fake:test")

    monkeypatch.setattr(refine_agent, "fake_model_text", bad_model)

    response = client.post("/refine/batch", json=make_batch_request())
    assert response.status_code == 200
    body = response.json()
    assert body["people"] == []
    assert len(body["rejected"]) > 0
    assert all(item["reason"] for item in body["rejected"])
    assert body["activity"]["status"] == "rejected"
    # nothing persisted, but the rejection IS logged
    assert store.get_people() == []
    activity = store.get_activity("run-test-1")
    assert len(activity) == 1 and activity[0].status == "rejected"


def test_not_even_json_rejects_with_reason(client, monkeypatch):
    monkeypatch.setattr(
        refine_agent,
        "fake_model_text",
        lambda batch_text: ("total garbage, not json", UsageStats(1, 1, "fake:test")),
    )
    body = client.post("/refine/batch", json=make_batch_request()).json()
    assert body["people"] == []
    assert body["activity"]["status"] == "rejected"
    assert any("JSON" in item["reason"] for item in body["rejected"])


def test_tg_id_not_in_batch_dropped_with_reason(client, store, monkeypatch):
    def mixed_model(batch_text: str):
        person = {
            "tg_id": 42,
            "name": "Testy McTestface",
            "company_definite": None,
            "company_inferred": "ProtoLabs",
            "role_guess": "BD",
            "summary": "Old colleague.",
            "work_relevant": True,
            "why_relevant": "talked about the protocol launch",
        }
        stranger = {**person, "tg_id": 999, "name": "Hallucinated Harry"}
        return json.dumps({"people": [person, stranger]}), UsageStats(1, 1, "fake:test")

    monkeypatch.setattr(refine_agent, "fake_model_text", mixed_model)

    body = client.post("/refine/batch", json=make_batch_request()).json()
    assert body["activity"]["status"] == "ok"
    assert [p["tg_id"] for p in body["people"]] == [42]
    assert any(item["reason"] == "tg_id 999 not in batch" for item in body["rejected"])
    assert [p.tg_id for p in store.get_people()] == [42]


def test_closeness_comes_from_request_payload_not_model(client):
    """The stock fake model 'sneaks' closeness=99 into its JSON. The response
    must carry the request payload's code-computed closeness instead —
    proving the merge step never reads closeness from model output."""
    request = make_batch_request(closeness=73.0)
    body = client.post("/refine/batch", json=request).json()
    assert body["activity"]["status"] == "ok"
    assert len(body["people"]) == 1
    person = body["people"][0]
    assert person["closeness"] == 73.0  # payload value
    assert person["closeness"] != 99  # the model's sneak attempt
    # and the other code-merged fields also come from the payload
    assert person["msg_volume"] == 120 + 80
    assert person["last_contact"] == "2026-08-01T12:00:00+00:00"


def test_model_person_schema_has_no_closeness_field():
    from app.schemas import ModelPerson

    assert "closeness" not in ModelPerson.model_fields


def test_long_summary_hard_trimmed_with_reason(client, monkeypatch):
    def wordy_model(batch_text: str):
        person = {
            "tg_id": 42,
            "name": "Testy McTestface",
            "company_definite": None,
            "company_inferred": None,
            "role_guess": None,
            "summary": "line one\nline two\nline three\nline four",
            "work_relevant": True,
            "why_relevant": "evidence",
        }
        return json.dumps({"people": [person]}), UsageStats(1, 1, "fake:test")

    monkeypatch.setattr(refine_agent, "fake_model_text", wordy_model)

    body = client.post("/refine/batch", json=make_batch_request()).json()
    assert body["people"][0]["summary"] == "line one\nline two"
    assert any("trimmed to 2 lines" in item["reason"] for item in body["rejected"])
