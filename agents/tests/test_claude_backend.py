"""Dev-only Claude backend: routing + JSON discipline. No network — the
Anthropic client is stubbed. The contract under test: MODEL_BACKEND=claude
routes every agent through claude_backend, output re-enters the SAME
validators as Gemini output, and the default backend stays 'gemini'
(hackathon mandate; deploy.sh refuses 'claude').
"""

from __future__ import annotations

import json

import pytest

from app import config
from app.agents import claude_backend, planner, refine_agent
from app.agents.refine_agent import ModelOutputInvalid, RefineModelOutput


class _StubParsed:
    def __init__(self, payload: dict):
        self._payload = payload

    def model_dump_json(self) -> str:
        return json.dumps(self._payload)


class _StubUsage:
    input_tokens = 111
    output_tokens = 22


class _StubResponse:
    def __init__(self, payload: dict):
        self.parsed_output = _StubParsed(payload)
        self.usage = _StubUsage()
        self.model = "claude-haiku-4-5"


class _StubMessages:
    def __init__(self, payload: dict):
        self._payload = payload
        self.last_kwargs: dict | None = None

    def parse(self, **kwargs):
        self.last_kwargs = kwargs
        return _StubResponse(self._payload)


class _StubClient:
    def __init__(self, payload: dict):
        self.messages = _StubMessages(payload)


@pytest.fixture()
def claude_mode(monkeypatch):
    monkeypatch.setattr(config, "FAKE_LLM", False)
    monkeypatch.setattr(config, "MODEL_BACKEND", "claude")
    yield
    claude_backend._client_cache = None


def test_default_backend_is_gemini():
    """The mandate: nothing but an explicit env opt-in selects Claude."""
    assert config.MODEL_BACKEND in ("gemini", "claude")
    import os

    if "MODEL_BACKEND" not in os.environ:
        assert config.MODEL_BACKEND == "gemini"


def test_refine_routes_through_claude(claude_mode, monkeypatch):
    payload = {
        "people": [
            {
                "tg_id": 7,
                "name": "Stub Person",
                "company_definite": "StubCo",
                "company_inferred": None,
                "role_guess": "BD",
                "summary": "one line",
                "work_relevant": True,
                "why_relevant": "stub",
            }
        ]
    }
    stub = _StubClient(payload)
    monkeypatch.setattr(claude_backend, "_client", lambda: stub)

    output, usage = refine_agent.run_refine_model("#chat tg_id=7 name=Stub Person")
    assert isinstance(output, RefineModelOutput)
    assert output.people[0].tg_id == 7
    assert usage.model == "claude-haiku-4-5"
    assert usage.input_tokens == 111
    # schema went to messages.parse; the shared instruction rode as system
    assert stub.messages.last_kwargs["output_format"] is RefineModelOutput
    assert stub.messages.last_kwargs["system"] == refine_agent.REFINE_INSTRUCTION


def test_planner_routes_through_claude(claude_mode, monkeypatch):
    stub = _StubClient({"intent": "people", "roles": [], "days": None,
                        "location": "New York", "note": "stub note"})
    monkeypatch.setattr(claude_backend, "_client", lambda: stub)
    plan, usage = planner.plan_request("who should I meet in NY?")
    assert plan.intent == "people"
    assert plan.location == "New York"
    assert usage.output_tokens == 22


def test_invalid_payload_still_rejected_with_reasons(claude_mode, monkeypatch):
    """Even via Claude, output passes the SAME validators — a payload that
    violates the contract rejects with reasons, never silently patched."""
    stub = _StubClient({"intent": "nonsense", "note": "bad"})
    monkeypatch.setattr(claude_backend, "_client", lambda: stub)
    with pytest.raises(ModelOutputInvalid) as excinfo:
        planner.plan_request("anything")
    assert any("intent" in reason for reason in excinfo.value.reasons)
