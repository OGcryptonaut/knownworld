"""D3 outreach draft + pipeline endpoints in FAKE mode with in-memory stores
— no GCP anywhere. All test data is synthetic — invented names only."""

import pytest

from app import jobs_store as jobs_store_module
from app import pipeline_store as pipeline_store_module
from app.agents import drafter as drafter_agent
from app.agents.drafter import FAKE_DRAFT_INPUT_TOKENS, FAKE_DRAFT_OUTPUT_TOKENS
from app.agents.refine_agent import ModelOutputInvalid
from app.jobs_store import InMemoryJobsStore, JobPosting
from app.outreach_router import NAMELESS_DETAIL
from app.pipeline_store import InMemoryPipelineStore
from app.schemas import DistilledPerson
from app.store import InMemoryStore

JOB_ID = "greenhouse:alphapay:123"


@pytest.fixture()
def jobs_store():
    fresh = InMemoryJobsStore()
    jobs_store_module.set_jobs_store(fresh)
    yield fresh
    jobs_store_module.set_jobs_store(None)


@pytest.fixture()
def pipeline_store():
    fresh = InMemoryPipelineStore()
    pipeline_store_module.set_pipeline_store(fresh)
    yield fresh
    pipeline_store_module.set_pipeline_store(None)


def seed_person(
    store: InMemoryStore,
    tg_id: int = 42,
    name: str = "Testy McTestface",
    company_definite: str | None = "AlphaPay Inc",
    company_inferred: str | None = None,
    closeness: float = 80.0,
) -> DistilledPerson:
    person = DistilledPerson(
        tg_id=tg_id,
        name=name,
        company_definite=company_definite,
        company_inferred=company_inferred,
        role_guess="Founder",
        summary="Old coworking buddies from the fake accelerator.\nRuns BD at AlphaPay.",
        work_relevant=True,
        why_relevant="seeded for tests",
        closeness=closeness,
        msg_volume=100,
        last_contact="2026-08-01T12:00:00+00:00",
        run_id="seed-run",
        refined_at="2026-08-01T12:00:00+00:00",
    )
    store.upsert_people([person])
    return person


def seed_job(
    jobs_store: InMemoryJobsStore,
    job_id: str = JOB_ID,
    company: str = "AlphaPay",
    title: str = "Head of Partnerships",
) -> JobPosting:
    posting = JobPosting(
        id=job_id,
        company=company,
        slug="alphapay",
        source="greenhouse",
        title=title,
        location="Remote EMEA",
        url="https://boards.greenhouse.io/alphapay/jobs/123",
        role_fit=True,
        fit_reasons=["target role"],
        posted_at=None,
        fetched_at="2026-08-29T00:00:00+00:00",
        contacts=[],
    )
    jobs_store.upsert_postings([posting])
    return posting


# ---- POST /outreach/draft ---------------------------------------------------


def test_draft_happy_path_grounded_and_logged(client, store, jobs_store):
    person = seed_person(store)
    job = seed_job(jobs_store)

    response = client.post("/outreach/draft", json={"tg_id": 42, "job_id": JOB_ID})
    assert response.status_code == 200
    body = response.json()

    # message: non-empty, echoes role + company (fake path), no placeholders
    assert body["message"].strip()
    assert job.title in body["message"]
    assert job.company in body["message"]
    assert "[" not in body["message"]

    # grounded_on: exactly the distilled inputs — summary, closeness, role
    assert body["grounded_on"] == {
        "summary": person.summary,
        "closeness": person.closeness,
        "title": job.title,
        "company": job.company,
    }

    # telemetry: one 'drafter' entry with fixed fake tokens + the detail line
    entries = [e for e in store.get_activity() if e.agent == "drafter"]
    assert len(entries) == 1
    activity = entries[0]
    assert activity.status == "ok"
    assert activity.model.startswith("fake:")
    assert activity.input_tokens == FAKE_DRAFT_INPUT_TOKENS
    assert activity.output_tokens == FAKE_DRAFT_OUTPUT_TOKENS
    assert "draft for tg 42 re AlphaPay" in activity.detail
    assert activity.duration_ms >= 0
    assert body["activity"]["run_id"] == activity.run_id


def test_draft_closeness_tiers_change_tone(client, store, jobs_store):
    seed_job(jobs_store)
    seed_person(store, tg_id=1, name="Warm Wanda", closeness=85.0)
    seed_person(store, tg_id=2, name="Mid Mindy", closeness=45.0)
    seed_person(store, tg_id=3, name="Cold Colin", closeness=10.0)

    warm = client.post("/outreach/draft", json={"tg_id": 1, "job_id": JOB_ID}).json()
    mid = client.post("/outreach/draft", json={"tg_id": 2, "job_id": JOB_ID}).json()
    cold = client.post("/outreach/draft", json={"tg_id": 3, "job_id": JOB_ID}).json()

    assert warm["message"].startswith("Hey Warm!")
    assert mid["message"].startswith("Hey Mid,")
    assert cold["message"].startswith("Hi Cold, it's been a while")


def test_draft_nameless_contact_422(client, store, jobs_store):
    seed_person(store, tg_id=7, name="   ")
    seed_job(jobs_store)
    response = client.post("/outreach/draft", json={"tg_id": 7, "job_id": JOB_ID})
    assert response.status_code == 422
    assert response.json()["detail"] == NAMELESS_DETAIL
    # nothing drafted, nothing logged
    assert [e for e in store.get_activity() if e.agent == "drafter"] == []


def test_draft_unknown_person_404(client, store, jobs_store):
    seed_job(jobs_store)
    assert client.post("/outreach/draft", json={"tg_id": 999, "job_id": JOB_ID}).status_code == 404


def test_draft_unknown_job_404(client, store, jobs_store):
    seed_person(store)
    response = client.post("/outreach/draft", json={"tg_id": 42, "job_id": "lever:nope:0"})
    assert response.status_code == 404
    assert "lever:nope:0" in response.json()["detail"]


def test_draft_malformed_output_422_with_reasons_and_rejected_activity(
    client, store, jobs_store, monkeypatch
):
    seed_person(store)
    seed_job(jobs_store)

    def boom(**kwargs):
        raise ModelOutputInvalid(["message: draft contains placeholder brackets"])

    monkeypatch.setattr(drafter_agent, "run_draft", boom)
    response = client.post("/outreach/draft", json={"tg_id": 42, "job_id": JOB_ID})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["rejected"] is True
    assert detail["reasons"] == ["message: draft contains placeholder brackets"]

    entries = [e for e in store.get_activity() if e.agent == "drafter"]
    assert len(entries) == 1
    assert entries[0].status == "rejected"
    assert "1 reason(s)" in entries[0].detail


def test_parse_draft_rejects_placeholders_and_blank():
    with pytest.raises(ModelOutputInvalid):
        drafter_agent.parse_draft('{"message": "Hi [Name], saw a role at [Company]."}')
    with pytest.raises(ModelOutputInvalid):
        drafter_agent.parse_draft('{"message": "   "}')
    with pytest.raises(ModelOutputInvalid):
        drafter_agent.parse_draft("not json at all")


# ---- /pipeline --------------------------------------------------------------


def test_pipeline_create_get_patch_stage_walk(client, store, jobs_store, pipeline_store):
    seed_person(store)
    job = seed_job(jobs_store)

    created = client.post("/pipeline", json={"tg_id": 42, "job_id": JOB_ID})
    assert created.status_code == 200
    item = created.json()
    assert item["stage"] == "lead"
    assert item["contact_name"] == "Testy McTestface"
    assert item["company"] == job.company
    assert item["job_id"] == JOB_ID
    assert item["job_title"] == job.title
    assert item["job_url"] == job.url
    assert item["note"] == ""
    assert item["created_at"] == item["updated_at"]

    listed = client.get("/pipeline").json()
    assert [i["id"] for i in listed] == [item["id"]]

    # stage walk: lead -> outreach -> referred, updated_at bumps
    for stage in ("outreach", "referred"):
        patched = client.patch(f"/pipeline/{item['id']}", json={"stage": stage})
        assert patched.status_code == 200
        assert patched.json()["stage"] == stage
        assert patched.json()["updated_at"] >= item["created_at"]
    assert pipeline_store.get(item["id"]).stage == "referred"


def test_pipeline_create_without_job_uses_person_company(
    client, store, pipeline_store
):
    seed_person(store, tg_id=8, name="Inferred Irene", company_definite=None,
                company_inferred="BetaChain")
    seed_person(store, tg_id=9, name="Companyless Carl", company_definite=None,
                company_inferred=None)

    a = client.post("/pipeline", json={"tg_id": 8}).json()
    assert a["company"] == "BetaChain"
    assert a["job_id"] is None and a["job_title"] is None and a["job_url"] is None

    b = client.post("/pipeline", json={"tg_id": 9}).json()
    assert b["company"] == "?"


def test_pipeline_create_nameless_contact_422(client, store, pipeline_store):
    seed_person(store, tg_id=7, name="")
    response = client.post("/pipeline", json={"tg_id": 7})
    assert response.status_code == 422
    assert response.json()["detail"] == NAMELESS_DETAIL


def test_pipeline_invalid_stage_rejected(client, store, jobs_store, pipeline_store):
    seed_person(store)
    bad_create = client.post("/pipeline", json={"tg_id": 42, "stage": "won"})
    assert bad_create.status_code == 422
    assert "invalid stage 'won'" in bad_create.json()["detail"]

    ok = client.post("/pipeline", json={"tg_id": 42}).json()
    bad_patch = client.patch(f"/pipeline/{ok['id']}", json={"stage": "bogus"})
    assert bad_patch.status_code == 422
    # untouched
    assert pipeline_store.get(ok["id"]).stage == "lead"


def test_pipeline_follow_up_date_roundtrip(client, store, pipeline_store):
    seed_person(store)
    created = client.post(
        "/pipeline", json={"tg_id": 42, "follow_up_date": "2026-09-15"}
    ).json()
    assert created["follow_up_date"] == "2026-09-15"

    listed = client.get("/pipeline").json()
    assert listed[0]["follow_up_date"] == "2026-09-15"

    patched = client.patch(
        f"/pipeline/{created['id']}", json={"follow_up_date": "2026-10-01"}
    ).json()
    assert patched["follow_up_date"] == "2026-10-01"

    cleared = client.patch(
        f"/pipeline/{created['id']}", json={"follow_up_date": None}
    ).json()
    assert cleared["follow_up_date"] is None


def test_pipeline_patch_unknown_id_404(client, store, pipeline_store):
    assert client.patch("/pipeline/deadbeef", json={"note": "x"}).status_code == 404


def test_draft_then_pipeline_persists_draft_message(
    client, store, jobs_store, pipeline_store
):
    """The real flow: draft for the selected contact+role, then file the
    pipeline item carrying that copy-out draft."""
    seed_person(store)
    seed_job(jobs_store)

    draft = client.post("/outreach/draft", json={"tg_id": 42, "job_id": JOB_ID}).json()
    item = client.post(
        "/pipeline",
        json={
            "tg_id": 42,
            "job_id": JOB_ID,
            "stage": "outreach",
            "draft_message": draft["message"],
        },
    ).json()

    assert item["stage"] == "outreach"
    assert item["draft_message"] == draft["message"]
    stored = pipeline_store.get(item["id"])
    assert stored.draft_message == draft["message"]
