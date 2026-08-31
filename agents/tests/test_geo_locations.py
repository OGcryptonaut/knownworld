"""geo.location_terms / location_predicate — the in-code place matcher the
chat filters run on. Deterministic, no model: shorthands ("LA"), metros,
countries, regions ("Europe"), word-bounded fallback for unknown places.
"""

from __future__ import annotations

from app.geo import location_predicate, location_terms


def test_la_shorthand_covers_the_metro():
    here = location_predicate("LA")
    assert here("Costa Mesa, California, United States")
    assert here("Los Angeles, CA")
    assert here("Santa Monica, California")
    # word-bounded: "la" the token, never a substring
    assert not here("Atlanta, Georgia, United States")
    assert not here("Lagos, Nigeria")


def test_europe_region_matches_countries_and_their_cities():
    here = location_predicate("Europe")
    assert here("Stockholm, Sweden")
    assert here("Berlin, Germany")
    assert here("London")  # gazetteer city of a European country
    assert not here("Austin, Texas, US")
    assert not here("Sydney, New South Wales, Australia")


def test_country_matches_its_cities():
    here = location_predicate("Sweden")
    assert here("Stockholm, Sweden")
    assert here("Stockholm")  # city implies the country
    assert not here("Oslo, Norway")


def test_word_boundary_survives_the_fallback():
    # "York" must not swallow "New York" (the 4cf7792 regression class)
    assert not location_predicate("York")("New York, NY")
    assert location_predicate("New York")("New York, NY")
    assert location_predicate("New York")("Brooklyn, New York")


def test_unknown_place_falls_back_to_the_raw_phrase():
    here = location_predicate("Gotham")
    assert here("Gotham City")
    assert not here("Metropolis")


def test_none_and_empty_are_never_matches():
    here = location_predicate("LA")
    assert not here(None)
    assert not here("")
    assert location_terms("") == []
