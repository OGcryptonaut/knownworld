"""Web scout — the chat's grounded lookup for questions that need FRESH
public facts (conferences, events, news, dates) about the user's own
network, not just the stored rows.

Same two-step shape as enrich (ADK constraint: a tool-bearing agent cannot
carry an output_schema): step A googles with grounding, step B extracts into
a schema-enforced WebAnswer. Privacy boundary: the search input is the
user's own question plus name+company pairs of ALREADY-MATCHED contacts —
never messages, never the whole database.

FAKE_LLM=1: deterministic canned answer so the whole flow tests offline.
"""

from __future__ import annotations

import json

from pydantic import BaseModel

from .. import config
from .enrich import (
    EnrichmentEvidence,
    _run_adk_agent,
    citations_from_grounding,
)
from .refine_agent import ModelCallError, ModelOutputInvalid, UsageStats

# ---- contracts --------------------------------------------------------------


class WebItem(BaseModel):
    title: str
    detail: str  # 1-2 lines: what it is, when, why it answers the question
    url: str | None = None
    # names FROM THE PROVIDED CONTACT LIST this finding involves — resolved
    # to real tg_ids in code upstream, never trusted as-is
    related: list[str] = []


class WebAnswer(BaseModel):
    # 2-5 sentence conversational reply, grounded ONLY in what the search
    # found; honest about gaps ("nothing found for X")
    answer: str
    items: list[WebItem] = []


SEARCH_INSTRUCTION = """\
You answer a user's question about their own professional network using
Google Search. The user message carries the question and a short list of
their network contacts (name — company) the question is about.

Search for CURRENT public facts that answer the question — events,
conferences, announcements, dates, participation. Prefer the named people
and their companies as search anchors. When the question asks WHO attends,
organises or participates in something, run searches for EACH listed
contact (and their company) against that scope — several people usually
qualify; do not stop at the first. Report concrete findings with names,
dates and sources; say plainly when nothing reliable was found. Never
invent an event or a participation claim.
"""

EXTRACT_INSTRUCTION = """\
You are given research notes answering a user's question about their
professional network. Extract them into the required JSON schema:
- answer: a conversational 2-5 sentence reply to the question, grounded
  strictly in the notes — name the concrete findings; be honest about what
  was not found. Never invent.
- items: the concrete findings as separate entries (title, 1-2 line detail
  with dates/participants, source url when the notes carry one, and
  `related`: which of the LISTED contacts each finding involves — copy their
  names exactly as given, never other people). Empty list when the notes
  found nothing.
"""


# ---- fake path --------------------------------------------------------------

FAKE_WEB_INPUT_TOKENS = 600
FAKE_WEB_OUTPUT_TOKENS = 120


def fake_web_answer(question: str, contacts: list[tuple[str, str | None]]):
    names = ", ".join(n for n, _c in contacts[:3]) or "your contacts"
    payload = {
        "answer": (
            f"FAKE web lookup: found 2 current items for '{question[:60]}' "
            f"around {names}."
        ),
        "items": [
            {
                "title": "FakeConf 2026",
                "detail": f"Annual industry conference; {names.split(',')[0]} listed as a speaker.",
                "url": "https://example.com/fakeconf-2026",
                "related": [names.split(",")[0].strip()] if contacts else [],
            },
            {
                "title": "FakeSummit",
                "detail": "Invite-only summit announced for late 2026.",
                "url": None,
                "related": [],
            },
        ],
    }
    citations = [
        EnrichmentEvidence(title="FakeConf 2026", url="https://example.com/fakeconf-2026"),
        EnrichmentEvidence(title="FakeSummit notice", url="https://example.com/fakesummit"),
    ]
    usage = UsageStats(
        input_tokens=FAKE_WEB_INPUT_TOKENS,
        output_tokens=FAKE_WEB_OUTPUT_TOKENS,
        model=f"fake:{config.GEMINI_MODEL}",
    )
    return json.dumps(payload), citations, usage


# ---- entry point ------------------------------------------------------------


def _parse(text: str) -> WebAnswer:
    from pydantic import ValidationError

    try:
        return WebAnswer.model_validate_json(text)
    except ValidationError as exc:
        reasons = [
            f"{'.'.join(str(loc) for loc in err['loc']) or '(root)'}: {err['msg']}"
            for err in exc.errors()
        ]
        raise ModelOutputInvalid(reasons) from exc
    except ValueError as exc:
        raise ModelOutputInvalid([f"web answer is not valid JSON: {exc}"]) from exc


def build_input(question: str, contacts: list[tuple[str, str | None]]) -> str:
    lines = [f"- {name} — {company or 'company unknown'}" for name, company in contacts]
    return f"Question: {question}\n\nNetwork contacts in scope:\n" + "\n".join(lines)


def run_web_answer(
    question: str, contacts: list[tuple[str, str | None]]
) -> tuple[WebAnswer, list[EnrichmentEvidence], UsageStats]:
    """One grounded search + one schema extract. Raises ModelCallError /
    ModelOutputInvalid exactly like every other agent — the caller decides
    how to degrade (the chat falls back to the stored-rows answer)."""
    if config.FAKE_LLM:
        raw, citations, usage = fake_web_answer(question, contacts)
        return _parse(raw), citations, usage

    if config.MODEL_BACKEND == "claude":  # dev-only; deploys run Gemini
        from . import claude_backend

        text, citations, usage_a = claude_backend.search_person(
            SEARCH_INSTRUCTION, build_input(question, contacts)
        )
        raw, usage_b = claude_backend.generate_json(
            EXTRACT_INSTRUCTION, text, WebAnswer, max_tokens=2000
        )
        usage = UsageStats(
            model=usage_a.model,
            input_tokens=usage_a.input_tokens + usage_b.input_tokens,
            output_tokens=usage_a.output_tokens + usage_b.output_tokens,
        )
        return _parse(raw), citations, usage

    from google.adk.agents import LlmAgent
    from google.adk.tools import google_search

    search_agent = LlmAgent(
        name="web_scout_search",
        description="Grounded search answering a network question.",
        model=config.GEMINI_MODEL,
        instruction=SEARCH_INSTRUCTION,
        tools=[google_search],
    )
    try:
        text, grounding, usage_a = _run_adk_agent(
            search_agent, build_input(question, contacts)
        )
    except Exception as exc:  # noqa: BLE001 — normalized like enrich does
        raise ModelCallError(f"web search failed: {exc}") from exc
    if not text:
        raise ModelCallError("web search returned no content")
    citations = citations_from_grounding(grounding)

    extract_agent = LlmAgent(
        name="web_scout_extract",
        description="Extracts the web findings into the answer schema.",
        model=config.GEMINI_MODEL,
        instruction=EXTRACT_INSTRUCTION,
        output_schema=WebAnswer,
    )
    try:
        raw, _g, usage_b = _run_adk_agent(extract_agent, text)
    except Exception as exc:  # noqa: BLE001
        raise ModelCallError(f"web answer extract failed: {exc}") from exc
    if not raw:
        raise ModelCallError("web answer extract returned no content")

    usage = UsageStats(
        model=usage_a.model,
        input_tokens=usage_a.input_tokens + usage_b.input_tokens,
        output_tokens=usage_a.output_tokens + usage_b.output_tokens,
    )
    return _parse(raw), citations, usage
