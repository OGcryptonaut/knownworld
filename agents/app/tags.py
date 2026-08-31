"""Tenant tag vocabulary — research-created, reuse-first, canonical in code.

The design (2026-08-31 research synthesis; prior art: paperless-ngx AI tag
matching, Stack Overflow tag synonyms, OpenRefine fingerprint clustering):

  1. A SEED vocabulary (the original 17 closed-vocabulary tags, now with
     one-line definitions and alias lists) exists for every tenant.
  2. The research pass's extract step proposes tags; the prompt lists the
     tenant's current vocabulary (seed + every tag already on a card) with
     the reuse-first rule, so later imports INHERIT the grown vocabulary.
  3. Every proposed tag runs through a DETERMINISTIC canonicalization
     funnel IN CODE: fold -> lowercase -> kebab -> exact/alias match ->
     reuse; else a validated new canonical slug is created. The model can
     never mint 'AI/ML' next to 'ai' — the funnel collapses variants.
  4. Assignment is capped and counted; drops are reported, never silent.

The graph and the top-bar chips read only canonical slugs.
"""

from __future__ import annotations

import re
import unicodedata

MAX_TAGS = 5
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,23}$")

# slug -> (one-line definition for the prompt, aliases that collapse into it)
SEED_TAGS: dict[str, tuple[str, list[str]]] = {
    "founder": ("started or runs their own company (founder, CEO)", ["ceo", "co-founder", "cofounder", "entrepreneur"]),
    "exec": ("senior executive leadership (chairman, president, C-suite)", ["executive", "chairman", "president", "coo", "cfo", "c-suite", "leadership"]),
    "engineering": ("builds software or systems (engineer, CTO, developer)", ["engineer", "developer", "cto", "software", "technical", "tech"]),
    "product": ("product management or product leadership", ["product-management", "product-manager", "pm"]),
    "bizdev": ("business development, partnerships, sales", ["bd", "business-development", "partnerships", "sales"]),
    "investor": ("invests in companies (VC, angel, fund)", ["vc", "venture", "venture-capital", "angel", "investing", "investment"]),
    "marketing": ("marketing, growth, community building", ["growth", "community", "brand", "content-marketing"]),
    "design": ("design of products, brands, or experiences", ["designer", "ux", "ui", "product-design"]),
    "research": ("research or science work", ["scientist", "researcher", "science", "r-d"]),
    "ops": ("operations, chief of staff, internal running of a company", ["operations", "chief-of-staff", "biz-ops"]),
    "ai": ("artificial intelligence and machine learning", ["artificial-intelligence", "machine-learning", "ml", "llm", "llms", "ai-ml", "genai", "deep-learning"]),
    "crypto": ("crypto, blockchain, web3", ["blockchain", "web3", "defi", "stablecoin", "stablecoins", "tokens", "cryptocurrency"]),
    "payments": ("payments, fintech, banking", ["fintech", "banking", "payment", "financial-services"]),
    "hardware": ("hardware, robotics, aerospace, chips", ["robotics", "aerospace", "rockets", "semiconductors", "chips", "space", "space-tech", "defense"]),
    "security": ("security and infosec", ["infosec", "cybersecurity", "pentest"]),
    "media": ("media, journalism, newsletters, podcasts", ["journalist", "journalism", "newsletter", "podcast", "press"]),
    "hiring": ("actively recruiting or works in talent", ["recruiting", "talent", "recruitment"]),
}

# regex derivation over free text — the FAKE extract path and the web-side
# fallback for not-yet-researched rows share this exact rule set
SEED_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("founder", re.compile(r"\bfounder|\bceo\b", re.I)),
    ("exec", re.compile(r"\bchairman|\bpresident\b|\bcoo\b|\bcfo\b|\bchief\b", re.I)),
    ("engineering", re.compile(r"\bengineer|\bcto\b|developer|technical", re.I)),
    ("product", re.compile(r"\bproduct\b", re.I)),
    ("bizdev", re.compile(r"\bbd\b|business development|partnership", re.I)),
    ("investor", re.compile(r"\binvestor|\bvc\b|venture|angel\b", re.I)),
    ("marketing", re.compile(r"marketing|\bgrowth\b|community", re.I)),
    ("design", re.compile(r"\bdesign", re.I)),
    ("research", re.compile(r"research|scientist", re.I)),
    ("ops", re.compile(r"operations|\bops\b|chief of staff", re.I)),
    ("ai", re.compile(r"\bai\b|artificial intelligence|machine learning|\bml\b|\bllm", re.I)),
    ("crypto", re.compile(r"crypto|blockchain|web3|defi|stablecoin|\btokens?\b", re.I)),
    ("payments", re.compile(r"payment|fintech|banking", re.I)),
    ("hardware", re.compile(r"hardware|robotics|aerospace|rocket|chip\b|semiconductor", re.I)),
    ("security", re.compile(r"security|infosec|pentest", re.I)),
    ("media", re.compile(r"\bmedia\b|journalist|newsletter|podcast", re.I)),
    ("hiring", re.compile(r"recruit|hiring|talent\b", re.I)),
]


def canonical(raw: str) -> str:
    """Deterministic fingerprint: unicode-fold, lowercase, everything
    non-alphanumeric collapses to single dashes."""
    folded = unicodedata.normalize("NFKD", raw or "")
    folded = "".join(c for c in folded if not unicodedata.combining(c)).lower()
    slug = re.sub(r"[^a-z0-9]+", "-", folded).strip("-")
    return re.sub(r"-{2,}", "-", slug)


# canonical alias form -> seed slug, built once
_ALIAS_TO_SLUG: dict[str, str] = {}
for _slug, (_def, _aliases) in SEED_TAGS.items():
    _ALIAS_TO_SLUG[_slug] = _slug
    for _a in _aliases:
        _ALIAS_TO_SLUG.setdefault(canonical(_a), _slug)


def resolve(raw: str, tenant_slugs: set[str]) -> str | None:
    """Collapse a proposed tag into an existing slug (seed alias table +
    the tenant's grown vocabulary), or None when it is genuinely new."""
    c = canonical(raw)
    if not c:
        return None
    if c in tenant_slugs:
        return c
    return _ALIAS_TO_SLUG.get(c)


def assign_tags(
    proposed: list[str], tenant_slugs: set[str]
) -> tuple[list[str], dict[str, int]]:
    """The funnel: every model-proposed tag either reuses an existing slug
    or becomes a validated new canonical slug; garbage is dropped and
    counted, never silently patched in. Order preserved, capped, deduped."""
    out: list[str] = []
    stats = {"reused": 0, "created": 0, "dropped": 0}
    for raw in proposed:
        existing = resolve(raw, tenant_slugs)
        if existing is not None:
            slug, is_new = existing, False
        else:
            slug, is_new = canonical(raw), True
            if not SLUG_RE.match(slug):
                stats["dropped"] += 1
                continue
        if slug in out:
            continue
        if len(out) >= MAX_TAGS:
            stats["dropped"] += 1
            continue
        out.append(slug)
        stats["created" if is_new else "reused"] += 1
    return out, stats


def vocabulary_block(tenant_slugs: set[str]) -> str:
    """The reuse-first vocabulary for the extract prompt's USER text (ADK
    instructions treat braces as templates — person/tenant data never goes
    there). Seed tags carry definitions; grown tags list as bare slugs."""
    lines = [f"- {slug} — {definition}" for slug, (definition, _a) in SEED_TAGS.items()]
    extras = sorted(s for s in tenant_slugs if s not in SEED_TAGS)
    lines.extend(f"- {slug}" for slug in extras)
    return (
        "EXISTING TAGS (reuse-first: pick from this list whenever one fits; "
        "invent a new lowercase 1-2 word tag ONLY when nothing here fits):\n"
        + "\n".join(lines)
    )


def derive_seed_tags(text: str) -> list[str]:
    """Deterministic regex derivation over free text — the FAKE extract's
    tag source, so offline runs are byte-reproducible."""
    if not (text or "").strip():
        return []
    out = [slug for slug, pattern in SEED_PATTERNS if pattern.search(text)]
    return out[:MAX_TAGS]
