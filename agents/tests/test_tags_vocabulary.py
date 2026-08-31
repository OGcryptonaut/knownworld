"""app/tags.py — the research-tag vocabulary: canonical funnel, reuse-first
resolution, inheritance across imports, FAKE determinism through the API.
"""

from __future__ import annotations

from app.tags import (
    MAX_TAGS,
    SEED_TAGS,
    assign_tags,
    canonical,
    derive_seed_tags,
    resolve,
    vocabulary_block,
)


def test_canonical_collapses_variants_to_one_form():
    assert canonical("AI/ML") == "ai-ml"
    assert canonical("  Artificial  Intelligence ") == "artificial-intelligence"
    assert canonical("Web3 & DeFi") == "web3-defi"
    assert canonical("Café Économie") == "cafe-economie"  # unicode folded
    assert canonical("") == ""


def test_resolve_collapses_aliases_into_seed_slugs():
    assert resolve("Artificial Intelligence", set(SEED_TAGS)) == "ai"
    assert resolve("AI/ML", set(SEED_TAGS)) == "ai"
    assert resolve("Machine Learning", set(SEED_TAGS)) == "ai"
    assert resolve("VC", set(SEED_TAGS)) == "investor"
    assert resolve("Business Development", set(SEED_TAGS)) == "bizdev"
    # tenant-grown vocabulary resolves too
    assert resolve("Space Tech", set(SEED_TAGS) | {"space-tech"}) == "space-tech"
    assert resolve("underwater basket weaving", set(SEED_TAGS)) is None


def test_assign_tags_reuses_creates_and_drops_with_counts():
    final, stats = assign_tags(
        ["AI/ML", "Machine Learning", "Space Tech", "x" * 40, "founder"],
        set(SEED_TAGS),
    )
    # AI/ML and Machine Learning collapse into ONE 'ai'; Space Tech resolves
    # via the hardware alias table? no — 'space-tech' IS a hardware alias
    assert final[0] == "ai"
    assert "founder" in final
    assert len(final) == len(set(final))  # deduped
    assert stats["dropped"] >= 1  # the 40-char garbage never persists
    for slug in final:
        assert slug == canonical(slug)  # everything stored is canonical


def test_assign_tags_caps_at_max():
    raw = ["founder", "exec", "engineering", "product", "bizdev", "investor", "media"]
    final, stats = assign_tags(raw, set(SEED_TAGS))
    assert len(final) == MAX_TAGS
    assert stats["dropped"] == len(raw) - MAX_TAGS


def test_later_import_inherits_the_grown_vocabulary():
    """The inheritance contract: a tag created on import #1 is REUSED (not
    duplicated as a variant) when import #2 proposes a variant of it."""
    first, s1 = assign_tags(["Climate Tech"], set(SEED_TAGS))
    assert first == ["climate-tech"] and s1["created"] == 1
    grown = set(SEED_TAGS) | set(first)
    second, s2 = assign_tags(["climate tech"], grown)
    assert second == ["climate-tech"]
    assert s2["reused"] == 1 and s2["created"] == 0


def test_vocabulary_block_lists_seed_definitions_and_grown_slugs():
    block = vocabulary_block(set(SEED_TAGS) | {"climate-tech"})
    assert "reuse-first" in block
    assert "- ai — artificial intelligence" in block
    assert "- climate-tech" in block


def test_fake_derivation_is_deterministic_and_seed_only():
    text = "Founder & CEO of a robotics company, hiring engineers, AI research"
    tags = derive_seed_tags(text)
    assert tags == derive_seed_tags(text)  # byte-stable
    assert set(tags) <= set(SEED_TAGS)
    assert "founder" in tags and "hardware" in tags


def test_enrich_pass_writes_canonical_tags_to_the_card(client, store):
    """API-level: a FAKE research pass lands canonical tags on the card and
    the activity detail reports the tag counts honestly."""
    from tests.conftest import make_batch_request

    res = client.post("/refine/batch", json=make_batch_request())
    assert res.status_code == 200
    card = client.post("/enrich/person", json={"tg_id": 42}).json()
    assert isinstance(card["tags"], list)
    for slug in card["tags"]:
        assert slug == canonical(slug)
    acts = client.get("/activity").json()
    assert any("tags:" in (a.get("detail") or "") for a in acts if a["agent"] == "enrich")
