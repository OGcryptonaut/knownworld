"""Refine agent — Google ADK LlmAgent with schema-enforced JSON output.

The ONLY place in the service that talks to a model. Contract:

    run_refine_model(batch_text) -> (RefineModelOutput, UsageStats)

- FAKE_LLM=1 returns a deterministic canned output (tests / local dev,
  no GCP). The canned JSON deliberately "sneaks" a closeness field so the
  test suite can prove the pipeline drops it — closeness only ever comes
  from the request payload, in code.
- Structured output: output_schema=RefineModelOutput on the LlmAgent, so
  the response is schema-enforced JSON. Output that still fails pydantic
  validation raises ModelOutputInvalid (whole batch rejected upstream,
  with reasons). Transport/model failures raise ModelCallError (HTTP 502
  upstream).
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, field

from .. import config
from ..schemas import RefineChatPayload, RefineModelOutput

REFINE_INSTRUCTION = """\
You are cleaning a Telegram contact export for its owner.

From the chats in the user message, return ONLY the people the owner has a
real relationship with who work in or around crypto/web3. Judge by
conversation depth, not politeness — a real back-and-forth over time, not a
one-off "gm".

For each qualifying person:
- tg_id and name: copy exactly from the chat block.
- company_definite: ONLY if the company is stated in the chats themselves.
  Otherwise null. Never put an inference here.
- company_inferred: your best inference of their company from context.
  NEVER copy this into company_definite.
- role_guess: your best guess at their role, or null.
- work_relevant: false for purely personal relationships, true otherwise.
- summary: max 2 lines — the relationship + what they do.
- why_relevant: one line of evidence from the chats.

Return every qualifying person. If none qualify, return an empty people
list. Output must match the required JSON schema exactly.
"""


@dataclass
class UsageStats:
    input_tokens: int = 0
    output_tokens: int = 0
    model: str = field(default_factory=lambda: config.GEMINI_MODEL)


class ModelCallError(Exception):
    """The model/API call itself failed (transport, auth, empty response)."""


class ModelOutputInvalid(Exception):
    """The model returned output that fails schema validation."""

    def __init__(self, reasons: list[str]) -> None:
        super().__init__("; ".join(reasons))
        self.reasons = reasons


# ---- batch text -------------------------------------------------------------

_CHAT_HEADER = re.compile(r"^#chat tg_id=(-?\d+) name=(.*)$", re.MULTILINE)


def build_batch_text(chats: list[RefineChatPayload]) -> str:
    """Compact per-chat blocks: header line, then me:/them: excerpt lines
    with dates. This text is transient — sent to the model and discarded."""
    blocks: list[str] = []
    for chat in chats:
        lines = [f"#chat tg_id={chat.tg_id} name={chat.name}"]
        lines.append(
            f"(my msgs: {chat.my_msg_count}, their msgs: {chat.their_msg_count},"
            f" last: {chat.last_message_iso or 'unknown'})"
        )
        for msg in chat.messages:
            who = "me" if msg.from_me else "them"
            lines.append(f"{who} [{msg.date}]: {msg.text}")
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


# ---- validation -------------------------------------------------------------

def parse_model_output(text: str) -> RefineModelOutput:
    """Validate raw model text against the schema. Never silently patched:
    invalid output raises ModelOutputInvalid with per-error reasons."""
    from pydantic import ValidationError

    try:
        return RefineModelOutput.model_validate_json(text)
    except ValidationError as exc:
        reasons = [
            f"{'.'.join(str(loc) for loc in err['loc']) or '(root)'}: {err['msg']}"
            for err in exc.errors()
        ]
        raise ModelOutputInvalid(reasons) from exc
    except ValueError as exc:  # not JSON at all
        raise ModelOutputInvalid([f"model output is not valid JSON: {exc}"]) from exc


# ---- fake path --------------------------------------------------------------

FAKE_INPUT_TOKENS = 1234
FAKE_OUTPUT_TOKENS = 56


# Rotation for canned rows so multi-chat batches produce a believable demo
# database (varied companies for the graph/map/jobs views). Index 0 stays
# 'FakeCorp'/definite for test stability.
_FAKE_COMPANIES: list[tuple[str | None, str | None, str]] = [
    ("FakeCorp", None, "Founder"),
    ("Synthetic Systems", None, "BD lead"),
    (None, "Placeholder Payments", "Partnerships manager"),  # inferred-only row
    ("Mock Metals", None, "Growth lead"),
    (None, None, "Independent trader"),  # non-resolving row
    ("Demo DeFi", None, "Ecosystem lead"),
]


def fake_model_text(batch_text: str) -> tuple[str, UsageStats]:
    """Deterministic canned output echoing EVERY chat's tg_id/name in the
    batch (so local demos distill a full database), companies rotating
    through _FAKE_COMPANIES by position.

    The first row sneaks a "closeness" field on purpose: the pipeline must
    drop it and take closeness from the request payload only (proved in
    tests).
    """
    people = []
    for index, match in enumerate(_CHAT_HEADER.finditer(batch_text)):
        definite, inferred, role = _FAKE_COMPANIES[index % len(_FAKE_COMPANIES)]
        shown = definite or inferred or "no company on record"
        person = {
            "tg_id": int(match.group(1)),
            "name": match.group(2),
            "company_definite": definite,
            "company_inferred": inferred,
            "role_guess": role,
            "summary": f"Long-running direct chat; canned FAKE_LLM row.\n{role} — {shown}.",
            "work_relevant": index % 5 != 4,
            "why_relevant": "FAKE_LLM mode: canned evidence line.",
        }
        if index == 0:
            person["closeness"] = 99  # sneak attempt — must NOT survive the merge
        people.append(person)
    if not people:
        people = [
            {
                "tg_id": 0,
                "name": "Unknown",
                "company_definite": "FakeCorp",
                "company_inferred": None,
                "role_guess": "Founder",
                "summary": "Long-running direct chat; canned FAKE_LLM row.\nRuns FakeCorp.",
                "work_relevant": True,
                "why_relevant": "FAKE_LLM mode: canned evidence line.",
                "closeness": 99,
            }
        ]
    payload = {"people": people}
    return json.dumps(payload), UsageStats(
        input_tokens=FAKE_INPUT_TOKENS,
        output_tokens=FAKE_OUTPUT_TOKENS,
        model=f"fake:{config.GEMINI_MODEL}",
    )


# ---- real path (Google ADK) -------------------------------------------------

def _real_model_text(batch_text: str) -> tuple[str, UsageStats]:
    """One ADK invocation: LlmAgent(output_schema=RefineModelOutput) run via
    InMemoryRunner (async API, driven to completion here); returns final JSON
    text + usage metadata extracted from the response events.

    Called from FastAPI `def` endpoints (threadpool), so asyncio.run is safe:
    the worker thread has no running event loop.
    """
    try:
        import asyncio

        from google.adk.agents import LlmAgent
        from google.adk.runners import InMemoryRunner
        from google.genai import types

        agent = LlmAgent(
            name="refine",
            description="Distills Telegram chats into work-relevant contacts.",
            model=config.GEMINI_MODEL,
            instruction=REFINE_INSTRUCTION,
            output_schema=RefineModelOutput,
        )
        runner = InMemoryRunner(agent, app_name="knownworld")
        message = types.Content(role="user", parts=[types.Part(text=batch_text)])

        usage = UsageStats()

        async def _invoke() -> str | None:
            session = await runner.session_service.create_session(
                app_name="knownworld", user_id="owner", session_id=uuid.uuid4().hex
            )
            final: str | None = None
            async for event in runner.run_async(
                user_id="owner", session_id=session.id, new_message=message
            ):
                meta = getattr(event, "usage_metadata", None)
                if meta is not None:
                    usage.input_tokens = meta.prompt_token_count or usage.input_tokens
                    usage.output_tokens = (
                        meta.candidates_token_count or usage.output_tokens
                    )
                if getattr(event, "model_version", None):
                    usage.model = event.model_version
                content = getattr(event, "content", None)
                if content and content.parts and getattr(event, "author", "") != "user":
                    texts = [
                        part.text for part in content.parts if getattr(part, "text", None)
                    ]
                    if texts:
                        final = "".join(texts)
            return final

        final_text = asyncio.run(_invoke())
    except Exception as exc:  # transport/auth/SDK failure — not a schema issue
        raise ModelCallError(f"refine model call failed: {exc}") from exc

    if not final_text:
        raise ModelCallError("refine model returned no content")
    return final_text, usage


# ---- entry point ------------------------------------------------------------

def run_refine_model(batch_text: str) -> tuple[RefineModelOutput, UsageStats]:
    """Single isolated model invocation for one refine batch."""
    if config.FAKE_LLM:
        raw, usage = fake_model_text(batch_text)
    else:
        raw, usage = _real_model_text(batch_text)
    return parse_model_output(raw), usage
