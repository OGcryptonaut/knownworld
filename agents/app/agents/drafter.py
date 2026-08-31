"""Outreach Drafter agent (D3) — one warm message per explicit user selection.

Contract:

    run_draft(first_name=..., summary=..., closeness=..., title=..., company=...)
        -> DraftResult

Product rules enforced here / upstream:
- SELECTION-ONLY: called only when the user picked one position + contact.
  No pre-drafting, ever. Nameless contacts are rejected upstream (422).
- The app never sends messages anywhere, on any channel — the draft is
  copy-out only (the user pastes it into Telegram themselves).
- Grounding: the input is built IN CODE from the contact's first name, their
  stored 2-line summary, the code-computed closeness, and the selected
  role title + company. Distilled data only — never message content.
- Structured output: LlmAgent(output_schema=DraftOut), no tools. Output that
  fails validation — bad JSON, empty message, placeholder brackets — raises
  ModelOutputInvalid (rejected upstream with reasons, never silently patched).
- FAKE_LLM=1 returns a deterministic canned message echoing role + company,
  with fixed token counts for test assertions.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from pydantic import BaseModel

from .. import config
from .enrich import _run_adk_agent
from .refine_agent import ModelCallError, ModelOutputInvalid, UsageStats

# ---- structured output schema -----------------------------------------------


class DraftOut(BaseModel):
    message: str


# ---- prompt -----------------------------------------------------------------
# Contact specifics go in the USER message, not the instruction: ADK treats
# {braces} in instructions as session-state templates. No literal braces here.

DRAFT_INSTRUCTION = """\
You draft ONE short warm Telegram message (2-4 sentences) from the owner to
a contact they actually know, asking about a specific open role at the
contact's company. Casual-professional voice — no emoji spam, no fake
enthusiasm.

The user message gives you: the contact's first name, the owner's stored
2-line summary of the relationship, a code-computed closeness score (0-100),
and the open role's title + company.

Rules:
- Mention the role naturally and reference the existing relationship
  implicitly — never recite the summary back at them.
- Tone by closeness: 60 or above — warmer, first-name tone; 30 to 60 —
  friendly but lighter; below 30 — start with a polite re-connect line.
- NEVER invent shared history, meetings, or any fact not in the input.
- End with a soft ask: an intro, a referral, or a quick chat.
- No placeholder brackets of any kind — the message must be ready to send
  exactly as written.
Output must match the required JSON schema exactly: a single field named
message containing the draft.
"""


def build_draft_input(
    first_name: str, summary: str, closeness: float, title: str, company: str
) -> str:
    """The ONLY facts the model sees — distilled data, built in code."""
    return (
        f"Contact first name: {first_name}\n"
        f"Stored relationship summary (2 lines max):\n{summary}\n"
        f"Closeness score (0-100, code-computed): {closeness:g}\n"
        f"Open role: {title}\n"
        f"Company: {company}"
    )


# ---- validation -------------------------------------------------------------

_PLACEHOLDER = re.compile(r"\[[^\]]{0,60}\]")


def parse_draft(text: str) -> DraftOut:
    """Validate raw model text against DraftOut. Never silently patched:
    invalid JSON, a blank message, or placeholder brackets ([Name], [role])
    raise ModelOutputInvalid with per-error reasons."""
    from pydantic import ValidationError

    try:
        out = DraftOut.model_validate_json(text)
    except ValidationError as exc:
        reasons = [
            f"{'.'.join(str(loc) for loc in err['loc']) or '(root)'}: {err['msg']}"
            for err in exc.errors()
        ]
        raise ModelOutputInvalid(reasons) from exc
    except ValueError as exc:  # not JSON at all
        raise ModelOutputInvalid([f"model output is not valid JSON: {exc}"]) from exc
    if not out.message.strip():
        raise ModelOutputInvalid(["message: draft is empty"])
    if _PLACEHOLDER.search(out.message):
        raise ModelOutputInvalid(
            ["message: draft contains placeholder brackets — must be ready to send as-is"]
        )
    return out


# ---- fake path --------------------------------------------------------------

FAKE_DRAFT_INPUT_TOKENS = 420
FAKE_DRAFT_OUTPUT_TOKENS = 70


def fake_draft_text(
    first_name: str, summary: str, closeness: float, title: str, company: str
) -> tuple[str, UsageStats]:
    """Deterministic canned draft echoing role + company, fixed tokens.
    Openers follow the closeness tiers so tone routing is testable."""
    if closeness >= 60:
        opener = f"Hey {first_name}!"
    elif closeness >= 30:
        opener = f"Hey {first_name},"
    else:
        opener = f"Hi {first_name}, it's been a while — hope all is well on your side."
    message = (
        f"{opener} I saw {company} has an opening for {title} and it looks like a "
        "genuinely good fit for what I'm focused on right now. "
        "Would you be up for a quick chat about it, or could you point me to the "
        "right person there? No pressure either way."
    )
    return json.dumps({"message": message}), UsageStats(
        input_tokens=FAKE_DRAFT_INPUT_TOKENS,
        output_tokens=FAKE_DRAFT_OUTPUT_TOKENS,
        model=f"fake:{config.GEMINI_MODEL}",
    )


# ---- real path (Google ADK) -------------------------------------------------


def _real_draft(user_text: str) -> tuple[str, UsageStats]:
    """One ADK invocation: LlmAgent(output_schema=DraftOut), NO tools."""
    try:
        from google.adk.agents import LlmAgent

        agent = LlmAgent(
            name="drafter",
            description="Drafts one warm outreach message for a selected contact + role.",
            model=config.GEMINI_MODEL,
            instruction=DRAFT_INSTRUCTION,
            output_schema=DraftOut,
        )
        text, _grounding, usage = _run_adk_agent(agent, user_text)
    except Exception as exc:  # transport/auth/SDK failure — not a schema issue
        raise ModelCallError(f"draft model call failed: {exc}") from exc
    if not text:
        raise ModelCallError("draft model returned no content")
    return text, usage


# ---- intro variant (chat-requested, no job attached) ------------------------

INTRO_INSTRUCTION = """\
You draft ONE short warm Telegram message (2-4 sentences) from the owner to
a contact they actually know. The user message gives you: the contact's
first name, the owner's stored 2-line relationship summary, a code-computed
closeness score (0-100), and WHAT THE OWNER WANTS in their own words (an
intro to someone, advice, a catch-up, anything).

Rules:
- Reference the existing relationship implicitly — never recite the summary.
- Tone by closeness: 60 or above — warmer, first-name tone; 30 to 60 —
  friendly but lighter; below 30 — start with a polite re-connect line.
- NEVER invent shared history, meetings, or any fact not in the input.
- End with ONE soft, specific ask that matches what the owner wants.
- No placeholder brackets of any kind — ready to send exactly as written.
Output must match the required JSON schema exactly: a single field named
message containing the draft.
"""


def build_intro_input(first_name: str, summary: str, closeness: float, ask: str) -> str:
    return (
        f"Contact first name: {first_name}\n"
        f"Stored relationship summary (2 lines max):\n{summary}\n"
        f"Closeness score (0-100, code-computed): {closeness:g}\n"
        f"What the owner wants (their words): {ask}"
    )


def fake_intro_text(
    first_name: str, summary: str, closeness: float, ask: str
) -> tuple[str, UsageStats]:
    if closeness >= 60:
        opener = f"Hey {first_name}!"
    elif closeness >= 30:
        opener = f"Hey {first_name},"
    else:
        opener = f"Hi {first_name}, it's been a while — hope all is well on your side."
    short_ask = ask.strip().rstrip("?.") or "something I'm working on"
    message = (
        f"{opener} Quick one from my side: {short_ask}. "
        "You were the first person I thought of — would you be up for a quick chat, "
        "or could you point me to the right person? No pressure either way."
    )
    return json.dumps({"message": message}), UsageStats(
        input_tokens=FAKE_DRAFT_INPUT_TOKENS,
        output_tokens=FAKE_DRAFT_OUTPUT_TOKENS,
        model=f"fake:{config.GEMINI_MODEL}",
    )


def _real_intro(user_text: str) -> tuple[str, UsageStats]:
    try:
        from google.adk.agents import LlmAgent

        agent = LlmAgent(
            name="intro_drafter",
            description="Drafts one warm message for a chat-requested intro/ask.",
            model=config.GEMINI_MODEL,
            instruction=INTRO_INSTRUCTION,
            output_schema=DraftOut,
        )
        text, _grounding, usage = _run_adk_agent(agent, user_text)
    except Exception as exc:
        raise ModelCallError(f"intro model call failed: {exc}") from exc
    if not text:
        raise ModelCallError("intro model returned no content")
    return text, usage


def run_intro(
    *, first_name: str, summary: str, closeness: float, ask: str
) -> "DraftResult":
    """One message for a chat-requested ask (no job attached). Same contract
    as run_draft: ModelCallError / ModelOutputInvalid, never silently patched."""
    if config.FAKE_LLM:
        raw, usage = fake_intro_text(first_name, summary, closeness, ask)
    elif config.MODEL_BACKEND == "claude":  # dev-only; deploys run Gemini
        from . import claude_backend

        raw, usage = claude_backend.generate_json(
            INTRO_INSTRUCTION,
            build_intro_input(first_name, summary, closeness, ask),
            DraftOut,
            max_tokens=1000,
        )
    else:
        raw, usage = _real_intro(build_intro_input(first_name, summary, closeness, ask))
    out = parse_draft(raw)
    return DraftResult(
        message=out.message,
        model=usage.model,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
    )


# ---- entry point ------------------------------------------------------------


@dataclass
class DraftResult:
    message: str
    model: str = field(default_factory=lambda: config.GEMINI_MODEL)
    input_tokens: int = 0
    output_tokens: int = 0


def run_draft(
    *, first_name: str, summary: str, closeness: float, title: str, company: str
) -> DraftResult:
    """Single isolated model invocation for one selected contact + role.
    Raises ModelCallError on transport failure, ModelOutputInvalid when the
    output fails validation (rejected upstream with reasons)."""
    if config.FAKE_LLM:
        raw, usage = fake_draft_text(first_name, summary, closeness, title, company)
    elif config.MODEL_BACKEND == "claude":  # dev-only; deploys run Gemini
        from . import claude_backend

        raw, usage = claude_backend.generate_json(
            DRAFT_INSTRUCTION,
            build_draft_input(first_name, summary, closeness, title, company),
            DraftOut,
            max_tokens=1000,
        )
    else:
        raw, usage = _real_draft(
            build_draft_input(first_name, summary, closeness, title, company)
        )
    out = parse_draft(raw)
    return DraftResult(
        message=out.message,
        model=usage.model,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
    )
