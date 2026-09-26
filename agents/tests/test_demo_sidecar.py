"""The demo-sidecar research path: fictional demo contacts resolve from
sample-data/demo-knowledge.json instead of a search, labelled
'demo-sidecar:' in telemetry (never 'fake:' or a real model id) — and the
path can never touch a contact outside the reserved demo id range.

Uses the committed sidecar itself so the test doubles as a contract check
on the generated demo data.
"""

from __future__ import annotations

from app import config
from app.agents import enrich
from app.demo_knowledge import DEMO_TG_ID_RANGE, demo_entry

PRIYA = 100000001          # C1 persona, employer stated in the chats
QUIET_EMIL = 100000011     # the namesake whose research finds the OTHER Emil
RESOLVED_HANDLE = 100000016  # blank name that public research resolves
ANON_HANDLE = 100000017      # blank name that stays unverified


def test_demo_contact_resolves_from_the_sidecar_with_the_demo_label():
    result = enrich.run_enrich_pipeline("Priya Raghunathan", "Coinbase", tg_id=PRIYA)
    assert result.model == f"demo-sidecar:{config.GEMINI_MODEL}"
    assert result.model.startswith(enrich.DEMO_SIDECAR_MODEL_PREFIX)
    assert not result.model.startswith("fake:")
    assert result.input_tokens == 0 and result.output_tokens == 0  # no model ran
    assert result.extract.identified
    assert result.extract.current_employer == "Coinbase"
    assert result.extract.linkedin_url is None  # fictional people: no profile URL
    assert result.citations and all(c.url.startswith("https://") for c in result.citations)
    verdict, _reason = enrich.compute_verdict(result.extract, "Coinbase")
    assert verdict == "match"


def test_on_search_done_still_fires_so_the_live_log_has_a_beat():
    seen: list[int] = []
    result = enrich.run_enrich_pipeline(
        "Priya Raghunathan", "Coinbase", on_search_done=seen.append, tg_id=PRIYA
    )
    assert seen == [len(result.citations)]


def test_ids_outside_the_reserved_range_never_use_the_sidecar():
    low, high = DEMO_TG_ID_RANGE
    assert low <= PRIYA <= high
    # same invented name, a real-looking id: the FAKE path answers, not the sidecar
    for tg_id in (1, low - 1, high + 1, 7_000_000_000):
        assert demo_entry(tg_id, "Priya Raghunathan") is None
        result = enrich.run_enrich_pipeline("Priya Raghunathan", "Coinbase", tg_id=tg_id)
        assert result.model.startswith("fake:")
    # no id at all (name-only callers) never reaches the sidecar path either
    assert enrich.demo_sidecar_result(None, "Priya Raghunathan") is None


def test_a_reserved_id_with_a_different_name_is_not_a_demo_contact():
    assert demo_entry(PRIYA, "Someone Else") is None
    result = enrich.run_enrich_pipeline("Someone Else", "Acme.io", tg_id=PRIYA)
    assert result.model.startswith("fake:")


def test_namesake_pair_yields_a_possible_mismatch_never_a_merge():
    result = enrich.run_enrich_pipeline("Emil Lindeberg", "Databricks", tg_id=QUIET_EMIL)
    assert result.model.startswith("demo-sidecar:")
    assert result.extract.current_employer == "Stripe"  # research found the other Emil
    verdict, reason = enrich.compute_verdict(result.extract, "Databricks")
    assert verdict == "possible_mismatch"
    assert "Stripe" in reason and "Databricks" in reason


def test_blank_name_resolves_to_a_public_name_from_the_sidecar():
    result = enrich.run_enrich_pipeline("", "Blockdaemon", tg_id=RESOLVED_HANDLE)
    assert result.model.startswith("demo-sidecar:")
    assert result.extract.identified
    assert result.extract.resolved_name == "Ronja Kaltenbach"
    assert enrich.compute_verdict(result.extract, "Blockdaemon")[0] == "match"


def test_unresolvable_contact_is_unverified_with_no_evidence():
    result = enrich.run_enrich_pipeline("", "Messari", tg_id=ANON_HANDLE)
    assert result.model.startswith("demo-sidecar:")
    assert not result.extract.identified
    assert result.citations == []
    assert result.extract.current_employer is None
    assert enrich.compute_verdict(result.extract, "Messari")[0] == "unverified"


# ---- through the API: the ActivityEntry is what the owner sees ---------------

import pytest

from app import enrich_store as enrich_store_module
from app.enrich_store import InMemoryEnrichStore
from app.schemas import DistilledPerson


@pytest.fixture()
def enrich_store(store):
    fresh = InMemoryEnrichStore()
    enrich_store_module.set_enrich_store(fresh)
    yield fresh
    enrich_store_module.set_enrich_store(None)


def _seed(store, tg_id: int, name: str, company: str) -> None:
    store.upsert_people([
        DistilledPerson(
            tg_id=tg_id, name=name, company_definite=company, role_guess="x",
            summary="demo seed", work_relevant=True, why_relevant="demo",
            closeness=80.0, msg_volume=100, last_contact="2026-09-01T12:00:00+00:00",
            run_id="seed-run", refined_at="2026-09-01T12:00:00+00:00",
        )
    ])


def test_api_labels_demo_research_as_demo_sidecar_never_as_a_search(client, store, enrich_store):
    _seed(store, PRIYA, "Priya Raghunathan", "Coinbase")
    card = client.post("/enrich/person", json={"tg_id": PRIYA}).json()
    assert card["verdict"] == "match"
    assert card["current_employer"] == "Coinbase"
    assert card["linkedin_url"] is None
    assert card["citations"]
    entries = [e for e in store.get_activity() if e.agent == "enrich"]
    assert len(entries) == 1
    assert entries[0].model == f"demo-sidecar:{config.GEMINI_MODEL}"
    assert entries[0].input_tokens == 0 and entries[0].output_tokens == 0
    assert entries[0].est_cost_usd == 0.0
    assert entries[0].status == "ok"


def test_api_flags_the_namesake_as_possible_mismatch_and_keeps_the_db_company(client, store, enrich_store):
    _seed(store, QUIET_EMIL, "Emil Lindeberg", "Databricks")
    card = client.post("/enrich/person", json={"tg_id": QUIET_EMIL}).json()
    assert card["verdict"] == "possible_mismatch"
    assert card["current_employer"] == "Stripe"
    assert card["db_company"] == "Databricks"
    person = next(p for p in store.get_people() if p.tg_id == QUIET_EMIL)
    assert person.company_definite == "Databricks"  # a mismatch never rewrites the company


def test_api_resolves_the_handle_only_row_to_its_public_name(client, store, enrich_store):
    _seed(store, RESOLVED_HANDLE, "", "Blockdaemon")
    card = client.post("/enrich/person", json={"tg_id": RESOLVED_HANDLE}).json()
    assert card["resolved_name"] == "Ronja Kaltenbach"
    assert card["verdict"] == "match"
    person = next(p for p in store.get_people() if p.tg_id == RESOLVED_HANDLE)
    assert person.name == "Ronja Kaltenbach"  # blank rows only — auto-applied in code


def test_api_keeps_the_anonymous_row_unverified(client, store, enrich_store):
    _seed(store, ANON_HANDLE, "", "Messari")
    card = client.post("/enrich/person", json={"tg_id": ANON_HANDLE}).json()
    assert card["verdict"] == "unverified"
    assert card["citations"] == []
    entries = [e for e in store.get_activity() if e.agent == "enrich"]
    assert entries[0].model.startswith("demo-sidecar:")
