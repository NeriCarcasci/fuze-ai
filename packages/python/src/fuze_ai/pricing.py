from __future__ import annotations

from typing import Any, Optional


def _attr(obj: Any, *keys: str) -> Any:
    cur = obj
    for key in keys:
        if cur is None:
            return None
        if isinstance(cur, dict):
            cur = cur.get(key)
        else:
            cur = getattr(cur, key, None)
    return cur


def extract_usage_from_result(result: Any) -> Optional[dict[str, Any]]:
    if result is None:
        return None

    prompt_tokens = _attr(result, "usage", "prompt_tokens")
    if isinstance(prompt_tokens, int):
        return {
            "tokens_in": prompt_tokens,
            "tokens_out": _attr(result, "usage", "completion_tokens") or 0,
            "model": _attr(result, "model"),
        }

    input_tokens = _attr(result, "usage", "input_tokens")
    if isinstance(input_tokens, int):
        return {
            "tokens_in": input_tokens,
            "tokens_out": _attr(result, "usage", "output_tokens") or 0,
            "model": _attr(result, "model"),
        }

    prompt_token_count = _attr(result, "usageMetadata", "promptTokenCount")
    if prompt_token_count is None:
        prompt_token_count = _attr(result, "usage_metadata", "prompt_token_count")
    if isinstance(prompt_token_count, int):
        candidates = (
            _attr(result, "usageMetadata", "candidatesTokenCount")
            or _attr(result, "usage_metadata", "candidates_token_count")
            or 0
        )
        return {
            "tokens_in": prompt_token_count,
            "tokens_out": candidates,
            "model": _attr(result, "modelVersion") or _attr(result, "model_version"),
        }

    prompt_tokens_v = _attr(result, "usage", "promptTokens")
    if isinstance(prompt_tokens_v, int):
        return {
            "tokens_in": prompt_tokens_v,
            "tokens_out": _attr(result, "usage", "completionTokens") or 0,
        }

    lc_in = _attr(result, "usage_metadata", "input_tokens")
    if isinstance(lc_in, int):
        return {
            "tokens_in": lc_in,
            "tokens_out": _attr(result, "usage_metadata", "output_tokens") or 0,
            "model": _attr(result, "response_metadata", "model_name"),
        }

    lc_pt = _attr(result, "llm_output", "token_usage", "prompt_tokens")
    if isinstance(lc_pt, int):
        return {
            "tokens_in": lc_pt,
            "tokens_out": _attr(result, "llm_output", "token_usage", "completion_tokens") or 0,
            "model": _attr(result, "llm_output", "model_name"),
        }

    input_tokens_b = _attr(result, "usage", "inputTokens")
    if isinstance(input_tokens_b, int):
        return {
            "tokens_in": input_tokens_b,
            "tokens_out": _attr(result, "usage", "outputTokens") or 0,
            "model": _attr(result, "modelId"),
        }

    cohere_in = _attr(result, "meta", "tokens", "input_tokens")
    if isinstance(cohere_in, int):
        return {
            "tokens_in": cohere_in,
            "tokens_out": _attr(result, "meta", "tokens", "output_tokens") or 0,
        }

    return None
