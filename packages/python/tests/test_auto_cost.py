from fuze_ai.pricing import extract_usage_from_result


class TestExtractUsageFromResult:
    def test_returns_none_for_none(self):
        assert extract_usage_from_result(None) is None

    def test_returns_none_for_string(self):
        assert extract_usage_from_result("hello") is None

    def test_returns_none_for_list(self):
        assert extract_usage_from_result([1, 2, 3]) is None

    def test_returns_none_for_object_without_usage(self):
        assert extract_usage_from_result({"data": "foo", "id": "bar"}) is None

    def test_openai_shape_dict(self):
        result = extract_usage_from_result({
            "id": "chatcmpl-abc",
            "model": "gpt-4o",
            "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
        })
        assert result == {"tokens_in": 100, "tokens_out": 50, "model": "gpt-4o"}

    def test_openai_shape_object(self):
        class Usage:
            prompt_tokens = 200
            completion_tokens = 80

        class Response:
            model = "gpt-4o-mini"
            usage = Usage()

        result = extract_usage_from_result(Response())
        assert result["tokens_in"] == 200
        assert result["tokens_out"] == 80
        assert result["model"] == "gpt-4o-mini"

    def test_anthropic_shape(self):
        result = extract_usage_from_result({
            "model": "claude-opus-4-6",
            "usage": {"input_tokens": 300, "output_tokens": 120},
        })
        assert result == {"tokens_in": 300, "tokens_out": 120, "model": "claude-opus-4-6"}

    def test_google_gemini_shape_camelcase(self):
        result = extract_usage_from_result({
            "modelVersion": "gemini-1.5-pro",
            "usageMetadata": {"promptTokenCount": 400, "candidatesTokenCount": 180},
        })
        assert result["tokens_in"] == 400
        assert result["tokens_out"] == 180

    def test_google_gemini_shape_snake_case(self):
        result = extract_usage_from_result({
            "usage_metadata": {"prompt_token_count": 50, "candidates_token_count": 25},
        })
        assert result["tokens_in"] == 50
        assert result["tokens_out"] == 25

    def test_vercel_ai_sdk_shape(self):
        result = extract_usage_from_result({
            "text": "Hello world",
            "usage": {"promptTokens": 50, "completionTokens": 25},
        })
        assert result == {"tokens_in": 50, "tokens_out": 25}

    def test_langchain_aimessage_shape(self):
        result = extract_usage_from_result({
            "content": "Hello",
            "usage_metadata": {"input_tokens": 80, "output_tokens": 40},
            "response_metadata": {"model_name": "gpt-4o"},
        })
        assert result == {"tokens_in": 80, "tokens_out": 40, "model": "gpt-4o"}

    def test_langchain_legacy_chatresult_shape(self):
        result = extract_usage_from_result({
            "generations": [],
            "llm_output": {
                "model_name": "gpt-3.5-turbo",
                "token_usage": {"prompt_tokens": 60, "completion_tokens": 30},
            },
        })
        assert result == {"tokens_in": 60, "tokens_out": 30, "model": "gpt-3.5-turbo"}

    def test_aws_bedrock_shape(self):
        result = extract_usage_from_result({
            "modelId": "anthropic.claude-v2",
            "usage": {"inputTokens": 250, "outputTokens": 100},
        })
        assert result == {"tokens_in": 250, "tokens_out": 100, "model": "anthropic.claude-v2"}

    def test_cohere_shape(self):
        result = extract_usage_from_result({
            "meta": {"tokens": {"input_tokens": 90, "output_tokens": 45}},
        })
        assert result == {"tokens_in": 90, "tokens_out": 45}

    def test_openrouter_uses_openai_format(self):
        result = extract_usage_from_result({
            "model": "openai/gpt-4o",
            "usage": {"prompt_tokens": 150, "completion_tokens": 75},
        })
        assert result["tokens_in"] == 150
        assert result["tokens_out"] == 75

    def test_missing_completion_tokens_defaults_to_zero(self):
        result = extract_usage_from_result({
            "model": "gpt-4o",
            "usage": {"prompt_tokens": 100, "total_tokens": 100},
        })
        assert result["tokens_in"] == 100
        assert result["tokens_out"] == 0
