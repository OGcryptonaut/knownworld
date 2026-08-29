"""Pure role-fit filter: does a posting title match the user's profile?

fits() is deterministic code — no model involved, mirroring the product rule
that verdicts/filters are computed in code. Reasons always name the matched
terms so the UI can show WHY a posting was kept or dropped.
"""

from __future__ import annotations

import re

# Canonical title keywords, each with a word-boundary pattern and the trigger
# pattern that activates it from the profile's targetRoles text.
_KEYWORDS: list[tuple[str, str, str]] = [
    # (keyword, title pattern, targetRoles trigger pattern)
    ("bd", r"\bbd\b", r"\bbd\b|\bbusiness\s+development\b"),
    ("business development", r"\bbusiness\s+development\b", r"\bbd\b|\bbusiness\s+development\b"),
    ("partnerships", r"\bpartnerships?\b", r"\bpartner"),
    # bare "partner" is noisy (HR Business Partner, Talent Acquisition
    # Partner...) — count it only when the title has no people-ops context
    ("partner", r"\bpartner\b", r"\bpartner"),
    ("ecosystem", r"\becosystem\b", r"\becosystem"),
    ("growth", r"\bgrowth\b", r"\bgrowth"),
    ("gtm", r"\bgtm\b", r"\bgtm\b|\bgo[- ]to[- ]market\b"),
    ("go-to-market", r"\bgo[- ]to[- ]market\b", r"\bgtm\b|\bgo[- ]to[- ]market\b"),
    ("grants", r"\bgrants?\b", r"\bgrant"),
    ("program", r"\bprogram\b", r"\bprogram"),
]

_BASE_SENIORITY = ("senior", "lead", "head", "director", "principal", "vp")

# Titles that are explicitly unrelated to the target roles; only used to give
# a clearer negative reason — the decision itself is "no keyword -> no fit".
# people-ops / non-BD contexts that neutralise a bare "partner" match
_PARTNER_NOISE_RE = re.compile(
    r"\b(hr|human\s+resources|people|talent|recruit\w*|clinical|legal|"
    r"accounting|finance|payroll|workday)\b",
    re.IGNORECASE,
)

_UNRELATED_RE = re.compile(
    r"\b(engineer|engineering|developer|designer|design|accountant|accounting|"
    r"counsel|attorney|paralegal|recruiter|nurse|physician|scientist)\b",
    re.IGNORECASE,
)


def _active_keywords(target_roles: list[str]) -> list[tuple[str, str]]:
    """Derive (keyword, title pattern) pairs from the profile's targetRoles.
    Falls back to the full keyword set when nothing derivable (empty/opaque
    profile) so the filter never silently matches nothing."""
    roles_text = " ".join(r.lower() for r in target_roles if isinstance(r, str))
    active = [
        (keyword, title_pattern)
        for keyword, title_pattern, trigger in _KEYWORDS
        if re.search(trigger, roles_text)
    ]
    return active or [(k, p) for k, p, _ in _KEYWORDS]


def _seniority_terms(seniority: list[str]) -> list[str]:
    extra = [s.strip().lower() for s in seniority if isinstance(s, str) and s.strip()]
    ordered: list[str] = []
    for term in (*_BASE_SENIORITY, *extra):
        if term not in ordered:
            ordered.append(term)
    return ordered


def fits(title: str, profile: dict) -> tuple[bool, list[str]]:
    """(role_fit, reasons). Fit requires >= 1 target-role keyword in the
    title; seniority terms only add a reason, never decide. Reasons name the
    matched terms in both directions."""
    reasons: list[str] = []
    matched = [
        keyword
        for keyword, pattern in _active_keywords(profile.get("targetRoles") or [])
        if re.search(pattern, title, re.IGNORECASE)
    ]
    # a bare "partner" hit inside a people-ops title is noise, not BD
    if (
        "partner" in matched
        and "partnerships" not in matched
        and "business development" not in matched
        and _PARTNER_NOISE_RE.search(title)
    ):
        matched.remove("partner")

    if not matched:
        reasons.append("no target-role keyword in title")
        unrelated = _UNRELATED_RE.search(title)
        if unrelated:
            reasons.append(f"unrelated title term '{unrelated.group(1).lower()}'")
        return False, reasons

    reasons.extend(f"matches target-role keyword '{k}'" for k in matched)
    for term in _seniority_terms(profile.get("seniority") or []):
        if re.search(rf"\b{re.escape(term)}\b", title, re.IGNORECASE):
            reasons.append(f"seniority term '{term}'")
            break
    return True, reasons
