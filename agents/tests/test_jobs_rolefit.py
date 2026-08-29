"""Role-fit filter: pure in-code verdicts with named reasons."""

from app.jobs.rolefit import fits

PROFILE = {
    "targetRoles": ["BD lead", "partnerships", "ecosystem/growth lead", "GTM", "grants/program lead"],
    "industries": ["L1/L2s", "stablecoins & payments"],
    "seniority": ["senior", "lead", "head", "director"],
    "location": "remote EMEA or Lisbon",
}


def test_partnerships_title_fits_with_named_reason():
    fit, reasons = fits("Partnerships Manager", PROFILE)
    assert fit is True
    assert any("partnerships" in r for r in reasons)


def test_bd_and_business_development_match_with_word_boundaries():
    assert fits("BD Lead, EMEA", PROFILE)[0] is True
    assert fits("Business Development Representative", PROFILE)[0] is True
    # 'bd' must not fire inside a word
    fit, reasons = fits("Abdominal Imaging Specialist", PROFILE)
    assert fit is False


def test_gtm_and_go_to_market_variants():
    assert fits("GTM Strategist", PROFILE)[0] is True
    assert fits("Go-to-Market Lead", PROFILE)[0] is True
    assert fits("Go to Market Associate", PROFILE)[0] is True


def test_grants_ecosystem_growth_program():
    for title in ("Grants Manager", "Ecosystem Lead", "Growth Manager", "Program Manager"):
        fit, reasons = fits(title, PROFILE)
        assert fit is True, title
        assert reasons, title


def test_seniority_adds_reason_but_is_not_required():
    fit, reasons = fits("Senior Partnerships Manager", PROFILE)
    assert fit is True
    assert any("seniority" in r and "senior" in r for r in reasons)
    # no seniority term still fits
    fit, reasons = fits("Partnerships Associate", PROFILE)
    assert fit is True
    assert not any("seniority" in r for r in reasons)


def test_seniority_alone_never_fits():
    fit, _ = fits("Senior Staff Software Engineer", PROFILE)
    assert fit is False


def test_unrelated_titles_rejected_with_reasons():
    for title, term in (("Software Engineer", "engineer"), ("Product Designer", "designer"),
                        ("Staff Accountant", "accountant")):
        fit, reasons = fits(title, PROFILE)
        assert fit is False, title
        assert any("no target-role keyword" in r for r in reasons)
        assert any(term in r for r in reasons)


def test_case_insensitive():
    assert fits("HEAD OF PARTNERSHIPS", PROFILE)[0] is True


def test_empty_target_roles_falls_back_to_full_keyword_set():
    fit, _ = fits("Partnerships Manager", {"targetRoles": [], "seniority": []})
    assert fit is True
    assert fits("Software Engineer", {"targetRoles": [], "seniority": []})[0] is False


def test_keywords_derived_from_target_roles_only():
    # profile targeting only grants: partnerships title should NOT fit
    narrow = {"targetRoles": ["grants lead"], "seniority": []}
    assert fits("Grants Program... Grants Manager", narrow)[0] is True
    assert fits("Partnerships Manager", narrow)[0] is False
