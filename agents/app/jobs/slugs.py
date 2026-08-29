"""Company-name normalization and ATS slug candidate generation.

normalize_company() is THE canonical company key everywhere in the job scout
(dedupe, ats_slugs doc ids, contact joins). candidate_slugs() only proposes
strings to PROBE against live feeds — a candidate is never persisted unless a
feed actually verified it (no hand-invented slugs in any store or file).
"""

from __future__ import annotations

import re

# Legal-entity suffixes stripped from the END of a name. Meaningful name parts
# ('labs', 'foundation') are deliberately KEPT — they distinguish companies.
_LEGAL_SUFFIXES = {"inc", "ltd", "llc", "gmbh", "corp"}

_TRAILING_TLD_RE = re.compile(r"\.(io|com|xyz)$")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")

# Alias dict for edge cases where the real slug is not derivable from the
# name (normalized company -> slugs to try FIRST). Empty to start; only add
# entries that a live probe then verifies.
ALIASES: dict[str, list[str]] = {}


def normalize_company(name: str) -> str:
    """Lowercase; strip a trailing .io/.com/.xyz TLD, punctuation, and
    trailing legal suffixes (inc/ltd/llc/gmbh/corp). Returns '' when nothing
    meaningful remains."""
    text = name.strip().lower()
    text = _TRAILING_TLD_RE.sub("", text)
    text = _NON_ALNUM_RE.sub(" ", text).strip()
    words = text.split()
    while words and words[-1] in _LEGAL_SUFFIXES:
        words.pop()
    return " ".join(words)


def candidate_slugs(name: str) -> list[str]:
    """Ordered, deduplicated slug candidates for a company name: aliases
    first, then kebab-case, concatenated, first word, and common transforms
    (dropping a leading 'the'). Purely candidates for live probing."""
    normalized = normalize_company(name)
    if not normalized:
        return []
    words = normalized.split()

    candidates: list[str] = []
    candidates.extend(ALIASES.get(normalized, []))
    candidates.append("-".join(words))          # kebab-case
    candidates.append("".join(words))           # concatenated / no spaces
    candidates.append(words[0])                 # first word
    if words[0] == "the" and len(words) > 1:    # common transform: drop 'the'
        rest = words[1:]
        candidates.append("-".join(rest))
        candidates.append("".join(rest))

    seen: set[str] = set()
    ordered: list[str] = []
    for candidate in candidates:
        if len(candidate) >= 2 and candidate not in seen:
            seen.add(candidate)
            ordered.append(candidate)
    return ordered


# Companies whose one-token names collide with unrelated same-named boards
# (e.g. a non-crypto "Juno" on greenhouse; "Insider" matches a global media
# company). Feed identity is unverifiable from public metadata, so they are
# curator-EXCLUDED — conservative: we skip real feeds rather than ever join
# another company's jobs to warm contacts.
AMBIGUOUS_EXCLUDED: set[str] = {"juno", "insider"}
