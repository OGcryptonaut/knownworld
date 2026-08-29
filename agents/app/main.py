"""FastAPI service wrapping the ADK agents.

Endpoints (contracts mirror web/src/lib/types.ts):
  GET    /healthz         — status, resolved model, vertex/fake flags
  POST   /refine/batch    — RefineBatchRequest -> RefineBatchResponse
  GET    /people          — DistilledPerson[]
  GET    /activity        — ActivityEntry[] (optional ?run_id=)
  DELETE /data            — wipe people + activity

Refine batches are TRANSIENT: message content exists only inside the request
scope and the model call. Only distilled rows + telemetry are persisted.
Closeness / msg_volume / last_contact merge IN CODE from the request payload
by tg_id — never from anything the model returned.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .agents import refine_agent
from .agents.refine_agent import ModelCallError, ModelOutputInvalid, build_batch_text
from .schemas import (
    ActivityEntry,
    DistilledPerson,
    RefineBatchRequest,
    RefineBatchResponse,
    RejectedItem,
)
from .store import get_store
from . import enrich_router, jobs_router, outreach_router

app = FastAPI(title="Knownworld agents", version="0.1.0")
app.include_router(enrich_router.router)
app.include_router(jobs_router.router)
app.include_router(outreach_router.router)

@app.middleware("http")
async def enforce_bearer(request, call_next):
    """App-level auth for the public Cloud Run URL. Active only when
    AGENTS_API_TOKEN is set (production); local dev stays open."""
    token = config.AGENTS_API_TOKEN
    if token and request.url.path != "/healthz" and request.method != "OPTIONS":
        supplied = request.headers.get("authorization", "")
        if supplied != f"Bearer {token}":
            from fastapi.responses import JSONResponse
            return JSONResponse({"detail": "unauthorized"}, status_code=401)
    return await call_next(request)


_origins = list(
    dict.fromkeys(
        [config.FRONTEND_ORIGIN, "http://localhost:3040", "http://localhost:3000"]
    )
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _activity(
    *,
    model: str,
    run_id: str,
    batch_index: int,
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
        agent="refine",
        model=model,
        run_id=run_id,
        batch_index=batch_index,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        est_cost_usd=cost,
        duration_ms=duration_ms,
        status=status,
        detail=detail,
    )


@app.get("/healthz")
def healthz() -> dict:
    return {
        "status": "ok",
        "model": config.GEMINI_MODEL,
        "vertex": config.GOOGLE_GENAI_USE_VERTEXAI,
        "fake": config.FAKE_LLM,
    }


@app.post("/refine/batch", response_model=RefineBatchResponse)
def refine_batch(request: RefineBatchRequest) -> RefineBatchResponse:
    store = get_store()
    started = time.monotonic()
    batch_text = build_batch_text(request.chats)

    try:
        output, usage = refine_agent.run_refine_model(batch_text)
    except ModelOutputInvalid as exc:
        # Malformed model output: whole batch rejected WITH reasons —
        # never silently patched.
        duration_ms = int((time.monotonic() - started) * 1000)
        activity = _activity(
            model=config.GEMINI_MODEL,
            run_id=request.run_id,
            batch_index=request.batch_index,
            input_tokens=0,
            output_tokens=0,
            duration_ms=duration_ms,
            status="rejected",
            detail=f"model output failed schema validation: {len(exc.reasons)} reason(s)",
        )
        store.log_activity(activity)
        return RefineBatchResponse(
            people=[],
            rejected=[RejectedItem(reason=r) for r in exc.reasons],
            activity=activity,
        )
    except ModelCallError as exc:
        duration_ms = int((time.monotonic() - started) * 1000)
        activity = _activity(
            model=config.GEMINI_MODEL,
            run_id=request.run_id,
            batch_index=request.batch_index,
            input_tokens=0,
            output_tokens=0,
            duration_ms=duration_ms,
            status="error",
            detail=str(exc),
        )
        store.log_activity(activity)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    # ---- merge step, IN CODE ------------------------------------------------
    # closeness / msg_volume / last_contact come ONLY from the request payload
    # by tg_id; nothing the model emitted can influence them.
    chats_by_id = {chat.tg_id: chat for chat in request.chats}
    refined_at = _now_iso()
    people: list[DistilledPerson] = []
    rejected: list[RejectedItem] = []

    for person in output.people:
        chat = chats_by_id.get(person.tg_id)
        if chat is None:
            rejected.append(RejectedItem(reason=f"tg_id {person.tg_id} not in batch"))
            continue

        summary = person.summary
        lines = [line for line in summary.splitlines() if line.strip()]
        if len(lines) > 2:
            summary = "\n".join(lines[:2])
            rejected.append(
                RejectedItem(
                    reason=f"summary for tg_id {person.tg_id} trimmed to 2 lines"
                )
            )

        people.append(
            DistilledPerson(
                tg_id=person.tg_id,
                name=person.name,
                company_definite=person.company_definite,
                company_inferred=person.company_inferred,
                role_guess=person.role_guess,
                summary=summary,
                work_relevant=person.work_relevant,
                why_relevant=person.why_relevant,
                closeness=chat.closeness,
                msg_volume=chat.my_msg_count + chat.their_msg_count,
                last_contact=chat.last_message_iso,
                run_id=request.run_id,
                refined_at=refined_at,
            )
        )

    duration_ms = int((time.monotonic() - started) * 1000)
    activity = _activity(
        model=usage.model,
        run_id=request.run_id,
        batch_index=request.batch_index,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        duration_ms=duration_ms,
        status="ok",
        detail=(
            f"batch {request.batch_index + 1}/{request.batch_count}: "
            f"{len(people)} people, {len(rejected)} note(s)"
        ),
    )
    store.upsert_people(people)
    store.log_activity(activity)
    return RefineBatchResponse(people=people, rejected=rejected, activity=activity)


@app.get("/people", response_model=list[DistilledPerson])
def get_people() -> list[DistilledPerson]:
    return get_store().get_people()


@app.get("/activity", response_model=list[ActivityEntry])
def get_activity(run_id: str | None = None) -> list[ActivityEntry]:
    return get_store().get_activity(run_id)


@app.delete("/data")
def delete_data() -> dict:
    get_store().delete_all()
    return {"deleted": True}
