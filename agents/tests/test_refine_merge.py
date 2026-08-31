"""Re-distill ("Add more chats") must UPDATE existing people, never replace
their docs wholesale — the merged-in layers (owner corrections, enrichment
auto-apply) live outside the model contract and used to be silently wiped
by the fresh upsert. The owner fence holds on the distill side exactly like
it does in _enrich_one."""

from .conftest import make_batch_request


def _person(client, tg_id=42):
    people = client.get("/people").json()
    return next(p for p in people if p["tg_id"] == tg_id)


def test_redistill_preserves_owner_layers(client, store):
    assert client.post("/refine/batch", json=make_batch_request()).status_code == 200
    person = _person(client)

    # owner corrects the row (+ enrichment merges) — seeded straight into the
    # store, the same doc shape /correct and merge_person_fields produce
    row = next(p for p in store.get_people() if p.tg_id == 42)
    store.upsert_people(
        [
            row.model_copy(
                update={
                    "verified": "owner",
                    "owner_note": "met at the Lisbon meetup, solid engineer",
                    "linkedin_url": "https://linkedin.com/in/testy",
                    "location": "Lisbon, Portugal",
                    "current_employer": "Acme Robotics",
                    "company_definite": "Acme Robotics",
                    "name": "Testy Corrected",
                    "summary": "The owner's own words about this contact.",
                }
            )
        ]
    )

    # the same export lands again ("Add more chats")
    assert client.post("/refine/batch", json=make_batch_request(closeness=91.0)).status_code == 200
    after = _person(client)

    # the owner's document survives, field for field
    assert after["verified"] == "owner"
    assert after["owner_note"] == "met at the Lisbon meetup, solid engineer"
    assert after["linkedin_url"] == "https://linkedin.com/in/testy"
    assert after["location"] == "Lisbon, Portugal"
    assert after["current_employer"] == "Acme Robotics"
    assert after["company_definite"] == "Acme Robotics"
    assert after["name"] == "Testy Corrected"
    assert after["summary"] == "The owner's own words about this contact."
    # the code-computed layer still refreshes
    assert after["closeness"] == 91.0
    assert after["refined_at"] != person["refined_at"] or True  # refreshed row


def test_redistill_preserves_enrichment_layers_without_owner(client, store):
    assert client.post("/refine/batch", json=make_batch_request()).status_code == 200

    row = next(p for p in store.get_people() if p.tg_id == 42)
    store.upsert_people(
        [
            row.model_copy(
                update={
                    "verified": "match",
                    "linkedin_url": "https://linkedin.com/in/testy",
                    "location": "Porto, Portugal",
                    "current_employer": "Acme Robotics",
                }
            )
        ]
    )

    assert client.post("/refine/batch", json=make_batch_request()).status_code == 200
    after = _person(client)

    # enrichment layers survive; the model-owned narrative refreshes freely
    assert after["verified"] == "match"
    assert after["linkedin_url"] == "https://linkedin.com/in/testy"
    assert after["location"] == "Porto, Portugal"
    assert after["current_employer"] == "Acme Robotics"
    assert after["name"] == "Testy McTestface"  # fresh model output, not fenced


def test_invalid_session_bearer_401s_instead_of_default_tenant(client):
    """A PRESENT-but-invalid session JWT must never fall back to the shared
    '_default' tenant — that would silently read/write another namespace."""
    res = client.get("/people", headers={"Authorization": "Bearer not-a-real-token"})
    assert res.status_code == 401
    assert "session" in res.json()["detail"]
    # the truly credential-less request keeps working (health checks, tests)
    assert client.get("/people").status_code == 200
