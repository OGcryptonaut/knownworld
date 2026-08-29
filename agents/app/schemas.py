"""Pydantic models mirroring web/src/lib/types.ts — field-for-field.

The TS file is the single source of truth; do not rename fields here without
changing them there first. ModelPerson deliberately has NO closeness field:
closeness is computed in code at ingest and passed through the request —
the model must never output it.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


# ---- Refine request (browser -> service; transient) -------------------------

class RefineMessage(BaseModel):
    from_me: bool
    date: str
    text: str


class RefineChatPayload(BaseModel):
    tg_id: int
    name: str
    my_msg_count: int
    their_msg_count: int
    last_message_iso: str | None = None
    closeness: float = Field(ge=0, le=100)  # code-computed; passthrough only
    messages: list[RefineMessage]


class RefineBatchRequest(BaseModel):
    run_id: str
    batch_index: int
    batch_count: int
    chats: list[RefineChatPayload]


# ---- Model output (schema-enforced; NO closeness) ---------------------------

class ModelPerson(BaseModel):
    """One person as the model returns it. NOTE: no closeness field, ever.

    Extra fields (e.g. a model that "helpfully" emits closeness) are DROPPED
    at validation — closeness only ever enters DistilledPerson from the
    request payload in the code merge step. Missing/mistyped required fields
    still reject the whole batch.
    """

    tg_id: int
    name: str
    company_definite: str | None = None  # only if stated in chats
    company_inferred: str | None = None  # best inference — never merged into definite
    role_guess: str | None = None
    summary: str  # <= 2 lines
    work_relevant: bool
    why_relevant: str


class RefineModelOutput(BaseModel):
    people: list[ModelPerson]


# ---- Persisted rows / telemetry (mirror DistilledPerson / ActivityEntry) ----

class DistilledPerson(BaseModel):
    tg_id: int
    name: str
    company_definite: str | None = None
    company_inferred: str | None = None
    role_guess: str | None = None
    summary: str
    work_relevant: bool
    why_relevant: str
    closeness: float  # echoed from request (code-computed)
    msg_volume: int
    last_contact: str | None = None
    run_id: str
    refined_at: str


class ActivityEntry(BaseModel):
    ts: str
    agent: str  # 'refine' | 'enrich' | 'jobscout' | 'drafter' | ...
    model: str  # resolved model id — compliance proof
    run_id: str
    batch_index: int | None = None
    input_tokens: int
    output_tokens: int
    est_cost_usd: float
    duration_ms: int
    status: str  # 'ok' | 'rejected' | 'error'
    detail: str | None = None


class RejectedItem(BaseModel):
    reason: str


class RefineBatchResponse(BaseModel):
    people: list[DistilledPerson]
    rejected: list[RejectedItem]
    activity: ActivityEntry
