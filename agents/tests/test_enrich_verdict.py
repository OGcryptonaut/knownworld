"""Verdict is computed IN CODE from evidence-vs-DB comparison — unit tests
for the pure functions. All names/companies here are synthetic."""

from app.agents.enrich import (
    EnrichExtract,
    compute_verdict,
    normalize_company,
    token_overlap,
)


def _extract(**kwargs) -> EnrichExtract:
    return EnrichExtract(identified=True, **kwargs)


# ---- normalize_company ------------------------------------------------------


def test_normalize_strips_case_punctuation_and_legal_suffixes():
    assert normalize_company("  Acme, Inc. ") == "acme"
    assert normalize_company("Acme S.A.") == "acme"
    assert normalize_company("ACME Ltd") == "acme"
    assert normalize_company("Fake Labs GmbH") == "fake labs"
    assert normalize_company("Rival LLC Corp") == "rival"


def test_normalize_never_collapses_to_empty():
    # a company literally named after a suffix keeps its tokens
    assert normalize_company("Corp") == "corp"
    assert normalize_company(None) == ""
    assert normalize_company("   ") == ""


def test_token_overlap_is_overlap_coefficient():
    assert token_overlap("acme protocol foundation", "acme protocol labs") > 0.6
    assert token_overlap("acme foundation", "acme labs") == 0.5
    assert token_overlap("", "acme") == 0.0


# ---- compute_verdict --------------------------------------------------------


def test_match_by_normalized_equality():
    verdict, reason = compute_verdict(
        _extract(current_employer="acme"), "Acme, Inc."
    )
    assert verdict == "match"
    assert "evidence says 'acme'" in reason
    assert "DB says 'Acme, Inc.'" in reason


def test_match_by_containment_either_way():
    verdict, reason = compute_verdict(_extract(current_employer="Acme Labs"), "Acme")
    assert verdict == "match"
    assert "containment" in reason
    verdict, _ = compute_verdict(_extract(current_employer="Acme"), "Acme Labs Ltd")
    assert verdict == "match"


def test_match_by_token_overlap():
    verdict, reason = compute_verdict(
        _extract(current_employer="Acme Protocol Foundation"), "Acme Protocol Labs"
    )
    assert verdict == "match"
    assert "token overlap" in reason


def test_possible_mismatch_when_evidence_differs():
    verdict, reason = compute_verdict(
        _extract(current_employer="Rival Industries"), "Acme"
    )
    assert verdict == "possible_mismatch"
    assert reason == "evidence says 'Rival Industries', DB says 'Acme'"


def test_low_token_overlap_is_a_mismatch():
    verdict, _ = compute_verdict(_extract(current_employer="Acme Foundation"), "Beta Labs")
    assert verdict == "possible_mismatch"


def test_unverified_when_not_identified():
    verdict, reason = compute_verdict(
        EnrichExtract(identified=False), "Acme"
    )
    assert verdict == "unverified"
    assert "could not be confidently identified" in reason


def test_unverified_when_no_employer_found():
    verdict, reason = compute_verdict(_extract(current_employer=None), "Acme")
    assert verdict == "unverified"
    assert "no current employer" in reason


def test_unverified_when_db_has_no_company():
    verdict, reason = compute_verdict(_extract(current_employer="Acme"), None)
    assert verdict == "unverified"
    assert "no company on record" in reason
