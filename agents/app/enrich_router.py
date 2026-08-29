"""Enrich + verify endpoints (D2).

Contract (mirrors web/src/lib/types.ts):
  POST /enrich/person       {tg_id, db_company_override?} -> EnrichmentCard (sync, one person)
  POST /enrich/run          {tg_ids?: [int], top?: int}   -> {run_id, queued}  (via TaskQueue)
  POST /enrich/task         internal Cloud Tasks/local handler, one person per call
  GET  /enrichments?status= -> EnrichmentCard[]
  POST /enrichments/{tg_id}/approve  {set_company_definite?: bool, corrections?} -> updated person
  POST /enrichments/{tg_id}/reject   -> card rejected, person marked unverified

Product rules enforced here, IN CODE:
- The verdict comes from compute_verdict (evidence vs DB) — never the model.
- db_company_override applies ONLY to the in-request comparison and the
  resulting card; it is NEVER written to the people doc. It is the
  deliberate-mismatch test hook: enrich a person whose stored company is X
  with override Y and the verdict pipeline must flag possible_mismatch
  while the people doc stays untouched.
- User approval writes the DB. company_definite is set from the evidence
  ONLY when body.set_company_definite is true, and approving a
  possible_mismatch card REQUIRES that flag explicitly — mismatches are
  never auto-merged (409 otherwise).
- resolved_name is applied to the person ONLY when their stored name was
  blank AND body.apply_resolved_name is true.
- Reject marks the person verified:'unverified' — never a guess.
- Malformed step-B output rejects the whole enrichment with reasons
  (activity status 'rejected'; 422 on the sync endpoint).
- Per-call telemetry: agent 'enrich', resolved model, both steps' tokens
  summed, est cost, duration, verdict + citation count in detail.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import config, tasks
from .agents import enrich as enrich_agent
from .agents.enrich import EnrichmentCard, compute_verdict
from .agents.refine_agent import ModelCallError, ModelOutputInvalid
from .enrich_store import get_enrich_store
from .schemas import ActivityEntry, DistilledPerson
from .store import get_store

router = APIRouter()

# corrections keys a user may override on approve (evidence-field edits only)
_CORRECTION_KEYS = {"linkedin_url", "location", "current_employer"}


# ---- request models ---------------------------------------------------------


class EnrichPersonRequest(BaseModel):
    tg_id: int
    db_company_override: str | None = None  # comparison-only test hook


class EnrichRunRequest(BaseModel):
    tg_ids: list[int] | None = None
    top: int | None = None  # default ENRICH_RUN_DEFAULT_TOP work-relevant by closeness


class EnrichTaskRequest(BaseModel):
    tg_id: int
    run_id: str


class ApproveRequest(BaseModel):
    set_company_definite: bool = False
    apply_resolved_name: bool = False
    corrections: dict[str, str | None] | None = None


# ---- helpers ----------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_person(tg_id: int) -> DistilledPerson | None:
    return next((p for p in get_store().get_people() if p.tg_id == tg_id), None)


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
        agent="enrich",
        model=model,
        run_id=run_id,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        est_cost_usd=cost,
        duration_ms=duration_ms,
        status=status,
        detail=detail,
    )


def _enrich_one(
    tg_id: int, run_id: str, db_company_override: str | None = None
) -> EnrichmentCard:
    """Enrich one person: two-step pipeline -> in-code verdict -> pending card
    + telemetry. The search always uses the STORED company; the override (if
    any) substitutes only in the verdict comparison and on the card."""
    person = _get_person(tg_id)
    if person is None:
        raise LookupError(f"person tg_id {tg_id} not found")
    stored_company = person.company_definite or person.company_inferred
    compare_company = (
        db_company_override if db_company_override is not None else stored_company
    )
    store = get_store()
    started = time.monotonic()

    try:
        result = enrich_agent.run_enrich_pipeline(person.name, stored_company)
    except ModelOutputInvalid as exc:
        # Malformed model output: whole enrichment rejected WITH reasons —
        # never silently patched.
        store.log_activity(
            _activity(
                model=config.GEMINI_MODEL,
                run_id=run_id,
                input_tokens=0,
                output_tokens=0,
                duration_ms=int((time.monotonic() - started) * 1000),
                status="rejected",
                detail=f"extract output failed schema validation: {len(exc.reasons)} reason(s)",
            )
        )
        raise
    except ModelCallError as exc:
        store.log_activity(
            _activity(
                model=config.GEMINI_MODEL,
                run_id=run_id,
                input_tokens=0,
                output_tokens=0,
                duration_ms=int((time.monotonic() - started) * 1000),
                status="error",
                detail=str(exc),
            )
        )
        raise

    verdict, verdict_reason = compute_verdict(result.extract, compare_company)
    card = EnrichmentCard(
        tg_id=person.tg_id,
        name=person.name,
        db_company=compare_company,
        linkedin_url=result.extract.linkedin_url,
        location=result.extract.location,
        current_employer=result.extract.current_employer,
        resolved_name=result.extract.resolved_name,
        footprint=result.extract.footprint,
        citations=result.citations,
        verdict=verdict,
        verdict_reason=verdict_reason,
        status="pending",
        created_at=_now_iso(),
        run_id=run_id,
    )
    get_enrich_store().upsert_card(card)
    store.log_activity(
        _activity(
            model=result.model,
            run_id=run_id,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            duration_ms=int((time.monotonic() - started) * 1000),
            status="ok",
            detail=f"verdict={verdict}; citations={len(result.citations)}",
        )
    )
    return card


# ---- endpoints --------------------------------------------------------------


@router.post("/enrich/person", response_model=EnrichmentCard)
def enrich_person(body: EnrichPersonRequest) -> EnrichmentCard:
    try:
        return _enrich_one(
            body.tg_id,
            run_id=f"enrich-{uuid.uuid4().hex[:8]}",
            db_company_override=body.db_company_override,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ModelOutputInvalid as exc:
        raise HTTPException(
            status_code=422,
            detail={"rejected": True, "reasons": exc.reasons},
        ) from exc
    except ModelCallError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/enrich/run")
async def enrich_run(body: EnrichRunRequest) -> dict:
    """Fan out one /enrich/task per target via the TaskQueue. Targets:
    explicit tg_ids (only those that exist), else the top N work-relevant
    people by closeness (default ENRICH_RUN_DEFAULT_TOP)."""
    people = get_store().get_people()
    if body.tg_ids:
        wanted = set(body.tg_ids)
        targets = [p for p in people if p.tg_id in wanted]
    else:
        top = body.top or config.ENRICH_RUN_DEFAULT_TOP
        targets = sorted(
            (p for p in people if p.work_relevant),
            key=lambda p: p.closeness,
            reverse=True,
        )[:top]
    run_id = f"enrich-{uuid.uuid4().hex[:8]}"
    queue = tasks.get_task_queue()
    for person in targets:
        await queue.enqueue("/enrich/task", {"tg_id": person.tg_id, "run_id": run_id})
    return {"run_id": run_id, "queued": len(targets)}


@router.post("/enrich/task")
def enrich_task(body: EnrichTaskRequest) -> dict:
    """Internal handler: one person per call (Cloud Tasks POSTs here in cloud
    mode). Permanent outcomes (missing person, rejected output) return 200 so
    Cloud Tasks does not retry them; transport errors 502 so it does."""
    try:
        card = _enrich_one(body.tg_id, run_id=body.run_id)
    except LookupError as exc:
        return {"status": "skipped", "tg_id": body.tg_id, "detail": str(exc)}
    except ModelOutputInvalid as exc:
        return {"status": "rejected", "tg_id": body.tg_id, "reasons": exc.reasons}
    except ModelCallError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"status": "ok", "tg_id": body.tg_id, "verdict": card.verdict}


async def _local_task_handler(payload: dict) -> None:
    """LocalTaskQueue handler — same logic as /enrich/task, in-process.
    Model failures are already logged to activity by _enrich_one."""
    tg_id = int(payload["tg_id"])
    run_id = str(payload.get("run_id") or f"enrich-{uuid.uuid4().hex[:8]}")
    try:
        await asyncio.to_thread(_enrich_one, tg_id, run_id)
    except LookupError as exc:
        get_store().log_activity(
            _activity(
                model=config.GEMINI_MODEL,
                run_id=run_id,
                input_tokens=0,
                output_tokens=0,
                duration_ms=0,
                status="error",
                detail=str(exc),
            )
        )
    except (ModelOutputInvalid, ModelCallError):
        pass  # activity already logged with reasons in _enrich_one


tasks.register_local_handler("/enrich/task", _local_task_handler)


@router.get("/enrichments", response_model=list[EnrichmentCard])
def get_enrichments(status: str | None = None) -> list[EnrichmentCard]:
    return get_enrich_store().get_cards(status)


@router.post("/enrichments/{tg_id}/approve")
def approve_enrichment(tg_id: int, body: ApproveRequest) -> dict:
    """User approval writes the DB: card -> 'approved', people doc gets
    linkedin_url / location / current_employer / verified (the verdict).
    company_definite is set from the evidence ONLY with set_company_definite;
    approving a possible_mismatch REQUIRES that flag (never auto-merged).
    resolved_name is applied ONLY to a blank-named person with
    apply_resolved_name. Returns the updated person (merged fields view)."""
    enrich_store = get_enrich_store()
    card = enrich_store.get_card(tg_id)
    if card is None:
        raise HTTPException(status_code=404, detail=f"no enrichment card for tg_id {tg_id}")
    person = _get_person(tg_id)
    if person is None:
        raise HTTPException(status_code=404, detail=f"person tg_id {tg_id} not found")
    if card.verdict == "possible_mismatch" and not body.set_company_definite:
        raise HTTPException(
            status_code=409,
            detail=(
                "approving a possible_mismatch card requires set_company_definite: "
                "true — mismatches are never auto-merged"
            ),
        )

    corrections = {
        k: v for k, v in (body.corrections or {}).items() if k in _CORRECTION_KEYS
    }
    fields: dict = {
        "linkedin_url": card.linkedin_url,
        "location": card.location,
        "current_employer": card.current_employer,
        "verified": card.verdict,
        **corrections,
    }
    if body.set_company_definite:
        employer = fields["current_employer"]
        if not employer:
            raise HTTPException(
                status_code=422,
                detail="set_company_definite requested but the card has no current_employer",
            )
        fields["company_definite"] = employer
    if body.apply_resolved_name and not (person.name or "").strip() and card.resolved_name:
        fields["name"] = card.resolved_name

    enrich_store.merge_person_fields(tg_id, fields)
    enrich_store.set_status(tg_id, "approved")
    updated = _get_person(tg_id)
    person_view = (updated or person).model_dump()
    person_view.update(fields)
    return person_view


@router.post("/enrichments/{tg_id}/reject", response_model=EnrichmentCard)
def reject_enrichment(tg_id: int) -> EnrichmentCard:
    """Card -> 'rejected'; the person is marked verified:'unverified' —
    nothing from the evidence is merged."""
    card = get_enrich_store().set_status(tg_id, "rejected")
    if card is None:
        raise HTTPException(status_code=404, detail=f"no enrichment card for tg_id {tg_id}")
    get_enrich_store().merge_person_fields(tg_id, {"verified": "unverified"})
    return card
