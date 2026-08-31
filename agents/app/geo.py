"""Offline mini-geocoder for owner location edits.

When the owner corrects a contact's location, the map pin must move — without
any external geocoding API or key. A curated gazetteer of common hub cities
covers the realistic demo/edit surface; anything unknown simply keeps the text
with no coordinates (the map shows located contacts only — honest, not wrong).

Adapted from the owner's atlas-crm reference project (MIT) — same idea,
trimmed to EN aliases + the cities our datasets actually touch.
"""

from __future__ import annotations

# canonical city -> (country, lat, lng, [aliases, lowercased])
GAZETTEER: dict[str, tuple[str, float, float, list[str]]] = {
    "Lisbon": ("Portugal", 38.7223, -9.1393, ["lisbon", "lisboa", "лиссабон"]),
    "Porto": ("Portugal", 41.1579, -8.6291, ["porto", "порту"]),
    "Dubai": ("UAE", 25.2048, 55.2708, ["dubai", "дубай", "uae"]),
    "Kyiv": ("Ukraine", 50.4501, 30.5234, ["kyiv", "kiev", "киев", "київ"]),
    "Warsaw": ("Poland", 52.2297, 21.0122, ["warsaw", "варшава"]),
    "Vienna": ("Austria", 48.2082, 16.3738, ["vienna", "вена"]),
    "Berlin": ("Germany", 52.5200, 13.4050, ["berlin", "берлин"]),
    "London": ("UK", 51.5074, -0.1278, ["london", "лондон"]),
    "Paris": ("France", 48.8566, 2.3522, ["paris", "париж"]),
    "Barcelona": ("Spain", 41.3851, 2.1734, ["barcelona", "барселона"]),
    "Madrid": ("Spain", 40.4168, -3.7038, ["madrid", "мадрид"]),
    "Amsterdam": ("Netherlands", 52.3676, 4.9041, ["amsterdam", "амстердам"]),
    "Tbilisi": ("Georgia", 41.7151, 44.8271, ["tbilisi", "тбилиси"]),
    "Singapore": ("Singapore", 1.3521, 103.8198, ["singapore", "сингапур"]),
    "Hong Kong": ("Hong Kong", 22.3193, 114.1694, ["hong kong", "гонконг"]),
    "Bangkok": ("Thailand", 13.7563, 100.5018, ["bangkok", "бангкок"]),
    "New York": ("USA", 40.7128, -74.0060, ["new york", "nyc", "нью-йорк"]),
    "San Francisco": ("USA", 37.7749, -122.4194, ["san francisco", "bay area", "сан-франциско"]),
    "Los Angeles": ("USA", 34.0522, -118.2437, ["los angeles", "лос-анджелес"]),
    "Miami": ("USA", 25.7617, -80.1918, ["miami", "майами"]),
    "Austin": ("USA", 30.2672, -97.7431, ["austin", "остин"]),
    "Seattle": ("USA", 47.6062, -122.3321, ["seattle", "сиэтл"]),
    "Denver": ("USA", 39.7392, -104.9903, ["denver", "денвер"]),
    "Boston": ("USA", 42.3601, -71.0589, ["boston", "бостон"]),
    "Omaha": ("USA", 41.2565, -95.9345, ["omaha", "омаха"]),
    "Santa Clara": ("USA", 37.3541, -121.9552, ["santa clara"]),
    "Palo Alto": ("USA", 37.4419, -122.1430, ["palo alto"]),
    "Costa Mesa": ("USA", 33.6411, -117.9187, ["costa mesa", "orange county"]),
    "Toronto": ("Canada", 43.6532, -79.3832, ["toronto", "торонто"]),
    "Ottawa": ("Canada", 45.4215, -75.6972, ["ottawa", "оттава"]),
    "Vancouver": ("Canada", 49.2827, -123.1207, ["vancouver", "ванкувер"]),
    "Stockholm": ("Sweden", 59.3293, 18.0686, ["stockholm", "стокгольм"]),
    "Sydney": ("Australia", -33.8688, 151.2093, ["sydney", "сидней"]),
    "Tokyo": ("Japan", 35.6762, 139.6503, ["tokyo", "токио"]),
    "Tel Aviv": ("Israel", 32.0853, 34.7818, ["tel aviv", "тель-авив"]),
    "Zurich": ("Switzerland", 47.3769, 8.5417, ["zurich", "zug", "цюрих"]),
    "Prague": ("Czechia", 50.0755, 14.4378, ["prague", "прага"]),
    "Istanbul": ("Turkey", 41.0082, 28.9784, ["istanbul", "стамбул"]),
}


def geocode(location_text: str) -> tuple[float, float] | None:
    """First gazetteer alias found AS A WHOLE WORD wins; None when unknown —
    never a guess. Word-bounded so 'порту' (Porto) cannot pin the middle of
    'Португалия' (the country) on the city."""
    import re

    lowered = (location_text or "").lower()
    if not lowered.strip():
        return None
    for _city, (_country, lat, lng, aliases) in GAZETTEER.items():
        for alias in aliases:
            if re.search(rf"(?<!\w){re.escape(alias)}(?!\w)", lowered):
                return lat, lng
    return None


# ---- location understanding for requests ("in LA", "from Europe") -----------
#
# The chat's place filters run IN CODE (never a model): a query place is
# resolved to a set of word-bounded terms that count as "there". Three levels:
# a city (plus its metro localities), a country (plus its cities), a region
# (plus its countries and their cities). Anything unknown falls back to the
# raw word-bounded phrase — the old behavior, never a guess.

import re as _re

# query-side shorthand -> canonical gazetteer city. These are deliberately
# NOT geocode() aliases: substring-matching "la" inside arbitrary location
# text would false-positive ("Atlanta"); here the whole query token must be
# the shorthand.
QUERY_CITY_ALIASES: dict[str, str] = {
    "la": "Los Angeles",
    "l.a.": "Los Angeles",
    "sf": "San Francisco",
    "bay area": "San Francisco",
    "nyc": "New York",
    "ny": "New York",
}

# canonical city -> localities that colloquially count as that city's area
METRO: dict[str, list[str]] = {
    "Los Angeles": [
        "los angeles", "santa monica", "culver city", "long beach", "pasadena",
        "el segundo", "costa mesa", "irvine", "orange county", "burbank",
    ],
    "San Francisco": [
        "san francisco", "south san francisco", "oakland", "berkeley",
        "palo alto", "menlo park", "mountain view", "san jose", "santa clara",
        "redwood city", "sunnyvale", "cupertino", "bay area",
    ],
    "New York": ["new york", "nyc", "brooklyn", "manhattan", "queens", "jersey city"],
}

# country -> query aliases AND the terms that mark a location text as being
# in that country (both directions share one list; all word-bounded)
COUNTRY_TERMS: dict[str, list[str]] = {
    "USA": ["usa", "united states", "us", "america", "сша"],
    "UK": ["uk", "united kingdom", "britain", "england", "великобритания", "англия"],
    "Portugal": ["portugal", "португалия"],
    "Spain": ["spain", "испания"],
    "France": ["france", "франция"],
    "Germany": ["germany", "германия"],
    "Austria": ["austria", "австрия"],
    "Poland": ["poland", "польша"],
    "Ukraine": ["ukraine", "украина"],
    "Netherlands": ["netherlands", "нидерланды"],
    "Sweden": ["sweden", "швеция"],
    "Czechia": ["czechia", "czech republic", "чехия"],
    "Switzerland": ["switzerland", "швейцария"],
    "Italy": ["italy", "италия"],
    "Ireland": ["ireland", "ирландия"],
    "Denmark": ["denmark", "дания"],
    "Norway": ["norway", "норвегия"],
    "Finland": ["finland", "финляндия"],
    "Belgium": ["belgium", "бельгия"],
    "Greece": ["greece", "греция"],
    "Estonia": ["estonia", "эстония"],
    "Georgia": ["georgia", "грузия"],
    "Turkey": ["turkey", "türkiye", "турция"],
    "Israel": ["israel", "израиль"],
    "UAE": ["uae", "united arab emirates", "оаэ"],
    "Canada": ["canada", "канада"],
    "Australia": ["australia", "австралия"],
    "Japan": ["japan", "япония"],
    "Singapore": ["singapore", "сингапур"],
    "Thailand": ["thailand", "таиланд"],
    "Hong Kong": ["hong kong", "гонконг"],
}

EUROPE = {
    "UK", "Portugal", "Spain", "France", "Germany", "Austria", "Poland",
    "Ukraine", "Netherlands", "Sweden", "Czechia", "Switzerland", "Italy",
    "Ireland", "Denmark", "Norway", "Finland", "Belgium", "Greece", "Estonia",
}

REGION_COUNTRIES: dict[str, set[str]] = {
    "europe": EUROPE,
    "eu": EUROPE,
    "европа": EUROPE,
    "north america": {"USA", "Canada"},
    "america": {"USA", "Canada"},
    "asia": {"Japan", "Singapore", "Thailand", "Hong Kong"},
    "middle east": {"UAE", "Israel"},
}


def _cities_of(countries: set[str]) -> list[str]:
    """Every term that marks a location text as being in one of these
    countries' cities: canonical names, gazetteer aliases, AND metro
    localities ('in the US' must catch 'Brooklyn, NY' and 'Mountain View')."""
    terms: list[str] = []
    for city, (country, _lat, _lng, aliases) in GAZETTEER.items():
        if country in countries:
            terms.append(city.lower())
            terms.extend(aliases)
            terms.extend(METRO.get(city, []))
    return terms


def _canonical_city(norm: str) -> str | None:
    if norm in QUERY_CITY_ALIASES:
        return QUERY_CITY_ALIASES[norm]
    for city, (_country, _lat, _lng, aliases) in GAZETTEER.items():
        if norm == city.lower() or norm in aliases:
            return city
    return None


def location_terms(query_location: str) -> list[str]:
    """Resolve a query place to every term that counts as 'there'.
    City -> its metro localities; country -> its names + gazetteer cities;
    region -> all of its countries' terms. Unknown -> the raw phrase."""
    norm = (query_location or "").split(",")[0].strip().lower()
    if not norm:
        return []

    region = REGION_COUNTRIES.get(norm)
    if region is not None:
        terms: list[str] = []
        for country in region:
            terms.extend(COUNTRY_TERMS.get(country, [country.lower()]))
        terms.extend(_cities_of(region))
        return terms

    for country, country_terms in COUNTRY_TERMS.items():
        if norm in country_terms:
            return list(country_terms) + _cities_of({country})

    city = _canonical_city(norm)
    if city is not None:
        # canonical name + ALL its gazetteer aliases + metro localities —
        # 'Zug' must match a contact whose location literally says 'Zug'
        _country, _lat, _lng, aliases = GAZETTEER[city]
        return sorted({city.lower(), *aliases, *METRO.get(city, [])})

    return [norm]


def location_predicate(query_location: str):
    """Word-bounded, case-insensitive matcher over free location text for
    the resolved terms of a query place. Deterministic, in code. A term
    preceded by another WORD ("York" inside "New York") does not count —
    matching a LARGER place name would answer with the wrong city. Only a
    real word blocks: separator punctuation must stay transparent, or the
    standard ATS format 'Remote - London' would never match 'London'."""
    terms = location_terms(query_location)
    if not terms:
        return lambda _text: False
    pattern = _re.compile(
        "|".join(rf"(?<!\w )\b{_re.escape(term)}\b" for term in terms),
        _re.IGNORECASE,
    )
    return lambda text: bool(text and pattern.search(text))
