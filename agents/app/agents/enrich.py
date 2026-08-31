"""Enrich + Verify agent (D2) — two-step ADK pipeline + in-code verdict.

ADK disables tools on an LlmAgent that declares an output_schema, so grounded
search and structured output MUST be two separate agents:

  Step A 'enrich_search'  — LlmAgent with tools=[google_search] (native Gemini
      Google Search grounding — the ONLY search backend; no external search
      keys), NO output_schema. Free-text research notes + grounding-metadata
      citations (event.grounding_metadata.grounding_chunks[i].web.{title,uri},
      snippets joined in from grounding_supports[].segment.text).
  Step B 'enrich_extract' — LlmAgent with output_schema=EnrichExtract, NO
      tools. Input is step A's text only. Malformed output raises
      ModelOutputInvalid (whole enrichment rejected upstream, with reasons).

The verdict is computed IN CODE here (compute_verdict) by comparing the
extracted evidence to the DB company — never by the model. Non-resolving
people get 'unverified', never guesses.

FAKE_SEARCH=1 (or FAKE_LLM=1) short-circuits both steps with deterministic
canned scenarios keyed by the person's name (see _fake_scenario): normal
match, an evidence-vs-DB mismatch, an unidentified person, and a blank-name
row that resolves to a public name. Fixed token counts for test assertions.

Input is distilled data only (name + company as a search query) — never
message content.
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel

from .. import config
from .refine_agent import ModelCallError, ModelOutputInvalid, UsageStats

# ---- contracts (mirror web/src/lib/types.ts — field-for-field) --------------


class EnrichmentEvidence(BaseModel):
    title: str
    url: str
    snippet: str | None = None


class EnrichExtract(BaseModel):
    """Step B structured output. footprint is trimmed to 5 lines in code."""

    identified: bool
    linkedin_url: str | None = None
    current_employer: str | None = None
    # what they do NOW (1-2 lines) and how they could help the user (1 line)
    current_focus: str | None = None
    how_useful: str | None = None
    # employment history, newest first, e.g. "2012— Coinbase — Co-founder & CEO"
    history: list[str] = []
    location: str | None = None
    # approximate city-center coordinates for the location (map view);
    # null whenever location is null — enforced in parse_extract
    location_lat: float | None = None
    location_lng: float | None = None
    resolved_name: str | None = None
    footprint: list[str] = []


class ChangedField(BaseModel):
    field: str
    old: str | None = None
    new: str | None = None


class CardUpdate(BaseModel):
    """One re-research pass, atlas-crm style: WHEN the card was refreshed and
    exactly what changed (old -> new) so nothing is silently overwritten.
    An empty `changed` list is an honest 're-checked, nothing new'."""

    at: str
    changed: list[ChangedField] = []
    citations: list[EnrichmentEvidence] = []


class EnrichmentCard(BaseModel):
    tg_id: int
    name: str
    # definite ?? inferred at enrich time — the company the verdict compared
    # against (a db_company_override lands here, never in the people doc)
    db_company: str | None = None
    linkedin_url: str | None = None
    location: str | None = None
    location_lat: float | None = None
    location_lng: float | None = None
    current_employer: str | None = None
    current_focus: str | None = None
    how_useful: str | None = None
    history: list[str] = []
    # name recovered from footprint for unnamed rows; applied only on approval
    resolved_name: str | None = None
    footprint: list[str]
    citations: list[EnrichmentEvidence]
    # computed IN CODE from evidence-vs-DB comparison — never by the model
    verdict: Literal["match", "possible_mismatch", "unverified"]
    verdict_reason: str
    status: Literal["pending", "approved", "rejected"]
    created_at: str
    run_id: str
    # 'owner' when the owner corrected/confirmed the row inline — clears the
    # mismatch/unverified flag in the UI and the people doc
    verified_by: str | None = None
    # dated changelog of re-research passes, newest first (capped)
    updates: list[CardUpdate] = []


# ---- verdict, IN CODE (pure functions, unit-tested) -------------------------

_LEGAL_SUFFIXES = {"inc", "ltd", "llc", "gmbh", "sa", "corp"}
TOKEN_OVERLAP_THRESHOLD = 0.6


def normalize_company(raw: str | None) -> str:
    """lowercase, trim, strip punctuation and legal suffixes (inc, ltd, llc,
    gmbh, s.a., corp). Never normalizes a non-empty name down to ''. """
    if not raw:
        return ""
    # split first, then strip punctuation inside each token so "S.A." -> "sa"
    tokens = [re.sub(r"[^\w]", "", t) for t in raw.lower().strip().split()]
    tokens = [t for t in tokens if t]
    stripped = [t for t in tokens if t not in _LEGAL_SUFFIXES]
    return " ".join(stripped or tokens)


def token_overlap(a: str, b: str) -> float:
    """Overlap coefficient on normalized token sets: |A∩B| / min(|A|,|B|)."""
    ta, tb = set(a.split()), set(b.split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / min(len(ta), len(tb))


def compute_verdict(
    extract: EnrichExtract, db_company: str | None
) -> tuple[Literal["match", "possible_mismatch", "unverified"], str]:
    """Evidence-vs-DB comparison. 'unverified' when the person did not resolve,
    no employer was found, or the DB has no company to compare — never a guess.
    'match' on normalized equality, containment either way, or token overlap
    >= 0.6; anything else is 'possible_mismatch' (never auto-merged)."""
    if not extract.identified:
        return "unverified", "this person could not be confidently identified from public sources"
    employer = (extract.current_employer or "").strip()
    if not employer:
        return "unverified", "identified, but the evidence shows no current employer"
    norm_ev = normalize_company(employer)
    norm_db = normalize_company(db_company)
    if not norm_db:
        return (
            "unverified",
            f"evidence says '{employer}', but there is no company on record to compare",
        )
    comparison = f"evidence says '{employer}', DB says '{db_company}'"
    if norm_ev == norm_db:
        return "match", f"{comparison}. Same company"
    if norm_ev in norm_db or norm_db in norm_ev:
        return "match", f"{comparison}. One name contains the other, same company"
    overlap = token_overlap(norm_ev, norm_db)
    if overlap >= TOKEN_OVERLAP_THRESHOLD:
        return (
            "match",
            f"{comparison}. The names share most of their words ({overlap:.2f}), same company",
        )
    return "possible_mismatch", f"{comparison}. These look like different companies"


# ---- prompts ----------------------------------------------------------------
# Person specifics go in the USER message, not the instruction: ADK treats
# {braces} in instructions as session-state templates.

SEARCH_INSTRUCTION = """\
You research the public professional footprint of one Telegram contact using
Google Search. The user message gives the contact's name and the company we
believe they work at.

Find and report, citing sources:
- their LinkedIn profile URL
- their current employer and role
- what they are currently focused on (1-2 lines)
- their employment HISTORY: past companies/roles with rough years, newest first
- their location
- notable footprint: articles, projects, talks, socials (a few short items)

Identity judgement (be neither gullible nor paranoid): nicknames,
transliterations and spelling variants of the SAME person are normal — do
not treat them as a different human. Treat a candidate as a DIFFERENT person
only on a direct factual contradiction (different country + industry +
employer). When torn between candidates, or nothing solid comes back, say
plainly that the person cannot be confidently identified — do not guess or
pick a similarly-named stranger. If the name given
is empty or blank, search by any handle-like hints provided and try to
resolve the person's actual public name; report the resolved name.
"""

EXTRACT_INSTRUCTION = """\
You are given research notes about one person. Extract them into the required
JSON schema. Rules:
- identified: false if the notes say the person could not be confidently
  identified; then leave every other field null/empty.
- linkedin_url / current_employer / location: only what the notes state;
  null when absent. Never invent values.
- current_focus: what they are doing now, 1-2 lines from the notes.
- how_useful: ONE line on how this person could plausibly help the user
  professionally, grounded strictly in the notes (their role, company,
  network) — no flattery, no invention.
- history: employment history lines from the notes, newest first, formatted
  "YEARS — ORG — ROLE"; empty list when the notes have none.
- location_lat / location_lng: approximate decimal coordinates of the
  location's city center (general geographic knowledge is fine here);
  null whenever location is null.
- resolved_name: only if the notes resolved a name for an unnamed contact.
- footprint: at most 5 short lines (articles, projects, talks, socials).
"""


def build_search_query(name: str, db_company: str | None) -> str:
    display_name = name.strip() if name and name.strip() else "(blank — name unknown)"
    company = db_company.strip() if db_company and db_company.strip() else "(unknown)"
    return (
        f"Contact name: {display_name}\n"
        f"Believed to work at: {company}\n"
        "Source: a Telegram contact of the user (professional network)."
    )


# ---- validation -------------------------------------------------------------


def parse_extract(text: str) -> EnrichExtract:
    """Validate step B's raw text against EnrichExtract. Never silently
    patched: invalid output raises ModelOutputInvalid with per-error reasons.
    Overlong footprints are trimmed to 5 lines in code (soft limit)."""
    from pydantic import ValidationError

    try:
        extract = EnrichExtract.model_validate_json(text)
    except ValidationError as exc:
        reasons = [
            f"{'.'.join(str(loc) for loc in err['loc']) or '(root)'}: {err['msg']}"
            for err in exc.errors()
        ]
        raise ModelOutputInvalid(reasons) from exc
    except ValueError as exc:  # not JSON at all
        raise ModelOutputInvalid([f"model output is not valid JSON: {exc}"]) from exc
    if len(extract.footprint) > 5:
        extract.footprint = extract.footprint[:5]
    if len(extract.history) > 8:
        extract.history = extract.history[:8]
    if extract.location is None:  # coords never without a location (contract)
        extract.location_lat = None
        extract.location_lng = None
    return extract


# ---- grounding metadata -> citations ----------------------------------------


def citations_from_grounding(grounding_metadata) -> list[EnrichmentEvidence]:
    """google.genai.types.GroundingMetadata -> EnrichmentEvidence[].

    Verified against the installed ADK 2.8 / google-genai types:
      grounding_metadata.grounding_chunks[i].web.{title, uri, domain}
      grounding_metadata.grounding_supports[j].{grounding_chunk_indices,
                                               segment.text}
    Snippets come from the first grounding_support segment citing a chunk.
    """
    if grounding_metadata is None:
        return []
    snippets: dict[int, str] = {}
    for support in grounding_metadata.grounding_supports or []:
        segment = getattr(support, "segment", None)
        text = getattr(segment, "text", None) if segment else None
        if not text:
            continue
        for idx in support.grounding_chunk_indices or []:
            snippets.setdefault(idx, text)
    citations: list[EnrichmentEvidence] = []
    for i, chunk in enumerate(grounding_metadata.grounding_chunks or []):
        web = getattr(chunk, "web", None)
        if web is None or not web.uri:
            continue
        citations.append(
            EnrichmentEvidence(
                title=web.title or web.domain or web.uri,
                url=web.uri,
                snippet=snippets.get(i),
            )
        )
    return citations


# ---- fake path --------------------------------------------------------------

FAKE_SEARCH_INPUT_TOKENS = 900
FAKE_SEARCH_OUTPUT_TOKENS = 150
FAKE_EXTRACT_INPUT_TOKENS = 300
FAKE_EXTRACT_OUTPUT_TOKENS = 60

FAKE_RESOLVED_NAME = "Casper Ghostwriter"
FAKE_MISMATCH_EMPLOYER = "Rival Industries"


def _fake_scenario(name: str, db_company: str | None) -> dict:
    """Deterministic canned step-A result, keyed by name so tests can cover:
    normal match (default), a mismatch ('mismatch' in the name — evidence
    employer differs from db_company), an unidentified person ('nobody' or
    'unknown' in the name), and a blank name that resolves to a public one."""
    key = (name or "").strip().lower()
    if key and ("nobody" in key or "unknown" in key):
        return {"identified": False}
    employer = db_company or "FakeCorp"
    if "mismatch" in key:
        employer = FAKE_MISMATCH_EMPLOYER
    slug = re.sub(r"[^a-z0-9]+", "-", key or "resolved").strip("-") or "resolved"
    scenario = {
        "identified": True,
        "employer": employer,
        "linkedin_url": f"https://www.linkedin.com/in/{slug}",
        "location": "Lisbon, Portugal",
        "lat": 38.7223,
        "lng": -9.1393,
        "footprint": [
            "Spoke at FakeConf 2025 on agent pipelines",
            "Maintains the fakecorp/sdk repository",
        ],
    }
    if not key:
        scenario["resolved_name"] = FAKE_RESOLVED_NAME
    return scenario


def fake_search(name: str, db_company: str | None) -> tuple[str, list[EnrichmentEvidence], UsageStats]:
    """Canned step A: line-structured notes + canned citations, fixed tokens.
    Demo-dataset contacts (public figures) resolve from the knowledge sidecar
    to REAL public facts + real citation URLs; unknown names keep the plain
    canned scenarios (incl. the mismatch/nobody test keys)."""
    from ..demo_knowledge import by_name

    known = by_name(name)
    if known:
        usage = UsageStats(
            input_tokens=FAKE_SEARCH_INPUT_TOKENS,
            output_tokens=FAKE_SEARCH_OUTPUT_TOKENS,
            model=f"fake:{config.GEMINI_MODEL}",
        )
        lines = ["identified: yes", f"employer: {known['company']}"]
        if known.get("linkedin_url"):
            lines.append(f"linkedin: {known['linkedin_url']}")
        if known.get("current_focus"):
            lines.append(f"now: {known['current_focus']}")
        if known.get("how_useful"):
            lines.append(f"useful: {known['how_useful']}")
        lines.extend(f"history: {item}" for item in known.get("history", [])[:8])
        lines.append(f"location: {known['location']}")
        lines.append(f"coords: {known['lat']},{known['lng']}")
        lines.extend(f"footprint: {item}" for item in known.get("footprint", [])[:5])
        citations = [
            EnrichmentEvidence(title=c["title"], url=c["url"])
            for c in known.get("citations", [])
        ]
        return "\n".join(lines), citations, usage

    scenario = _fake_scenario(name, db_company)
    usage = UsageStats(
        input_tokens=FAKE_SEARCH_INPUT_TOKENS,
        output_tokens=FAKE_SEARCH_OUTPUT_TOKENS,
        model=f"fake:{config.GEMINI_MODEL}",
    )
    if not scenario["identified"]:
        text = (
            "identified: no\n"
            "This person could not be confidently identified from public sources."
        )
        return text, [], usage
    lines = ["identified: yes"]
    if scenario.get("resolved_name"):
        lines.append(f"resolved_name: {scenario['resolved_name']}")
    lines.append(f"employer: {scenario['employer']}")
    lines.append(f"linkedin: {scenario['linkedin_url']}")
    lines.append(f"location: {scenario['location']}")
    lines.append(f"coords: {scenario['lat']},{scenario['lng']}")
    lines.extend(f"footprint: {item}" for item in scenario["footprint"])
    citations = [
        EnrichmentEvidence(
            title="LinkedIn profile",
            url=scenario["linkedin_url"],
            snippet=f"Currently at {scenario['employer']}.",
        ),
        EnrichmentEvidence(
            title="FakeConf 2025 speakers",
            url="https://fakeconf.example.com/speakers",
            snippet="Talk: agent pipelines in production.",
        ),
    ]
    return "\n".join(lines), citations, usage


def fake_extract(search_text: str) -> tuple[str, UsageStats]:
    """Canned step B: deterministically extracts the line-structured step A
    notes into EnrichExtract JSON — it truly consumes step A's text."""
    data: dict = {
        "identified": False,
        "linkedin_url": None,
        "current_employer": None,
        "current_focus": None,
        "how_useful": None,
        "history": [],
        "location": None,
        "location_lat": None,
        "location_lng": None,
        "resolved_name": None,
        "footprint": [],
    }
    for line in search_text.splitlines():
        key, sep, value = line.partition(":")
        if not sep:
            continue
        key, value = key.strip().lower(), value.strip()
        if key == "identified":
            data["identified"] = value == "yes"
        elif key == "employer":
            data["current_employer"] = value
        elif key == "linkedin":
            data["linkedin_url"] = value
        elif key == "location":
            data["location"] = value
        elif key == "coords":
            lat_str, sep2, lng_str = value.partition(",")
            if sep2:
                try:
                    data["location_lat"] = float(lat_str)
                    data["location_lng"] = float(lng_str)
                except ValueError:
                    pass
        elif key == "resolved_name":
            data["resolved_name"] = value
        elif key == "now":
            data["current_focus"] = value
        elif key == "useful":
            data["how_useful"] = value
        elif key == "history":
            data["history"].append(value)
        elif key == "footprint":
            data["footprint"].append(value)
    usage = UsageStats(
        input_tokens=FAKE_EXTRACT_INPUT_TOKENS,
        output_tokens=FAKE_EXTRACT_OUTPUT_TOKENS,
        model=f"fake:{config.GEMINI_MODEL}",
    )
    return json.dumps(data), usage


# ---- real path (Google ADK) -------------------------------------------------


def _run_adk_agent(agent, user_text: str) -> tuple[str | None, object, UsageStats]:
    """Drive one LlmAgent to completion via InMemoryRunner (same pattern as
    refine_agent). Returns (final text, grounding_metadata|None, usage).
    Called from FastAPI `def` endpoints / worker threads, so asyncio.run is
    safe: the calling thread has no running event loop."""
    import asyncio

    from google.adk.runners import InMemoryRunner
    from google.genai import types

    runner = InMemoryRunner(agent, app_name="knownworld")
    message = types.Content(role="user", parts=[types.Part(text=user_text)])
    usage = UsageStats()
    grounding_holder: list = []

    async def _invoke() -> str | None:
        session = await runner.session_service.create_session(
            app_name="knownworld", user_id="owner", session_id=uuid.uuid4().hex
        )
        final: str | None = None
        async for event in runner.run_async(
            user_id="owner", session_id=session.id, new_message=message
        ):
            if getattr(event, "partial", False):
                continue
            meta = getattr(event, "usage_metadata", None)
            if meta is not None:  # sum across the tool-use round-trips
                usage.input_tokens += meta.prompt_token_count or 0
                usage.output_tokens += meta.candidates_token_count or 0
            if getattr(event, "model_version", None):
                usage.model = event.model_version
            gm = getattr(event, "grounding_metadata", None)
            if gm is not None:
                grounding_holder.append(gm)
            content = getattr(event, "content", None)
            if content and content.parts and getattr(event, "author", "") != "user":
                texts = [part.text for part in content.parts if getattr(part, "text", None)]
                if texts:
                    final = "".join(texts)
        return final

    final_text = asyncio.run(_invoke())
    grounding = grounding_holder[-1] if grounding_holder else None
    return final_text, grounding, usage


def _real_search(name: str, db_company: str | None) -> tuple[str, list[EnrichmentEvidence], UsageStats]:
    """Step A: grounded search, NO output_schema (tools would be disabled)."""
    try:
        from google.adk.agents import LlmAgent
        from google.adk.tools import google_search

        agent = LlmAgent(
            name="enrich_search",
            description="Grounded research of one contact's public footprint.",
            model=config.GEMINI_MODEL,
            instruction=SEARCH_INSTRUCTION,
            tools=[google_search],
        )
        text, grounding, usage = _run_adk_agent(agent, build_search_query(name, db_company))
        citations = citations_from_grounding(grounding)
    except Exception as exc:  # transport/auth/SDK failure — not a schema issue
        raise ModelCallError(f"enrich search call failed: {exc}") from exc
    if not text:
        raise ModelCallError("enrich search returned no content")
    return text, citations, usage


def _real_extract(search_text: str) -> tuple[str, UsageStats]:
    """Step B: structured extraction, NO tools (output_schema disables them)."""
    try:
        from google.adk.agents import LlmAgent

        agent = LlmAgent(
            name="enrich_extract",
            description="Extracts research notes into the EnrichExtract schema.",
            model=config.GEMINI_MODEL,
            instruction=EXTRACT_INSTRUCTION,
            output_schema=EnrichExtract,
        )
        text, _grounding, usage = _run_adk_agent(agent, search_text)
    except Exception as exc:
        raise ModelCallError(f"enrich extract call failed: {exc}") from exc
    if not text:
        raise ModelCallError("enrich extract returned no content")
    return text, usage


# ---- entry point ------------------------------------------------------------


@dataclass
class EnrichResult:
    extract: EnrichExtract
    citations: list[EnrichmentEvidence] = field(default_factory=list)
    model: str = field(default_factory=lambda: config.GEMINI_MODEL)
    input_tokens: int = 0  # summed across both steps
    output_tokens: int = 0


def run_enrich_pipeline(
    name: str, db_company: str | None, on_search_done=None
) -> EnrichResult:
    """Run step A (grounded search) then step B (structured extract) for one
    person. Raises ModelCallError on transport failure, ModelOutputInvalid
    when step B's output fails schema validation (rejected upstream).
    on_search_done(citation_count) fires between the steps — the live
    Research-again log rides it."""
    if config.FAKE_SEARCH or config.FAKE_LLM:
        text, citations, usage_a = fake_search(name, db_company)
        if on_search_done is not None:
            on_search_done(len(citations))
        raw, usage_b = fake_extract(text)
    elif config.MODEL_BACKEND == "claude":  # dev-only; deploys run Gemini
        from . import claude_backend

        text, citations, usage_a = claude_backend.search_person(
            SEARCH_INSTRUCTION, build_search_query(name, db_company)
        )
        if on_search_done is not None:
            on_search_done(len(citations))
        raw, usage_b = claude_backend.generate_json(
            EXTRACT_INSTRUCTION, text, EnrichExtract, max_tokens=2000
        )
    else:
        text, citations, usage_a = _real_search(name, db_company)
        if on_search_done is not None:
            on_search_done(len(citations))
        raw, usage_b = _real_extract(text)
    extract = parse_extract(raw)
    return EnrichResult(
        extract=extract,
        citations=citations,
        model=usage_a.model,
        input_tokens=usage_a.input_tokens + usage_b.input_tokens,
        output_tokens=usage_a.output_tokens + usage_b.output_tokens,
    )
