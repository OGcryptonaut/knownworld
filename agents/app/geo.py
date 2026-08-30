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
    """First gazetteer alias found in the text wins; None when unknown —
    never a guess."""
    lowered = (location_text or "").lower()
    if not lowered.strip():
        return None
    for _city, (_country, lat, lng, aliases) in GAZETTEER.items():
        for alias in aliases:
            if alias in lowered:
                return lat, lng
    return None
