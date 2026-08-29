"""Company normalization + slug candidate generation."""

from app.jobs import slugs
from app.jobs.slugs import candidate_slugs, normalize_company


def test_normalize_strips_legal_suffixes_and_punctuation():
    assert normalize_company("AlphaPay, Inc.") == "alphapay"
    assert normalize_company("Beta Ltd") == "beta"
    assert normalize_company("Gamma LLC") == "gamma"
    assert normalize_company("Delta GmbH") == "delta"
    assert normalize_company("Epsilon Corp") == "epsilon"


def test_normalize_strips_trailing_tld_only():
    assert normalize_company("Ripple.com") == "ripple"
    assert normalize_company("Zeta.io") == "zeta"
    assert normalize_company("Eta.xyz") == "eta"
    # TLD only stripped at the end
    assert normalize_company("io.net") == "io net"


def test_normalize_keeps_meaningful_words():
    assert normalize_company("Theta Labs") == "theta labs"
    assert normalize_company("Iota Foundation") == "iota foundation"


def test_normalize_lowercases_and_collapses():
    assert normalize_company("  CoinMarketCap  ") == "coinmarketcap"
    assert normalize_company("Coin  Market   Cap") == "coin market cap"
    assert normalize_company("Inc") == ""


def test_candidates_ordered_and_deduped():
    cands = candidate_slugs("Coin Market Cap Inc")
    assert cands[0] == "coin-market-cap"   # kebab first
    assert "coinmarketcap" in cands        # concatenated
    assert "coin" in cands                 # first word
    assert len(cands) == len(set(cands))


def test_single_word_company_yields_one_candidate():
    assert candidate_slugs("Circle") == ["circle"]


def test_the_prefix_transform():
    cands = candidate_slugs("The Omega Group")
    assert "the-omega-group" in cands
    assert "omega-group" in cands
    assert "omegagroup" in cands


def test_alias_dict_wins_first(monkeypatch):
    monkeypatch.setitem(slugs.ALIASES, "alphapay", ["alpha-pay-hq"])
    assert candidate_slugs("AlphaPay Inc")[0] == "alpha-pay-hq"


def test_empty_or_meaningless_name():
    assert candidate_slugs("") == []
    assert candidate_slugs("Ltd") == []


def test_names_match_identity():
    from app.jobs.ats import names_match

    assert names_match("Coins.ph", "Coins.ph")
    assert names_match("NEAR Foundation", "NEAR Foundation ")
    # one-token names are strict-equality: precision over recall
    assert not names_match("Circle Internet Financial", "Circle")
    assert names_match("Circle", "Circle")
    assert not names_match("NCC Group", "Near Creative Collective (NCC)")
    assert not names_match("Juno College", "Juno")
    assert names_match("Babylon Labs", "Babylon Labs Inc")


def test_lever_identity_requires_all_tokens():
    from app.jobs.ats import _name_tokens

    assert _name_tokens("Proof of Self") == {"proof", "self"}
    assert _name_tokens("Capital Guild DAO") == {"capital", "guild"}
