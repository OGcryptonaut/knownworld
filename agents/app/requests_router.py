"""Requests endpoints (v2) — AI queries over the user's OWN distilled network.

  POST /requests      {query, profile?} -> UserRequest (executed inline)
  GET  /requests      -> UserRequest[] (newest first)
  GET  /requests/{id} -> UserRequest

Flow, per request:
  1. planner (schema-enforced model call; query text only) -> intent+params
  2. intent 'jobs':   the existing job scout (public ATS feeds, in-code
     role-fit) with the planner's roles overriding the profile's targetRoles
     and an optional posted-within-days window applied IN CODE.
     intent 'people': the matcher model ranks distilled rows with reasons;
     tg_ids not present in the DB are dropped IN CODE, joined fields
     (name/company/closeness) come from the DB rows — never from the model.
  3. The result snapshot persists on the request doc (re-asking later is the
     point: feeds move, the network moves).

Malformed model output -> request status 'rejected' WITH reasons (never
silently patched). Transport failure -> status 'error'. Telemetry per model
call: agent 'planner' / 'matcher', resolved model, tokens, cost, duration.
"""

from __future__ import annotations

import asyncio
import re
import time
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import config, geo
from .agents import planner as planner_agent
from .agents.refine_agent import ModelCallError, ModelOutputInvalid
from .jobs_router import JobsRunRequest, jobs_run
from .jobs_store import RoleFitProfile, get_jobs_store
from .requests_store import (
    RequestPeopleMatch,
    RequestResult,
    UserRequest,
    get_requests_store,
)
from .schemas import ActivityEntry
from .store import get_store

router = APIRouter()

MAX_POSTINGS_SNAPSHOT = 100


_ID_RE = re.compile(r"^[0-9a-f]{32}$")


class CreateRequestBody(BaseModel):
    query: str
    profile: RoleFitProfile | None = None
    # client-supplied id (uuid hex) so the UI can watch this run's activity
    # log from the very first second — the doc is upserted 'running' under
    # this id before any model call
    id: str | None = None
    # set on a follow-up: the first request's id. Prior answers in the
    # thread become CONTEXT for the planner/matcher — iterating over the
    # same question is the point (feeds move, a second pass digs deeper).
    thread_id: str | None = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _place_matcher(location: str):
    """Deterministic in-code place matcher: understands city shorthands
    ("LA" -> the Los Angeles area), countries, and regions ("Europe" ->
    European countries and their cities); unknown places fall back to a
    word-bounded phrase match. Lives in geo.py."""
    return geo.location_predicate(location)


def _parse_when(raw: str | None) -> datetime | None:
    """Feed timestamps arrive in mixed shapes (tz offsets, date-only). Parse
    to a real instant; unparseable counts as 'no date' — never guessed."""
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _log(agent: str, run_id: str, usage, started: float, status: str, detail: str) -> None:
    cost, cost_note = config.estimate_cost(usage.model, usage.input_tokens, usage.output_tokens)
    if cost_note:
        detail = f"{detail}; {cost_note}"
    get_store().log_activity(
        ActivityEntry(
            ts=_now_iso(),
            agent=agent,
            model=usage.model,
            run_id=run_id,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            est_cost_usd=cost,
            duration_ms=int((time.monotonic() - started) * 1000),
            status=status,
            detail=detail,
        )
    )


async def _execute_jobs(
    request_doc: UserRequest, plan: planner_agent.PlannerOutput, profile: RoleFitProfile
) -> RequestResult:
    if plan.roles:
        profile = profile.model_copy(update={"targetRoles": plan.roles})
    run_started = _now_iso()
    summary = await jobs_run(JobsRunRequest(profile=profile))
    # snapshot ONLY what this run fetched — the postings store accumulates
    # across runs, and stale rows carry fit flags from other requests' roles
    postings = [
        p for p in get_jobs_store().get_postings(fit_only=True) if p.fetched_at >= run_started
    ]

    # the asked-for place narrows postings IN CODE (an "in New York" question
    # must not answer with Bangkok); the matcher understands shorthands,
    # metros, countries and regions ("LA", "Europe" — geo.py). Zero matches
    # fall back to the full set with honest stats AND an answer that says so
    # out loud — never a silent pile of elsewhere-postings.
    location_matched = None
    if plan.location:
        here = _place_matcher(plan.location)
        located = [p for p in postings if here(p.location)]
        location_matched = len(located)
        if located:
            postings = located

    dropped_no_date = 0
    if plan.days is not None:
        cutoff_dt = datetime.now(timezone.utc) - timedelta(days=plan.days)
        dated = []
        for posting in postings:
            posted = _parse_when(posting.posted_at)
            if posted is None:
                dropped_no_date += 1  # honest: unknown date != recent
                continue
            if posted >= cutoff_dt:
                dated.append(posting)
        postings = dated

    truncated = max(0, len(postings) - MAX_POSTINGS_SNAPSHOT)

    # the agent's chat reply, composed in code from the honest numbers —
    # no model in the jobs loop, so no model in the sentence either
    roles_txt = " / ".join(plan.roles) if plan.roles else "role-fit"
    window_txt = f" posted in the last {plan.days} days" if plan.days else ""
    n = len(postings)
    if plan.location and location_matched == 0:
        answer = (
            f"I could not find any {roles_txt} postings in {plan.location}{window_txt} "
            f"across your network's live feeds this run."
        )
        answer += (
            f" Here are the {min(n, MAX_POSTINGS_SNAPSHOT)} that matched everywhere else."
            if n
            else " Nothing outside that window survived either — feeds move, ask again soon."
        )
    elif n == 0:
        answer = (
            f"No {roles_txt} postings{window_txt} survived this run"
            + (f" in {plan.location}" if plan.location else "")
            + f" — {summary.postings_fit} fit before the filters, the stats below show "
            "exactly what was dropped."
        )
    else:
        answer = (
            f"Found {n} {roles_txt} posting(s)"
            + (f" in {plan.location}" if plan.location else "")
            + f"{window_txt}, out of {summary.postings_total} scanned across "
            f"{summary.companies_with_slug} live feeds. Warm paths are on each posting."
        )

    return RequestResult(
        kind="jobs",
        answer=answer,
        postings=postings[:MAX_POSTINGS_SNAPSHOT],
        stats={
            "companies_total": summary.companies_total,
            "companies_with_feed": summary.companies_with_slug,
            "postings_total": summary.postings_total,
            "postings_fit": summary.postings_fit,
            "window_days": plan.days,
            "dropped_no_posted_date": dropped_no_date,
            "truncated": truncated,
            **(
                {"location_filter": plan.location, "location_matched": location_matched}
                if plan.location
                else {}
            ),
        },
    )


MATCH_TOP = 15
MATCH_OVERSAMPLE = 4  # atlas --ask shape: candidates = top x4, model ranks survivors


def _execute_people(
    request_doc: UserRequest,
    plan: planner_agent.PlannerOutput,
    effective_query: str | None = None,
) -> RequestResult:
    people = [p for p in get_store().get_people() if p.work_relevant]
    if not people:
        return RequestResult(kind="people", matches=[], stats={"considered": 0})

    # Structured-first (adopted from atlas-crm's semantic∩structured join):
    # code filters narrow the candidate set BEFORE any model sees it; the
    # model only ranks survivors and its order is preserved. The place
    # matcher understands shorthands, metros, countries and regions ("LA",
    # "Europe" — geo.py); even ONE located contact is the right answer to a
    # place-bound question ("who's in Europe?" -> that one person). Only a
    # zero-match place falls back to the full set with honest stats.
    candidates = people
    city_matched = None
    if plan.location:
        here = _place_matcher(plan.location)
        located = [p for p in people if here(p.location)]
        city_matched = len(located)
        if located:
            candidates = located
    candidates = sorted(candidates, key=lambda p: p.closeness, reverse=True)[
        : MATCH_TOP * MATCH_OVERSAMPLE
    ]

    started = time.monotonic()
    output, usage = planner_agent.match_people(effective_query or request_doc.query, candidates)
    by_id = {p.tg_id: p for p in candidates}
    matches: list[RequestPeopleMatch] = []
    dropped = 0
    for match in output.matches:
        person = by_id.get(match.tg_id)
        if person is None:
            dropped += 1  # hallucinated tg_id — dropped in code
            continue
        matches.append(
            RequestPeopleMatch(
                tg_id=person.tg_id,
                name=person.name,
                company=person.company_definite or person.company_inferred,
                role_guess=person.role_guess,
                closeness=person.closeness,
                reason=match.reason,
            )
        )
    _log(
        "matcher",
        request_doc.id,
        usage,
        started,
        "ok",
        f"{len(matches)} match(es) from {len(people)} contacts"
        + (f", {dropped} unknown tg_id(s) dropped" if dropped else ""),
    )
    stats: dict = {
        "considered": len(people),
        "candidates": len(candidates),
        "dropped_unknown": dropped,
    }
    if plan.location:
        stats["city_filter"] = plan.location
        stats["city_matched"] = city_matched
    return RequestResult(
        kind="people",
        answer=(output.answer or "").strip() or None,
        matches=matches[:MATCH_TOP],
        stats=stats,
    )


def _thread_context(store, thread_id: str) -> str | None:
    """Compress the thread's prior answers into one context line. The model
    sees counts and intents, never person data beyond what matching already
    uses — iteration context, not a data channel."""
    prior = [
        r
        for r in store.get_all()
        if (r.thread_id or r.id) == thread_id and r.status == "done"
    ]
    prior.sort(key=lambda r: r.created_at)
    parts = []
    for r in prior[-2:]:
        if r.result is None:
            continue
        n = len(r.result.postings) if r.result.kind == "jobs" else len(r.result.matches)
        parts.append(f"'{r.query}' -> intent {r.intent}, {n} result(s)")
    return "; ".join(parts) or None


def _execute_intro(
    request_doc: UserRequest,
    plan: planner_agent.PlannerOutput,
    effective_query: str | None = None,
) -> RequestResult:
    """Chat-requested intro/message. The target resolves IN CODE by name
    substring over the user's own contacts (best closeness wins); an
    unresolved name gets an honest empty answer, never a guess. The drafter
    grounds only on the stored summary + code-computed closeness. The app
    never sends anything — copy-out only."""
    from .agents import drafter

    people = [p for p in get_store().get_people() if p.work_relevant]
    name_q = (plan.person or "").strip().lower()
    target = None
    if name_q:
        candidates = [p for p in people if name_q in (p.name or "").lower()]
        target = max(candidates, key=lambda p: p.closeness, default=None)
    if target is None:
        return RequestResult(
            kind="intro",
            stats={
                "person_query": plan.person,
                "resolved": False,
                "considered": len(people),
            },
        )

    started = time.monotonic()
    # the drafter gets the owner's OWN words only — the thread-context
    # preamble is planner food and must never leak into the message text
    result = drafter.run_intro(
        first_name=(target.name or "there").split()[0],
        summary=target.summary,
        closeness=target.closeness,
        ask=request_doc.query,
    )
    _log(
        "drafter",
        request_doc.id,
        planner_agent.UsageStats(
            model=result.model,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
        ),
        started,
        "ok",
        f"chat intro drafted for tg {target.tg_id}",
    )
    return RequestResult(
        kind="intro",
        message=result.message,
        intro_to=RequestPeopleMatch(
            tg_id=target.tg_id,
            name=target.name,
            company=target.company_definite or target.company_inferred,
            role_guess=target.role_guess,
            closeness=target.closeness,
            reason="the person you asked to write to",
        ),
        stats={"person_query": plan.person, "resolved": True, "considered": len(people)},
    )


@router.post("/requests", response_model=UserRequest)
async def create_request(body: CreateRequestBody) -> UserRequest:
    query = body.query.strip()
    if not query:
        raise HTTPException(status_code=422, detail="query must not be empty")
    if body.id is not None and not _ID_RE.match(body.id):
        raise HTTPException(status_code=422, detail="id must be 32 hex chars")
    if body.thread_id is not None and not _ID_RE.match(body.thread_id):
        raise HTTPException(status_code=422, detail="thread_id must be 32 hex chars")

    store = get_requests_store()
    request_id = body.id or uuid.uuid4().hex
    request_doc = UserRequest(
        id=request_id,
        query=query,
        status="running",
        created_at=_now_iso(),
        thread_id=body.thread_id or request_id,
    )
    store.upsert(request_doc)

    # follow-ups carry the thread's earlier answers as plain-text context —
    # the planner and matcher see the conversation, not just the last line
    context = _thread_context(store, body.thread_id) if body.thread_id else None
    effective_query = (
        f"(Earlier in this conversation: {context})\n{query}" if context else query
    )

    started = time.monotonic()
    try:
        # ADK drives its runner with asyncio.run(); this endpoint is async, so
        # model calls must leave the event loop (to_thread copies the tenant
        # contextvar — isolation holds)
        plan, usage = await asyncio.to_thread(planner_agent.plan_request, effective_query)
    except ModelOutputInvalid as exc:
        _log("planner", request_doc.id, planner_agent.UsageStats(), started, "rejected",
             f"planner output failed schema validation: {len(exc.reasons)} reason(s)")
        request_doc = request_doc.model_copy(
            update={
                "status": "rejected",
                "rejected_reasons": exc.reasons,
                "finished_at": _now_iso(),
            }
        )
        store.upsert(request_doc)
        return request_doc
    except ModelCallError as exc:
        request_doc = request_doc.model_copy(
            update={"status": "error", "error": str(exc), "finished_at": _now_iso()}
        )
        store.upsert(request_doc)
        return request_doc
    except Exception as exc:  # noqa: BLE001 — a doc must NEVER stay 'running'
        request_doc = request_doc.model_copy(
            update={"status": "error", "error": f"unexpected: {exc}", "finished_at": _now_iso()}
        )
        store.upsert(request_doc)
        return request_doc

    _log("planner", request_doc.id, usage, started, "ok",
         f"intent={plan.intent}; roles={plan.roles or '-'}; days={plan.days or '-'}")
    request_doc = request_doc.model_copy(
        update={"intent": plan.intent, "note": plan.note, "params": plan.model_dump()}
    )
    store.upsert(request_doc)

    try:
        if plan.intent == "jobs":
            result = await _execute_jobs(request_doc, plan, body.profile or RoleFitProfile())
        elif plan.intent == "intro":
            result = await asyncio.to_thread(
                _execute_intro, request_doc, plan, effective_query
            )
        else:
            result = await asyncio.to_thread(
                _execute_people, request_doc, plan, effective_query
            )
    except ModelOutputInvalid as exc:
        request_doc = request_doc.model_copy(
            update={
                "status": "rejected",
                "rejected_reasons": exc.reasons,
                "finished_at": _now_iso(),
            }
        )
        store.upsert(request_doc)
        return request_doc
    except ModelCallError as exc:
        request_doc = request_doc.model_copy(
            update={"status": "error", "error": str(exc), "finished_at": _now_iso()}
        )
        store.upsert(request_doc)
        return request_doc
    except Exception as exc:  # noqa: BLE001 — a doc must NEVER stay 'running'
        request_doc = request_doc.model_copy(
            update={"status": "error", "error": f"unexpected: {exc}", "finished_at": _now_iso()}
        )
        store.upsert(request_doc)
        return request_doc

    request_doc = request_doc.model_copy(
        update={"status": "done", "result": result, "finished_at": _now_iso()}
    )
    store.upsert(request_doc)
    return request_doc


@router.get("/requests", response_model=list[UserRequest])
def list_requests() -> list[UserRequest]:
    return get_requests_store().get_all()


@router.get("/requests/{request_id}", response_model=UserRequest)
def get_request(request_id: str) -> UserRequest:
    request_doc = get_requests_store().get(request_id)
    if request_doc is None:
        raise HTTPException(status_code=404, detail=f"no request {request_id}")
    return request_doc
