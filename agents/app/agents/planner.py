"""Request planner + people matcher (v2) — the 'Requests' page brain.

Two model roles, both schema-enforced, both FAKE-able:

  plan_request(query)          -> PlannerOutput
      Classifies a free-text request over the user's OWN distilled network
      into an executable intent + parameters. The planner never sees people
      data — only the query text.

  match_people(query, people)  -> MatchOutput
      For non-job intents ("who should I meet at a conference in NY",
      "find me partners"): ranks the distilled contacts against the query
      WITH short reasons. Input is distilled rows only (name, company, role,
      summary, closeness, location) — never messages. tg_ids that don't
      exist in the input are dropped IN CODE upstream.

FAKE_LLM=1: deterministic keyword planner + closeness-ranked matcher, so the
whole Requests flow runs with zero GCP.
"""

from __future__ import annotations

import json
import re
from typing import Literal

from pydantic import BaseModel, Field

from .. import config
from ..schemas import DistilledPerson
from .refine_agent import ModelCallError, ModelOutputInvalid, UsageStats

# ---- contracts (mirror web/src/lib/types.ts) --------------------------------


class PlannerOutput(BaseModel):
    intent: Literal["jobs", "people", "intro"]
    # jobs: role keywords to filter postings with (empty -> whole role-fit profile)
    roles: list[str] = []
    # jobs: only postings published within this many days (null -> no window)
    days: int | None = Field(default=None, ge=1, le=365)
    location: str | None = None
    # intro: the name of the contact the user wants to write to
    person: str | None = None
    # people: the answer needs FRESH public facts (events, conferences,
    # news, dates) beyond the stored rows -> a grounded web pass runs
    needs_web: bool = False
    note: str  # one-line interpretation shown to the user


class PersonMatch(BaseModel):
    tg_id: int
    reason: str  # one line, grounded in the distilled row


class MatchOutput(BaseModel):
    matches: list[PersonMatch]
    # 1-3 sentence conversational reply, grounded ONLY in the matches
    # (older docs / minimal payloads may omit it)
    answer: str = ""


PLANNER_INSTRUCTION = """\
You route a user's free-text request about their own professional network to
one of three executors. Output must match the JSON schema exactly.

- intent 'jobs': the user wants job opportunities (find a job, openings,
  vacancies, roles to apply for). Fill roles with the role keywords they
  named (e.g. ["backend developer"]); empty list if they didn't narrow it.
  Fill days when they bound recency ("posted in the last 30 days" -> 30).
- intent 'people': anything answered by PEOPLE from their network — who to
  meet at a conference, potential partners/clients/mentors/hires.
- intent 'intro': the user asks to WRITE or DRAFT a message to a specific
  person from their network ("draft an intro to Anna", "write to Tobi
  about payments"). Put that person's name in `person`, verbatim.
- location: fill for jobs AND people whenever the request is tied to a
  place — a city, a country, or a region, verbatim as the user named it
  ("in New York" -> "New York", "in LA" -> "LA", "from Europe" -> "Europe").
- needs_web: true when answering needs CURRENT public facts that a stored
  contact row cannot hold — events, conferences, announcements, news,
  schedules, dates ("conferences in 2026", "what did X announce lately").
  False for pure who-should-I-meet ranking over the stored network.
- note: one short line restating how you understood the request.
Never invent parameters the user didn't state.
"""

MATCHER_INSTRUCTION = """\
You are given a user's request and their contact list (distilled rows:
tg_id, name, company, role, summary, closeness 0-100, location). Select the
contacts that genuinely fit the request and give each a one-line reason
grounded ONLY in their row — never invent facts. Prefer relevance over
closeness; ties break toward higher closeness. Return at most 15 matches;
an empty list is a valid answer.

Also write `answer`: a short conversational reply (1-3 sentences) to the
user's request, as if answering them in a chat — name the best matches and
why they fit, or say honestly that nothing in their network fits. Ground it
ONLY in the matches you selected; never invent people or facts.
Output must match the JSON schema exactly.
"""


# ---- fake paths -------------------------------------------------------------

FAKE_PLANNER_INPUT_TOKENS = 220
FAKE_PLANNER_OUTPUT_TOKENS = 40
FAKE_MATCHER_INPUT_TOKENS = 800
FAKE_MATCHER_OUTPUT_TOKENS = 90

_JOB_WORDS = ("job", "vacanc", "opening", "position", "hiring", "career", "работ", "ваканс")


_INTRO_WORDS = ("intro", "draft", "write to", "message to", "интро", "напиши")

_WEB_WORDS = ("conference", "event", "summit", "news", "announce", "конференц", "новост")


def fake_plan(query: str) -> tuple[str, UsageStats]:
    lowered = query.lower()
    is_intro = any(word in lowered for word in _INTRO_WORDS)
    is_jobs = not is_intro and any(word in lowered for word in _JOB_WORDS)
    days = 30 if "30" in lowered else None
    # naive "in <City>" / "to <Name>" captures so structured filters demo offline
    city = re.search(r"\b(?:in|from|around) ([A-Z][\w-]+(?: [A-Z][\w-]+)*)", query)
    person = re.search(r"\bto ([A-Z][\w'’-]+(?: [A-Z][\w'’-]+)?)", query)
    intent = "intro" if is_intro else ("jobs" if is_jobs else "people")
    payload = {
        "intent": intent,
        "roles": [],
        "days": days if is_jobs else None,
        "location": city.group(1) if city else None,
        "person": person.group(1) if (is_intro and person) else None,
        "needs_web": intent == "people" and any(w in lowered for w in _WEB_WORDS),
        "note": f"FAKE planner: routed to '{intent}' by keyword.",
    }
    usage = UsageStats(
        input_tokens=FAKE_PLANNER_INPUT_TOKENS,
        output_tokens=FAKE_PLANNER_OUTPUT_TOKENS,
        model=f"fake:{config.GEMINI_MODEL}",
    )
    return json.dumps(payload), usage


def fake_match(query: str, people: list[DistilledPerson]) -> tuple[str, UsageStats]:
    """Deterministic matcher. Demo-dataset contacts score on real overlap
    between the query and their sidecar facts (tags/company/role/city), so
    the no-credentials demo answers 'who should I meet about X in Y' with
    grounded reasons; unknown contacts fall back to closeness ranking."""
    from ..demo_knowledge import by_tg_id

    query_words = {w for w in re.findall(r"[a-zA-Z][a-zA-Z-]*", query.lower()) if len(w) >= 2}

    scored: list[tuple[float, DistilledPerson, str]] = []
    for p in people:
        known = by_tg_id(p.tg_id)
        if known:
            tags = [t.lower() for t in known.get("tags", [])]
            hay_city = known.get("location", "").lower()
            # short words ("ai", "vr") count only on exact tag match — substring
            # matching on 2-letter words would false-positive everywhere
            tag_hits = sorted(
                {
                    t
                    for t in tags
                    for w in query_words
                    if (len(w) > 2 and (w in t or t in w)) or w == t
                }
            )
            city_hit = any(w in hay_city for w in query_words)
            score = 2.0 * len(tag_hits) + (3.0 if city_hit else 0.0) + p.closeness / 100.0
            why = [f"{known['role']} at {known['company']}"]
            if tag_hits:
                why.append(f"works in {', '.join(tag_hits)}")
            if city_hit:
                why.append(f"based in {known['location']}")
            why.append(f"closeness {p.closeness:.0f}")
            reason = "; ".join(why) + "."
        else:
            score = p.closeness / 100.0
            reason = f"Work-relevant contact, closeness {p.closeness:.0f}."
        scored.append((score, p, reason))

    scored.sort(key=lambda item: (-item[0], -item[1].closeness))
    top = [item for item in scored if item[0] > 0][:8]
    if top:
        names = ", ".join((p.name or "(unnamed)") for _s, p, _r in top[:3])
        answer = (
            f"From your network, {len(top)} contact(s) fit this: {names}"
            + (" and more below." if len(top) > 3 else ".")
        )
    else:
        answer = "Nothing in your network fits this one — honestly, no match."
    payload = {
        "matches": [{"tg_id": p.tg_id, "reason": reason} for _score, p, reason in top],
        "answer": f"FAKE matcher: {answer}",
    }
    usage = UsageStats(
        input_tokens=FAKE_MATCHER_INPUT_TOKENS,
        output_tokens=FAKE_MATCHER_OUTPUT_TOKENS,
        model=f"fake:{config.GEMINI_MODEL}",
    )
    return json.dumps(payload), usage


# ---- validation -------------------------------------------------------------


def _parse(model_cls, text: str):
    from pydantic import ValidationError

    try:
        return model_cls.model_validate_json(text)
    except ValidationError as exc:
        reasons = [
            f"{'.'.join(str(loc) for loc in err['loc']) or '(root)'}: {err['msg']}"
            for err in exc.errors()
        ]
        raise ModelOutputInvalid(reasons) from exc
    except ValueError as exc:
        raise ModelOutputInvalid([f"model output is not valid JSON: {exc}"]) from exc


# ---- real paths (Google ADK) ------------------------------------------------


def _run_schema_agent(name: str, description: str, instruction: str, schema, user_text: str):
    from google.adk.agents import LlmAgent

    from .enrich import _run_adk_agent

    agent = LlmAgent(
        name=name,
        description=description,
        model=config.GEMINI_MODEL,
        instruction=instruction,
        output_schema=schema,
    )
    text, _grounding, usage = _run_adk_agent(agent, user_text)
    if not text:
        raise ModelCallError(f"{name} returned no content")
    return text, usage


def build_people_block(people: list[DistilledPerson]) -> str:
    """Distilled rows only — the matcher never sees messages."""
    lines = []
    for p in people:
        company = p.company_definite or (
            f"{p.company_inferred} (inferred)" if p.company_inferred else "unknown"
        )
        lines.append(
            f"tg_id={p.tg_id} | name={p.name or '(unnamed)'} | company={company} | "
            f"role={p.role_guess or 'unknown'} | closeness={p.closeness:.0f} | "
            f"summary={' / '.join(p.summary.splitlines())}"
        )
    return "\n".join(lines)


# ---- entry points -----------------------------------------------------------


def plan_request(query: str) -> tuple[PlannerOutput, UsageStats]:
    if config.FAKE_LLM:
        raw, usage = fake_plan(query)
    elif config.MODEL_BACKEND == "claude":  # dev-only; deploys run Gemini
        from . import claude_backend

        raw, usage = claude_backend.generate_json(
            PLANNER_INSTRUCTION, query, PlannerOutput, max_tokens=1000
        )
    else:
        try:
            raw, usage = _run_schema_agent(
                "request_planner",
                "Routes a network request to an executable intent.",
                PLANNER_INSTRUCTION,
                PlannerOutput,
                query,
            )
        except ModelOutputInvalid:
            raise
        except ModelCallError:
            raise
        except Exception as exc:
            raise ModelCallError(f"planner call failed: {exc}") from exc
    return _parse(PlannerOutput, raw), usage


def match_people(
    query: str, people: list[DistilledPerson]
) -> tuple[MatchOutput, UsageStats]:
    if config.FAKE_LLM:
        raw, usage = fake_match(query, people)
    elif config.MODEL_BACKEND == "claude":  # dev-only; deploys run Gemini
        from . import claude_backend

        raw, usage = claude_backend.generate_json(
            MATCHER_INSTRUCTION,
            f"Request: {query}\n\nContacts:\n{build_people_block(people)}",
            MatchOutput,
            max_tokens=4000,
        )
    else:
        user_text = f"Request: {query}\n\nContacts:\n{build_people_block(people)}"
        try:
            raw, usage = _run_schema_agent(
                "people_matcher",
                "Ranks distilled contacts against a request.",
                MATCHER_INSTRUCTION,
                MatchOutput,
                user_text,
            )
        except ModelOutputInvalid:
            raise
        except ModelCallError:
            raise
        except Exception as exc:
            raise ModelCallError(f"matcher call failed: {exc}") from exc
    return _parse(MatchOutput, raw), usage
