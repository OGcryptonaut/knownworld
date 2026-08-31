"""Request planner + people matcher + brief composer — the Requests brain.

Three model roles, all schema-enforced, all FAKE-able:

  plan_request(query)          -> PlannerOutput
      Classifies a free-text request over the user's OWN distilled network
      into an executable intent + parameters. The planner never sees people
      data — only the query text.

  match_people(query, people)  -> MatchOutput
      For non-job intents ("who should I meet at a conference in NY",
      "find me partners"): ranks the contacts against the query WITH short
      reasons. Input is distilled rows plus each contact's research card
      (build_people_block) — never messages. tg_ids that don't exist in the
      input are dropped IN CODE upstream.

  compose_brief(query, cards)  -> BriefOutput
      The 'brief' intent's writer: meeting questions, custdev scripts,
      plans — composed over the full cards in scope (+ optional web
      findings) into a lead-in plus titled sections.

FAKE_LLM=1: deterministic keyword planner + overlap-scored matcher + canned
composer, so the whole Requests flow runs with zero GCP.
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
    intent: Literal["jobs", "people", "intro", "brief"]
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
one of four executors. Output must match the JSON schema exactly.

- intent 'jobs': the user wants job opportunities (find a job, openings,
  vacancies, roles to apply for). Fill roles with the role keywords they
  named (e.g. ["backend developer"]); empty list if they didn't narrow it.
  Fill days when they bound recency ("posted in the last 30 days" -> 30).
- intent 'people': WHO-questions — find/rank contacts from their network:
  who to meet, potential partners, investors, clients, mentors, hires,
  experts on a topic.
- intent 'intro': the user asks to WRITE or DRAFT a message to a specific
  person from their network ("draft an intro to Anna", "write to Tobi
  about payments"). Put that person's name in `person`, verbatim.
- intent 'brief': the user asks you to PREPARE or THINK — meeting
  questions, a custdev/interview script, a partnership or fundraising
  plan, "how can X help me", meeting prep, strategy over their network.
  When one contact is clearly the subject, put their name in `person`.
- location: fill for jobs AND people whenever the request is tied to a
  place — a city, a country, or a region, verbatim as the user named it
  ("in New York" -> "New York", "in LA" -> "LA", "from Europe" -> "Europe").
- needs_web: true when answering needs CURRENT public facts that a stored
  contact row cannot hold — events, conferences, announcements, news,
  schedules, dates ("conferences in 2026", "what did X announce lately").
  Applies to 'people' AND 'brief' (e.g. meeting prep benefits from the
  person's latest news). False for pure ranking over the stored network.
- note: one short line restating how you understood the request.
Never invent parameters the user didn't state.
"""

MATCHER_INSTRUCTION = """\
You are given a user's request and their contact list (distilled rows —
tg_id, name, company, role, summary, closeness 0-100 — plus, where research
ran, the full card: location, tags, what they do now, how they can help,
work history, footprint, the owner's own note). Select the
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

_BRIEF_WORDS = (
    "prepare", "questions", "custdev", "interview script", "meeting prep",
    "how can", "strategy", "подготов", "вопрос", "кастдев", "стратег",
)


def fake_plan(query: str) -> tuple[str, UsageStats]:
    lowered = query.lower()
    is_intro = any(word in lowered for word in _INTRO_WORDS)
    is_brief = not is_intro and any(word in lowered for word in _BRIEF_WORDS)
    is_jobs = not is_intro and not is_brief and any(word in lowered for word in _JOB_WORDS)
    days = 30 if "30" in lowered else None
    # naive "in <City>" / "to <Name>" / "with <Name>" captures so structured
    # filters demo offline
    city = re.search(r"\b(?:in|from|around) ([A-Z][\w-]+(?: [A-Z][\w-]+)*)", query)
    person = re.search(r"\b(?:to|with|about) ([A-Z][\w'’-]+(?: [A-Z][\w'’-]+)?)", query)
    intent = (
        "intro" if is_intro else "brief" if is_brief else "jobs" if is_jobs else "people"
    )
    payload = {
        "intent": intent,
        "roles": [],
        "days": days if is_jobs else None,
        "location": city.group(1) if city else None,
        "person": person.group(1) if (intent in ("intro", "brief") and person) else None,
        "needs_web": intent in ("people", "brief")
        and any(w in lowered for w in _WEB_WORDS),
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


def build_people_block(people: list[DistilledPerson], cards: dict | None = None) -> str:
    """Distilled rows (+ each contact's research card when available) — the
    model sees everything the CONTACT CARD shows, never messages. cards maps
    tg_id -> EnrichmentCard."""
    lines = []
    for p in people:
        company = p.company_definite or (
            f"{p.company_inferred} (inferred)" if p.company_inferred else "unknown"
        )
        line = (
            f"tg_id={p.tg_id} | name={p.name or '(unnamed)'} | company={company} | "
            f"role={p.role_guess or 'unknown'} | closeness={p.closeness:.0f} | "
            f"summary={' / '.join(p.summary.splitlines())}"
        )
        card = (cards or {}).get(p.tg_id)
        if card is not None:
            extras = []
            if card.location:
                extras.append(f"location={card.location}")
            if getattr(card, "tags", None):
                extras.append(f"tags={','.join(card.tags)}")
            if card.current_focus:
                extras.append(f"now={' '.join(card.current_focus.split())}")
            if card.how_useful:
                extras.append(f"useful={' '.join(card.how_useful.split())}")
            if card.history:
                extras.append(f"history={' / '.join(card.history[:4])}")
            if card.footprint:
                extras.append(f"footprint={' / '.join(card.footprint[:3])}")
            if extras:
                line += " | " + " | ".join(extras)
        if p.owner_note:
            line += f" | owner_note={' '.join(p.owner_note.split())}"
        lines.append(line)
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
    query: str, people: list[DistilledPerson], cards: dict | None = None
) -> tuple[MatchOutput, UsageStats]:
    if config.FAKE_LLM:
        raw, usage = fake_match(query, people)
    elif config.MODEL_BACKEND == "claude":  # dev-only; deploys run Gemini
        from . import claude_backend

        raw, usage = claude_backend.generate_json(
            MATCHER_INSTRUCTION,
            f"Request: {query}\n\nContacts:\n{build_people_block(people, cards)}",
            MatchOutput,
            max_tokens=4000,
        )
    else:
        user_text = f"Request: {query}\n\nContacts:\n{build_people_block(people, cards)}"
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


# ---- brief composer ---------------------------------------------------------
# The 'brief' intent's writer: meeting questions, custdev scripts,
# partnership plans, "how can X help me" — composed over the FULL cards of
# the relevant contacts (+ optional web findings), schema-enforced.


class BriefSectionOut(BaseModel):
    title: str
    body: str  # plain text; short paragraphs or one bullet per line


class BriefOutput(BaseModel):
    # 2-4 sentence conversational lead-in, honest about what the network
    # does and does not support
    answer: str
    sections: list[BriefSectionOut] = []


COMPOSER_INSTRUCTION = """\
You prepare a practical deliverable answering a user's request about their
own professional network: meeting questions, a custdev/interview script, a
partnership or fundraising plan, meeting prep, "how can this person help
me". You are given the request, the full contact cards in scope (identity,
closeness, what they do now, how they can help, history, footprint, tags,
the owner's note), and possibly fresh web findings.

Write `answer` as a short conversational lead-in (2-4 sentences), then
`sections`: 1-4 titled blocks with the substance — concrete questions, plan
steps, or talking points, one item per line. Ground EVERYTHING strictly in
the provided cards and findings; never invent facts about the contacts. Be
honest when the network doesn't support the ask.
"""

FAKE_COMPOSER_INPUT_TOKENS = 900
FAKE_COMPOSER_OUTPUT_TOKENS = 160


def fake_compose(query: str, contacts_block: str, web_block: str | None):
    first = (contacts_block.splitlines() or ["name=(nobody)"])[0]
    name = "your contact"
    for part in first.split(" | "):
        if part.startswith("name="):
            name = part[5:]
    payload = {
        "answer": (
            f"FAKE composer: a brief for '{query[:60]}' grounded on {name}"
            + (" and web findings." if web_block else ".")
        ),
        "sections": [
            {
                "title": "Questions to ask",
                "body": f"What is {name} focused on right now?\nWhere could you help them first?",
            },
            {
                "title": "Next steps",
                "body": "Send the message this week.\nFollow up in 7 days.",
            },
        ],
    }
    usage = UsageStats(
        input_tokens=FAKE_COMPOSER_INPUT_TOKENS,
        output_tokens=FAKE_COMPOSER_OUTPUT_TOKENS,
        model=f"fake:{config.GEMINI_MODEL}",
    )
    return json.dumps(payload), usage


def compose_brief(
    query: str, contacts_block: str, web_block: str | None = None
) -> tuple[BriefOutput, UsageStats]:
    user_text = f"Request: {query}\n\nContact cards in scope:\n{contacts_block}"
    if web_block:
        user_text += f"\n\nFresh web findings:\n{web_block}"
    if config.FAKE_LLM:
        raw, usage = fake_compose(query, contacts_block, web_block)
    elif config.MODEL_BACKEND == "claude":  # dev-only; deploys run Gemini
        from . import claude_backend

        raw, usage = claude_backend.generate_json(
            COMPOSER_INSTRUCTION, user_text, BriefOutput, max_tokens=3000
        )
    else:
        try:
            raw, usage = _run_schema_agent(
                "brief_composer",
                "Composes a practical network brief.",
                COMPOSER_INSTRUCTION,
                BriefOutput,
                user_text,
            )
        except (ModelOutputInvalid, ModelCallError):
            raise
        except Exception as exc:
            raise ModelCallError(f"composer call failed: {exc}") from exc
    return _parse(BriefOutput, raw), usage
