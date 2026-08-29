"""/jobs/run end-to-end with InMemory stores + monkeypatched fetchers.

Two synthetic companies: AlphaPay (definite, has a verified slug, one fit +
one non-fit posting, two contacts ranked by closeness) and BetaChain
(inferred, no slug -> 'no_feed'). No live network anywhere.
"""

import pytest

from app import jobs_store as jobs_store_module
from app.jobs import ats
from app.jobs.ats import RawPosting
from app.jobs_store import AtsSlugRecord, InMemoryJobsStore
from app.schemas import DistilledPerson

PROFILE = {
    "targetRoles": ["BD lead", "partnerships", "ecosystem/growth lead", "GTM"],
    "industries": ["stablecoins & payments"],
    "seniority": ["senior", "lead", "head", "director"],
    "location": "remote EMEA or Lisbon",
}


@pytest.fixture()
def jobs_store():
    fresh = InMemoryJobsStore()
    jobs_store_module.set_jobs_store(fresh)
    yield fresh
    jobs_store_module.set_jobs_store(None)


def person(tg_id, name, closeness, definite=None, inferred=None) -> DistilledPerson:
    return DistilledPerson(
        tg_id=tg_id,
        name=name,
        company_definite=definite,
        company_inferred=inferred,
        role_guess=None,
        summary="synthetic",
        work_relevant=True,
        why_relevant="synthetic",
        closeness=closeness,
        msg_volume=10,
        last_contact=None,
        run_id="run-test-1",
        refined_at="2026-08-29T00:00:00+00:00",
    )


@pytest.fixture()
def seeded(client, store, jobs_store, monkeypatch, tmp_path):
    # people: two AlphaPay contacts (one definite, one inferred), one BetaChain
    store.upsert_people(
        [
            person(1, "Alice Alpha", 80.0, definite="AlphaPay Inc"),
            person(2, "Bob Alpha", 95.0, inferred="AlphaPay"),
            person(3, "Cara Beta", 50.0, inferred="BetaChain"),
        ]
    )
    # verified slug for alphapay only (store-sourced; repo file isolated away)
    jobs_store.upsert_slug(
        "alphapay",
        AtsSlugRecord(
            company="AlphaPay Inc",
            slug="alphapay",
            source="greenhouse",
            verified_at="2026-08-29T00:00:00+00:00",
        ),
    )
    monkeypatch.setenv("ATS_SLUGS_FILE", str(tmp_path / "missing.json"))

    fetch_calls = []

    async def fake_fetch(source, slug, client=None):
        fetch_calls.append((source, slug))
        assert (source, slug) == ("greenhouse", "alphapay")
        return [
            RawPosting(
                title="Senior Partnerships Manager",
                url="https://boards.greenhouse.io/alphapay/jobs/123",
                location="Remote - EMEA",
                posted_at="2026-08-20T00:00:00+00:00",
            ),
            RawPosting(
                title="Software Engineer",
                url="https://boards.greenhouse.io/alphapay/jobs/456",
                location="Lisbon",
                posted_at=None,
            ),
        ]

    monkeypatch.setattr(ats, "fetch_postings", fake_fetch)
    return client, store, jobs_store, fetch_calls


def test_jobs_run_summary_counts(seeded):
    client, store, jobs_store, fetch_calls = seeded
    response = client.post("/jobs/run", json={"profile": PROFILE})
    assert response.status_code == 200
    summary = response.json()
    assert summary["companies_total"] == 2
    assert summary["companies_with_slug"] == 1
    assert summary["postings_total"] == 2
    assert summary["postings_fit"] == 1
    assert summary["status"] == "done"
    assert summary["run_id"].startswith("jobs-")
    assert fetch_calls == [("greenhouse", "alphapay")]

    # run doc lists the slug-less company as no_feed
    run_doc = jobs_store._runs[summary["run_id"]]
    assert run_doc["no_feed"] == ["BetaChain"]


def test_jobs_run_postings_contacts_ranked_and_fit_computed(seeded):
    client, _, jobs_store, _ = seeded
    client.post("/jobs/run", json={"profile": PROFILE})

    postings = {p.id: p for p in jobs_store.get_postings()}
    fit = postings["greenhouse:alphapay:123"]
    assert fit.role_fit is True
    assert fit.company == "AlphaPay Inc"
    assert any("partnerships" in r for r in fit.fit_reasons)
    assert any("senior" in r for r in fit.fit_reasons)
    # contacts joined from people, ranked by closeness desc (definite AND
    # inferred rows for the same normalized company both join)
    assert [(c.tg_id, c.closeness) for c in fit.contacts] == [(2, 95.0), (1, 80.0)]

    nonfit = postings["greenhouse:alphapay:456"]
    assert nonfit.role_fit is False
    assert any("no target-role keyword" in r for r in nonfit.fit_reasons)


def test_get_jobs_fit_filter_and_summary_endpoint(seeded):
    client, _, _, _ = seeded
    run_summary = client.post("/jobs/run", json={"profile": PROFILE}).json()

    assert len(client.get("/jobs").json()) == 2
    fit_only = client.get("/jobs", params={"fit": 1}).json()
    assert len(fit_only) == 1
    assert fit_only[0]["title"] == "Senior Partnerships Manager"

    latest = client.get("/jobs/summary").json()
    assert latest["run_id"] == run_summary["run_id"]


def test_jobs_summary_404_before_any_run(client, jobs_store):
    assert client.get("/jobs/summary").status_code == 404


def test_jobs_run_logs_exactly_one_activity_entry(seeded):
    client, store, _, _ = seeded
    summary = client.post("/jobs/run", json={"profile": PROFILE}).json()

    entries = [e for e in store.get_activity() if e.agent == "jobscout"]
    assert len(entries) == 1
    entry = entries[0]
    assert entry.model == "-"
    assert entry.run_id == summary["run_id"]
    assert entry.input_tokens == 0 and entry.output_tokens == 0
    assert entry.est_cost_usd == 0.0
    assert entry.status == "ok"
    assert "no_feed 1" in entry.detail
    assert "fit 1" in entry.detail


def test_fetch_failure_counts_company_but_no_postings(client, store, jobs_store, monkeypatch, tmp_path):
    store.upsert_people([person(1, "Alice Alpha", 80.0, definite="AlphaPay Inc")])
    jobs_store.upsert_slug(
        "alphapay",
        AtsSlugRecord(company="AlphaPay Inc", slug="alphapay", source="lever",
                      verified_at="2026-08-29T00:00:00+00:00"),
    )
    monkeypatch.setenv("ATS_SLUGS_FILE", str(tmp_path / "missing.json"))

    async def dead_fetch(source, slug, client=None):
        return None  # feed vanished / timeout

    monkeypatch.setattr(ats, "fetch_postings", dead_fetch)
    summary = client.post("/jobs/run", json={"profile": PROFILE}).json()
    assert summary["companies_with_slug"] == 1
    assert summary["postings_total"] == 0
    entries = [e for e in store.get_activity() if e.agent == "jobscout"]
    assert "fetch_failed 1" in entries[0].detail


def test_repo_slugs_file_wins_on_conflict(client, store, jobs_store, monkeypatch, tmp_path):
    import json as jsonlib

    store.upsert_people([person(1, "Alice Alpha", 80.0, definite="AlphaPay Inc")])
    jobs_store.upsert_slug(
        "alphapay",
        AtsSlugRecord(company="AlphaPay Inc", slug="stale-slug", source="lever",
                      verified_at="2026-08-01T00:00:00+00:00"),
    )
    repo_file = tmp_path / "ats-slugs.json"
    repo_file.write_text(jsonlib.dumps({
        "alphapay": {"company": "AlphaPay Inc", "slug": "alphapay", "source": "greenhouse",
                     "verified_at": "2026-08-29T00:00:00+00:00"}
    }))
    monkeypatch.setenv("ATS_SLUGS_FILE", str(repo_file))

    calls = []

    async def fake_fetch(source, slug, client=None):
        calls.append((source, slug))
        return []

    monkeypatch.setattr(ats, "fetch_postings", fake_fetch)
    client.post("/jobs/run", json={"profile": PROFILE})
    assert calls == [("greenhouse", "alphapay")]  # repo file won
