"""DEV-ONLY model backend: Claude via the Anthropic SDK (subscription auth).

⚠️  HACKATHON MANDATE: submission deploys MUST run Gemini via ADK/Vertex —
    this backend exists ONLY for fast local testing (MODEL_BACKEND=claude,
    default model claude-haiku-4-5). deploy.sh refuses to ship it, and the
    default MODEL_BACKEND is 'gemini' everywhere. Switch nothing at deploy
    time — just don't set MODEL_BACKEND.

Auth: the zero-arg Anthropic() client resolves ANTHROPIC_API_KEY, then
ANTHROPIC_AUTH_TOKEN, then the `ant auth login` OAuth profile on disk —
run `ant auth login` once and the service just works; no key in the repo.

Discipline is identical to the Gemini path: schema-enforced JSON on every
call (messages.parse + the same pydantic validators upstream — malformed
output rejects with reasons), per-call token usage captured for telemetry.
Grounded search uses the server-side web_search tool; citations come from
the returned search-result blocks, never invented.
"""

from __future__ import annotations

from .. import config
from .refine_agent import ModelCallError, UsageStats

# Basic variant — claude-haiku-4-5 predates the dynamic-filtering tool types.
_WEB_SEARCH_TOOL = {"type": "web_search_20250305", "name": "web_search", "max_uses": 4}
_MAX_PAUSE_CONTINUATIONS = 3

_client_cache = None


def _client():
    global _client_cache
    if _client_cache is None:
        try:
            import anthropic
        except ImportError as exc:  # pragma: no cover
            raise ModelCallError(
                "anthropic SDK not installed; pip install anthropic"
            ) from exc
        _client_cache = anthropic.Anthropic(timeout=120.0, max_retries=2)
    return _client_cache


def _usage_from(response) -> UsageStats:
    return UsageStats(
        input_tokens=getattr(response.usage, "input_tokens", 0) or 0,
        output_tokens=getattr(response.usage, "output_tokens", 0) or 0,
        model=getattr(response, "model", config.CLAUDE_MODEL),
    )


def generate_json(
    instruction: str, user_text: str, schema_model, max_tokens: int = 8000
) -> tuple[str, UsageStats]:
    """One schema-enforced call: returns (raw JSON text, usage). The raw text
    re-enters the shared pydantic validators upstream, same as Gemini output."""
    try:
        response = _client().messages.parse(
            model=config.CLAUDE_MODEL,
            max_tokens=max_tokens,
            system=instruction,
            messages=[{"role": "user", "content": user_text}],
            output_format=schema_model,
        )
    except Exception as exc:
        raise ModelCallError(f"claude call failed: {exc}") from exc
    if response.parsed_output is None:
        raise ModelCallError("claude returned no parsable content")
    return response.parsed_output.model_dump_json(), _usage_from(response)


def search_person(instruction: str, user_text: str) -> tuple[str, list, UsageStats]:
    """Grounded research step: server-side web_search tool, pause_turn-safe.
    Returns (notes text, citations as EnrichmentEvidence, summed usage)."""
    from .enrich import EnrichmentEvidence

    usage = UsageStats(input_tokens=0, output_tokens=0, model=config.CLAUDE_MODEL)
    messages: list[dict] = [{"role": "user", "content": user_text}]
    citations: list[EnrichmentEvidence] = []
    seen_urls: set[str] = set()
    text_parts: list[str] = []

    try:
        for _ in range(_MAX_PAUSE_CONTINUATIONS + 1):
            response = _client().messages.create(
                model=config.CLAUDE_MODEL,
                max_tokens=4000,
                system=instruction,
                tools=[_WEB_SEARCH_TOOL],
                messages=messages,
            )
            usage.input_tokens += getattr(response.usage, "input_tokens", 0) or 0
            usage.output_tokens += getattr(response.usage, "output_tokens", 0) or 0
            usage.model = getattr(response, "model", usage.model)

            for block in response.content:
                block_type = getattr(block, "type", "")
                if block_type == "text":
                    text_parts.append(block.text)
                    for cite in getattr(block, "citations", None) or []:
                        url = getattr(cite, "url", None)
                        if url and url not in seen_urls:
                            seen_urls.add(url)
                            citations.append(
                                EnrichmentEvidence(
                                    title=getattr(cite, "title", None) or url,
                                    url=url,
                                    snippet=getattr(cite, "cited_text", None),
                                )
                            )
                elif block_type == "web_search_tool_result":
                    content = getattr(block, "content", None)
                    if not isinstance(content, list):
                        continue  # error object, not results — skip honestly
                    for item in content:
                        url = getattr(item, "url", None)
                        if url and url not in seen_urls:
                            seen_urls.add(url)
                            citations.append(
                                EnrichmentEvidence(
                                    title=getattr(item, "title", None) or url,
                                    url=url,
                                )
                            )

            if response.stop_reason != "pause_turn":
                break
            # paused mid-turn: append the partial assistant turn and resume
            messages.append({"role": "assistant", "content": response.content})
        else:
            raise ModelCallError("web search turn still paused after retries")
    except ModelCallError:
        raise
    except Exception as exc:
        raise ModelCallError(f"claude search call failed: {exc}") from exc

    final_text = "\n".join(part for part in text_parts if part).strip()
    if not final_text:
        raise ModelCallError("claude search returned no content")
    return final_text, citations, usage
