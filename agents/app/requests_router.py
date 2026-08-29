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

import time
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import config
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


class CreateRequestBody(BaseModel):
    query: str
    profile: RoleFitProfile | None = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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
    summary = await jobs_run(JobsRunRequest(profile=profile))
    postings = get_jobs_store().get_postings(fit_only=True)

    dropped_no_date = 0
    if plan.days is not None:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=plan.days)).isoformat()
        dated = []
        for posting in postings:
            if posting.posted_at is None:
                dropped_no_date += 1  # honest: unknown date != recent
                continue
            if posting.posted_at >= cutoff:
                dated.append(posting)
        postings = dated

    truncated = max(0, len(postings) - MAX_POSTINGS_SNAPSHOT)
    return RequestResult(
        kind="jobs",
        postings=postings[:MAX_POSTINGS_SNAPSHOT],
        stats={
            "companies_total": summary.companies_total,
            "companies_with_feed": summary.companies_with_slug,
            "postings_total": summary.postings_total,
            "postings_fit": summary.postings_fit,
            "window_days": plan.days,
            "dropped_no_posted_date": dropped_no_date,
            "truncated": truncated,
        },
    )


def _execute_people(request_doc: UserRequest, plan: planner_agent.PlannerOutput) -> RequestResult:
    people = [p for p in get_store().get_people() if p.work_relevant]
    if not people:
        return RequestResult(kind="people", matches=[], stats={"considered": 0})
    started = time.monotonic()
    output, usage = planner_agent.match_people(request_doc.query, people)
    by_id = {p.tg_id: p for p in people}
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
    return RequestResult(
        kind="people",
        matches=matches,
        stats={"considered": len(people), "dropped_unknown": dropped},
    )


@router.post("/requests", response_model=UserRequest)
async def create_request(body: CreateRequestBody) -> UserRequest:
    query = body.query.strip()
    if not query:
        raise HTTPException(status_code=422, detail="query must not be empty")

    store = get_requests_store()
    request_doc = UserRequest(
        id=uuid.uuid4().hex,
        query=query,
        status="running",
        created_at=_now_iso(),
    )
    store.upsert(request_doc)

    started = time.monotonic()
    try:
        plan, usage = planner_agent.plan_request(query)
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

    _log("planner", request_doc.id, usage, started, "ok",
         f"intent={plan.intent}; roles={plan.roles or '-'}; days={plan.days or '-'}")
    request_doc = request_doc.model_copy(
        update={"intent": plan.intent, "note": plan.note, "params": plan.model_dump()}
    )
    store.upsert(request_doc)

    try:
        if plan.intent == "jobs":
            result = await _execute_jobs(request_doc, plan, body.profile or RoleFitProfile())
        else:
            result = _execute_people(request_doc, plan)
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
