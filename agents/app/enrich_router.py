"""Enrich + verify endpoints (D2).

Contract (mirrors web/src/lib/types.ts):
  POST /enrich/person       {tg_id, db_company_override?} -> EnrichmentCard (sync, one person)
  POST /enrich/run          {tg_ids?: [int], top?: int}   -> {run_id, queued}  (via TaskQueue)
  POST /enrich/task         internal Cloud Tasks/local handler, one person per call
  GET  /enrichments?status= -> EnrichmentCard[]
  POST /enrichments/{tg_id}/correct  {name?, company?, role?, location?, linkedin_url?}
                                     -> owner's definitive inline edit

Product rules enforced here, IN CODE:
- The verdict comes from compute_verdict (evidence vs DB) — never the model.
- db_company_override applies ONLY to the in-request comparison and the
  resulting card; the override value itself is NEVER written to the people
  doc. It is the deliberate-mismatch test hook: enrich a person whose
  stored company is X with override Y and the verdict pipeline must flag
  possible_mismatch — and a mismatch never writes company_definite (the
  evidence fields that do auto-apply are the regenerable layer below).
- v2: findings AUTO-APPLY to the person doc (evidence fields + verdict);
  company_definite is written only on a computed 'match' — a mismatch never
  silently rewrites the company, the verdict badge surfaces it and the
  owner's inline Edit (the /correct endpoint) is the definitive resolution.
- resolved_name auto-applies only to blank-named rows.
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
from pydantic import BaseModel, Field

from . import config, tasks
from . import tags as tags_vocab
from .agents import enrich as enrich_agent
from .agents.enrich import EnrichmentCard, compute_verdict
from .agents.refine_agent import ModelCallError, ModelOutputInvalid
from .enrich_store import get_enrich_store
from .schemas import ActivityEntry, DistilledPerson
from .store import get_store

router = APIRouter()

# ---- request models ---------------------------------------------------------


class EnrichPersonRequest(BaseModel):
    tg_id: int
    db_company_override: str | None = None  # comparison-only test hook
    # client-supplied run id (Research again): lets the card watch this
    # pass's activity trail live, and turns on the step-level log entries
    run_id: str | None = Field(default=None, pattern=r"^[a-zA-Z0-9-]{8,64}$")


class EnrichRunRequest(BaseModel):
    tg_ids: list[int] | None = None
    top: int | None = None  # default ENRICH_RUN_DEFAULT_TOP work-relevant by closeness


class EnrichTaskRequest(BaseModel):
    tg_id: int
    run_id: str


class CorrectRequest(BaseModel):
    """Owner's inline correction — every field optional, >=1 required.
    An owner statement is definitive: company writes company_definite
    (never inferred), and the person is marked verified='owner'.
    Every text block the card renders is correctable (atlas-crm contract:
    the whole card is the owner's document, not just the identity line)."""

    name: str | None = None
    company: str | None = None
    role: str | None = None
    location: str | None = None
    linkedin_url: str | None = None
    # Owner's Assessment — free text, machine-untouchable once written
    note: str | None = None
    # narrative blocks, mirrored to the card; list-shaped ones arrive as
    # newline-joined text and are split server-side
    summary: str | None = None
    why_relevant: str | None = None
    current_focus: str | None = None
    how_useful: str | None = None
    history: str | None = None
    footprint: str | None = None


# ---- helpers ----------------------------------------------------------------


def _text_lines(text: str) -> list[str]:
    """Newline-joined textarea -> clean list (blank lines dropped)."""
    return [line.strip() for line in text.splitlines() if line.strip()]


# fields the re-research changelog tracks (atlas-crm updates idea)
_DIFF_FIELDS = (
    "current_employer",
    "current_focus",
    "how_useful",
    "location",
    "linkedin_url",
    "verdict",
    "history",
    "footprint",
    "tags",
)


def _diff_val(v) -> str | None:
    if isinstance(v, list):
        v = "; ".join(v)
    if v is None or v == "":
        return None
    return str(v)[:220]


def _card_diff(old: EnrichmentCard, new: EnrichmentCard) -> list[enrich_agent.ChangedField]:
    out = []
    for field in _DIFF_FIELDS:
        ov = _diff_val(getattr(old, field))
        nv = _diff_val(getattr(new, field))
        if ov != nv:
            out.append(enrich_agent.ChangedField(field=field, old=ov, new=nv))
    return out


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm_linkedin(url: str | None) -> str | None:
    """Canonical LinkedIn URL (atlas-crm _norm_linkedin): share-link noise
    (utm query, fragment, www, trailing slash) must not mint distinct
    identities across enrichment runs."""
    if not url:
        return url
    u = url.strip().split("?")[0].split("#")[0].rstrip("/")
    u = u.replace("http://", "https://")
    if u.startswith("https://www."):
        u = "https://" + u[len("https://www."):]
    return u or None


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
    tg_id: int, run_id: str, db_company_override: str | None = None,
    step_log: bool = False,
) -> EnrichmentCard:
    """Enrich one person: two-step pipeline -> in-code verdict -> pending card
    + telemetry. The search always uses the STORED company; the override (if
    any) substitutes only in the verdict comparison and on the card.
    step_log=True (Research again, client-watched run_id) additionally logs
    the between-steps beat so the live card log has something to show."""
    person = _get_person(tg_id)
    if person is None:
        raise LookupError(f"person tg_id {tg_id} not found")
    stored_company = person.company_definite or person.company_inferred
    compare_company = (
        db_company_override if db_company_override is not None else stored_company
    )
    store = get_store()
    started = time.monotonic()

    on_search_done = None
    if step_log:
        def on_search_done(n_sources: int) -> None:
            store.log_activity(
                _activity(
                    model=config.GEMINI_MODEL,
                    run_id=run_id,
                    input_tokens=0,
                    output_tokens=0,
                    duration_ms=int((time.monotonic() - started) * 1000),
                    status="ok",
                    detail=f"grounded search finished ({n_sources} source(s)); extracting facts",
                )
            )

    # the tenant's grown vocabulary: seed tags + every tag already on a
    # card. Later imports INHERIT it — the prompt lists it reuse-first and
    # the code funnel collapses variants into existing slugs.
    enrich_store = get_enrich_store()
    tenant_slugs = {
        t for c in enrich_store.get_cards() for t in (c.tags or [])
    } | set(tags_vocab.SEED_TAGS)

    try:
        # Vertex rate limits (429 RESOURCE_EXHAUSTED) hit hard when the
        # fan-out lands at once — retry with backoff HERE so the run log
        # shows results, not quota noise; other failures surface immediately
        for attempt in range(3):
            try:
                result = enrich_agent.run_enrich_pipeline(
                    person.name, stored_company, on_search_done=on_search_done,
                    vocabulary_block=tags_vocab.vocabulary_block(tenant_slugs),
                )
                break
            except ModelCallError as exc:
                if "429" in str(exc) and attempt < 2:
                    time.sleep(5 * (attempt + 1))
                    continue
                raise
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
    linkedin = _norm_linkedin(result.extract.linkedin_url)
    # the canonical funnel: model-proposed tags either reuse an existing
    # slug (seed alias table + tenant vocabulary) or become validated new
    # canonical slugs; garbage is dropped and counted
    final_tags, tag_stats = tags_vocab.assign_tags(result.extract.tags, tenant_slugs)
    card = EnrichmentCard(
        tags=final_tags,
        tg_id=person.tg_id,
        name=person.name,
        db_company=compare_company,
        linkedin_url=linkedin,
        location=result.extract.location,
        location_lat=result.extract.location_lat,
        location_lng=result.extract.location_lng,
        current_employer=result.extract.current_employer,
        current_focus=result.extract.current_focus,
        how_useful=result.extract.how_useful,
        history=result.extract.history,
        resolved_name=result.extract.resolved_name,
        footprint=result.extract.footprint,
        citations=result.citations,
        verdict=verdict,
        verdict_reason=verdict_reason,
        status="approved",  # v2: findings auto-apply; the owner EDITS, never approves
        created_at=_now_iso(),
        run_id=run_id,
    )
    prior = enrich_store.get_card(person.tg_id)
    # HUMAN FENCE, card side: the person doc's fence (below) protects what
    # the DB believes, but the UI renders the CARD — a re-research must not
    # visibly revert the owner's corrected identity layer either. Carry the
    # owner-context fields forward from the prior card; the regenerable
    # layer (focus / usefulness / history / footprint / tags) stays fresh.
    if person.verified == "owner" and prior is not None:
        card = card.model_copy(
            update={
                "name": prior.name,
                "current_employer": prior.current_employer,
                "location": prior.location,
                "location_lat": prior.location_lat,
                "location_lng": prior.location_lng,
                "linkedin_url": prior.linkedin_url,
                "verified_by": prior.verified_by,
            }
        )
    # atlas-crm updates: a re-research pass appends a dated changelog entry —
    # exactly what changed (old -> new), with the pass's own citations. An
    # empty diff is stored too: 're-checked, nothing new' is honest signal.
    if prior is not None:
        entry = enrich_agent.CardUpdate(
            at=_now_iso(),
            changed=_card_diff(prior, card),
            citations=card.citations[:5],
        )
        card = card.model_copy(update={"updates": ([entry] + prior.updates)[:10]})
    enrich_store.upsert_card(card)
    # v2 auto-apply, IN CODE: evidence fields merge into the person doc
    # immediately. company_definite only on a computed 'match' (where evidence
    # and DB already agree) — a mismatch NEVER silently rewrites the company;
    # the verdict badge surfaces it and the owner's inline Edit resolves it.
    if person.verified == "owner":
        # HUMAN FENCE (idea from the owner's atlas-crm reference): an
        # owner-verified row is machine-untouchable in its owner layer.
        # Re-research may only refresh the regenerable layer (focus /
        # usefulness / history) and fill fields that are still EMPTY —
        # never overwrite identity, company, links, location, or the
        # 'owner' verification mark.
        fields = {
            "current_focus": card.current_focus,
            "how_useful": card.how_useful,
            "history": card.history,
        }
        if not person.company_definite and verdict == "match" and card.current_employer:
            fields["company_definite"] = card.current_employer
    else:
        fields = {
            "linkedin_url": card.linkedin_url,
            "location": card.location,
            "location_lat": card.location_lat,
            "location_lng": card.location_lng,
            "current_employer": card.current_employer,
            "current_focus": card.current_focus,
            "how_useful": card.how_useful,
            "history": card.history,
            "verified": verdict,
        }
        if verdict == "match" and card.current_employer:
            fields["company_definite"] = card.current_employer
        if not (person.name or "").strip() and card.resolved_name:
            fields["name"] = card.resolved_name
    # blank-never-overwrites (atlas-crm contract): an enrichment that found
    # nothing for a field must not erase what a previous pass DID find.
    # 'verified' is the deliberate exception — the verdict always updates.
    fields = {
        k: v
        for k, v in fields.items()
        if k == "verified" or (v is not None and v != "" and v != [])
    }
    enrich_store.merge_person_fields(person.tg_id, fields)
    store.log_activity(
        _activity(
            model=result.model,
            run_id=run_id,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            duration_ms=int((time.monotonic() - started) * 1000),
            status="ok",
            detail=(
                f"verdict={verdict}; citations={len(result.citations)}; "
                f"tags: {tag_stats['reused']} reused, {tag_stats['created']} new"
                + (f", {tag_stats['dropped']} dropped" if tag_stats["dropped"] else "")
            ),
        )
    )
    return card


# ---- endpoints --------------------------------------------------------------


@router.post("/enrich/person", response_model=EnrichmentCard)
def enrich_person(body: EnrichPersonRequest) -> EnrichmentCard:
    try:
        return _enrich_one(
            body.tg_id,
            run_id=body.run_id or f"enrich-{uuid.uuid4().hex[:8]}",
            db_company_override=body.db_company_override,
            step_log=body.run_id is not None,
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


@router.post("/enrichments/{tg_id}/correct")
def correct_enrichment(tg_id: int, body: CorrectRequest) -> dict:
    """SPEC v1.1 item 5: the review card is correctable inline. Works on any
    verdict (mismatch included — the owner's statement IS the explicit
    resolution). Writes the people doc, mirrors the corrections onto the
    card, clears the mismatch/unverified flag (verified='owner'), and logs
    verified_by=owner in the activity trail."""
    enrich_store = get_enrich_store()
    card = enrich_store.get_card(tg_id)
    if card is None:
        raise HTTPException(status_code=404, detail=f"no enrichment card for tg_id {tg_id}")
    person = _get_person(tg_id)
    if person is None:
        raise HTTPException(status_code=404, detail=f"person tg_id {tg_id} not found")

    provided = {
        k: v.strip()
        for k, v in body.model_dump().items()
        if isinstance(v, str) and v.strip()
    }
    if not provided:
        raise HTTPException(status_code=422, detail="no correction fields provided")

    fields: dict = {"verified": "owner"}
    if "name" in provided:
        fields["name"] = provided["name"]
    if "company" in provided:
        fields["company_definite"] = provided["company"]
        fields["current_employer"] = provided["company"]
    if "role" in provided:
        fields["role_guess"] = provided["role"]
    if "location" in provided:
        fields["location"] = provided["location"]
        # offline gazetteer: an owner's city edit moves the map pin; unknown
        # cities keep the text with no coords — never a guessed pin
        from .geo import geocode

        coords = geocode(provided["location"])
        if coords is not None:
            fields["location_lat"], fields["location_lng"] = coords
        else:
            # unknown city: clear stale coords — a wrong pin is worse than none
            fields["location_lat"] = None
            fields["location_lng"] = None
    if "linkedin_url" in provided:
        fields["linkedin_url"] = provided["linkedin_url"]
    if "note" in provided:
        fields["owner_note"] = provided["note"]
    if "summary" in provided:
        fields["summary"] = provided["summary"]
    if "why_relevant" in provided:
        fields["why_relevant"] = provided["why_relevant"]
    if "current_focus" in provided:
        fields["current_focus"] = provided["current_focus"]
    if "how_useful" in provided:
        fields["how_useful"] = provided["how_useful"]
    if "history" in provided:
        fields["history"] = _text_lines(provided["history"])
    # footprint lives on the card only — never merged into the person doc
    footprint = _text_lines(provided["footprint"]) if "footprint" in provided else None
    enrich_store.merge_person_fields(tg_id, fields)

    updated_card = card.model_copy(
        update={
            "name": fields.get("name", card.name),
            "current_employer": fields.get("current_employer", card.current_employer),
            "location": fields.get("location", card.location),
            # the map reads the CARD's coordinates — a location edit must
            # move (or honestly clear) the pin, not just the person doc
            "location_lat": (
                fields["location_lat"] if "location" in provided else card.location_lat
            ),
            "location_lng": (
                fields["location_lng"] if "location" in provided else card.location_lng
            ),
            "linkedin_url": fields.get("linkedin_url", card.linkedin_url),
            "current_focus": fields.get("current_focus", card.current_focus),
            "how_useful": fields.get("how_useful", card.how_useful),
            "history": fields.get("history", card.history),
            "footprint": footprint if footprint is not None else card.footprint,
            "status": "approved",
            "verified_by": "owner",
        }
    )
    enrich_store.upsert_card(updated_card)

    get_store().log_activity(
        ActivityEntry(
            ts=_now_iso(),
            agent="owner",
            model="-",
            run_id=card.run_id,
            input_tokens=0,
            output_tokens=0,
            est_cost_usd=0.0,
            duration_ms=0,
            status="ok",
            detail=(
                f"owner corrected tg {tg_id} ({', '.join(sorted(provided))}); "
                "verified_by=owner, mismatch/unverified flag cleared"
            ),
        )
    )
    updated = _get_person(tg_id)
    person_view = (updated or person).model_dump()
    person_view.update(fields)
    return person_view

