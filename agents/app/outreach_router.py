"""Outreach drafter + pipeline endpoints (D3).

Contract (mirrors web/src/lib/types.ts):
  POST  /outreach/draft   DraftRequest -> DraftResponse   (SELECTION-ONLY: the
        user picked this position+contact; 422 if the contact has a blank name
        — never draft to a nameless row)
  POST  /pipeline         {tg_id, job_id?, stage?, note?, follow_up_date?, draft_message?} -> PipelineItem
  GET   /pipeline         -> PipelineItem[]
  PATCH /pipeline/{id}    {stage?, follow_up_date?, note?, draft_message?} -> PipelineItem

Product rules enforced here, IN CODE:
- Drafts happen ONLY for a user-selected position + contact — this endpoint
  IS the selection; there is no pre-drafting anywhere.
- Nameless contacts are excluded from outreach (422) — never draft, never
  pipeline, a row with a blank name.
- The app never sends messages anywhere, on any channel: the draft is
  returned for the user to copy into Telegram themselves.
- Grounding/privacy boundary: the drafter sees ONLY distilled data — the
  contact's first name, their stored 2-line summary, code-computed closeness,
  and the selected job's title + company. grounded_on echoes exactly that.
- Malformed model output -> 422 rejected WITH reasons + activity 'rejected'.
- Per-call telemetry: agent 'drafter', resolved model, tokens, est cost,
  duration, detail 'draft for tg N re <company>'.
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import config
from .agents import drafter as drafter_agent
from .agents.refine_agent import ModelCallError, ModelOutputInvalid
from .jobs_store import JobPosting, get_jobs_store
from .pipeline_store import PIPELINE_STAGES, PipelineItem, get_pipeline_store
from .schemas import ActivityEntry, DistilledPerson
from .store import get_store

router = APIRouter()

NAMELESS_DETAIL = "nameless contacts are excluded from outreach"


# ---- request / response models (mirror web/src/lib/types.ts) ----------------


class DraftRequest(BaseModel):
    tg_id: int
    job_id: str  # JobPosting.id


class GroundedOn(BaseModel):
    summary: str
    closeness: float
    title: str
    company: str


class DraftResponse(BaseModel):
    message: str  # the user copies this into Telegram themselves
    grounded_on: GroundedOn
    activity: ActivityEntry


class PipelineCreateRequest(BaseModel):
    tg_id: int
    job_id: str | None = None
    stage: str = "lead"
    note: str = ""
    follow_up_date: str | None = None
    draft_message: str | None = None


class PipelinePatchRequest(BaseModel):
    stage: str | None = None
    follow_up_date: str | None = None
    note: str | None = None
    draft_message: str | None = None


# ---- helpers ----------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_person(tg_id: int) -> DistilledPerson:
    person = next((p for p in get_store().get_people() if p.tg_id == tg_id), None)
    if person is None:
        raise HTTPException(status_code=404, detail=f"person tg_id {tg_id} not found")
    return person


def _require_named(person: DistilledPerson) -> str:
    """Product rule: never draft/pipeline a blank-named contact (422)."""
    name = (person.name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail=NAMELESS_DETAIL)
    return name


def _get_job(job_id: str) -> JobPosting:
    job = next((p for p in get_jobs_store().get_postings() if p.id == job_id), None)
    if job is None:
        raise HTTPException(status_code=404, detail=f"job '{job_id}' not found")
    return job


def _validate_stage(stage: str) -> str:
    if stage not in PIPELINE_STAGES:
        raise HTTPException(
            status_code=422,
            detail=f"invalid stage '{stage}' — must be one of: {', '.join(PIPELINE_STAGES)}",
        )
    return stage


def _activity(
    *,
    model: str,
    run_id: str,
    input_tokens: int,
    output_tokens: int,
    duration_ms: int,
    status: str,
    detail: str | None = None,
) -> ActivityEntry:
    cost, cost_note = config.estimate_cost(model, input_tokens, output_tokens)
    if cost_note:
        detail = f"{detail}; {cost_note}" if detail else cost_note
    return ActivityEntry(
        ts=_now_iso(),
        agent="drafter",
        model=model,
        run_id=run_id,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        est_cost_usd=cost,
        duration_ms=duration_ms,
        status=status,
        detail=detail,
    )


# ---- endpoints --------------------------------------------------------------


@router.post("/outreach/draft", response_model=DraftResponse)
def outreach_draft(body: DraftRequest) -> DraftResponse:
    person = _get_person(body.tg_id)
    name = _require_named(person)
    job = _get_job(body.job_id)

    store = get_store()
    run_id = f"draft-{uuid.uuid4().hex[:8]}"
    detail = f"draft for tg {person.tg_id} re {job.company}"
    started = time.monotonic()

    try:
        result = drafter_agent.run_draft(
            first_name=name.split()[0],
            summary=person.summary,
            closeness=person.closeness,
            title=job.title,
            company=job.company,
        )
    except ModelOutputInvalid as exc:
        # Malformed model output: draft rejected WITH reasons — never patched.
        store.log_activity(
            _activity(
                model=config.GEMINI_MODEL,
                run_id=run_id,
                input_tokens=0,
                output_tokens=0,
                duration_ms=int((time.monotonic() - started) * 1000),
                status="rejected",
                detail=f"{detail}: output failed validation: {len(exc.reasons)} reason(s)",
            )
        )
        raise HTTPException(
            status_code=422, detail={"rejected": True, "reasons": exc.reasons}
        ) from exc
    except ModelCallError as exc:
        store.log_activity(
            _activity(
                model=config.GEMINI_MODEL,
                run_id=run_id,
                input_tokens=0,
                output_tokens=0,
                duration_ms=int((time.monotonic() - started) * 1000),
                status="error",
                detail=f"{detail}: {exc}",
            )
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    activity = _activity(
        model=result.model,
        run_id=run_id,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        duration_ms=int((time.monotonic() - started) * 1000),
        status="ok",
        detail=detail,
    )
    store.log_activity(activity)
    return DraftResponse(
        message=result.message,
        grounded_on=GroundedOn(
            summary=person.summary,
            closeness=person.closeness,
            title=job.title,
            company=job.company,
        ),
        activity=activity,
    )


@router.post("/pipeline", response_model=PipelineItem)
def create_pipeline_item(body: PipelineCreateRequest) -> PipelineItem:
    person = _get_person(body.tg_id)
    contact_name = _require_named(person)
    stage = _validate_stage(body.stage)

    if body.job_id is not None:
        job = _get_job(body.job_id)
        company, job_title, job_url = job.company, job.title, job.url
        job_id = job.id
    else:
        company = person.company_definite or person.company_inferred or "?"
        job_id = job_title = job_url = None

    now = _now_iso()
    item = PipelineItem(
        id=uuid.uuid4().hex,
        tg_id=person.tg_id,
        contact_name=contact_name,
        company=company,
        job_id=job_id,
        job_title=job_title,
        job_url=job_url,
        stage=stage,
        follow_up_date=body.follow_up_date,
        note=body.note,
        draft_message=body.draft_message,
        created_at=now,
        updated_at=now,
    )
    get_pipeline_store().create(item)
    return item


@router.get("/pipeline", response_model=list[PipelineItem])
def get_pipeline() -> list[PipelineItem]:
    return get_pipeline_store().get_all()


@router.patch("/pipeline/{item_id}", response_model=PipelineItem)
def patch_pipeline_item(item_id: str, body: PipelinePatchRequest) -> PipelineItem:
    supplied = body.model_dump(exclude_unset=True)
    # stage/note are non-nullable on PipelineItem — an explicit null is a no-op
    fields = {
        k: v for k, v in supplied.items() if not (v is None and k in ("stage", "note"))
    }
    if "stage" in fields:
        _validate_stage(fields["stage"])
    fields["updated_at"] = _now_iso()
    try:
        return get_pipeline_store().update(item_id, fields)
    except KeyError as exc:
        raise HTTPException(
            status_code=404, detail=f"pipeline item '{item_id}' not found"
        ) from exc
