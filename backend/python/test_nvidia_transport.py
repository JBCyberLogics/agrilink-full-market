import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from openai import APIStatusError, APITimeoutError

from nvidia_transport import execute


def config(operation="connectivity", **overrides):
    value = {
        "operation": operation,
        "apiKey": "isolated-test-credential-not-real",
        "baseUrl": "https://integrate.api.nvidia.com/v1",
        "model": "test/model",
        "timeoutMs": 5000,
    }
    value.update(overrides)
    return value


class FakeClient:
    def __init__(self, models=None, completion=None):
        self.models = SimpleNamespace(list=lambda: SimpleNamespace(data=models or []))
        self.chat_calls = 0

        def create(**_kwargs):
            self.chat_calls += 1
            return completion

        self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))
        self.closed = False

    def close(self):
        self.closed = True


class NvidiaTransportTests(unittest.TestCase):
    @staticmethod
    def mock_http_client(handler):
        original_client = httpx.Client

        class MockTransportClient(original_client):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, transport=httpx.MockTransport(handler), **kwargs)

        return patch("httpx.Client", MockTransportClient)

    def test_worker_health_imports_sdk_without_provider_configuration_or_network(self):
        result = execute({"operation": "health", "timeoutMs": 5000}, client_factory=lambda **_kwargs: self.fail("Health must not create a provider client"))
        self.assertTrue(result["ok"])
        self.assertEqual(result["health"]["worker"], "ready")
        self.assertEqual(result["health"]["sdk"], "openai")
        self.assertTrue(result["health"]["sdkVersion"])
        self.assertTrue(result["health"]["httpxVersion"])

    def test_connectivity_uses_model_list_and_never_runs_inference(self):
        client = FakeClient(models=[SimpleNamespace(id="test/model"), SimpleNamespace(id="other/model")])
        received = {}

        def factory(**kwargs):
            received.update(kwargs)
            return client

        result = execute(config(), client_factory=factory, dns_lookup=lambda *_args, **_kwargs: [(None,)] )
        self.assertTrue(result["ok"])
        self.assertEqual(result["diagnostic"]["authenticated"], True)
        self.assertEqual(result["diagnostic"]["modelAvailable"], True)
        self.assertEqual(result["diagnostic"]["modelsCount"], 2)
        self.assertEqual(received["base_url"], "https://integrate.api.nvidia.com/v1")
        self.assertEqual(received["api_key"], "isolated-test-credential-not-real")
        self.assertEqual(received["max_retries"], 0)
        self.assertEqual(client.chat_calls, 0)
        self.assertTrue(client.closed)

    def test_connectivity_reports_configured_model_missing_separately(self):
        client = FakeClient(models=[SimpleNamespace(id="other/model")])
        result = execute(config(), client_factory=lambda **_kwargs: client, dns_lookup=lambda *_args, **_kwargs: [(None,)])
        self.assertTrue(result["diagnostic"]["reachable"])
        self.assertTrue(result["diagnostic"]["authenticated"])
        self.assertFalse(result["diagnostic"]["modelAvailable"])
        self.assertEqual(result["diagnostic"]["errorCategory"], "model_unavailable")

    def test_connectivity_reports_authentication_rejection_without_provider_error_text(self):
        request = httpx.Request("GET", "https://integrate.api.nvidia.com/v1/models")
        response = httpx.Response(401, request=request)

        def reject():
            raise APIStatusError("credential must not be returned", response=response, body={"message": "sensitive provider detail"})

        client = FakeClient()
        client.models.list = reject
        result = execute(config(), client_factory=lambda **_kwargs: client, dns_lookup=lambda *_args, **_kwargs: [(None,)])
        self.assertTrue(result["diagnostic"]["reachable"])
        self.assertTrue(result["diagnostic"]["tlsVerified"])
        self.assertFalse(result["diagnostic"]["authenticated"])
        self.assertEqual(result["diagnostic"]["httpStatus"], 401)
        self.assertNotIn("sensitive provider detail", json.dumps(result))
        self.assertNotIn("isolated-test-credential-not-real", json.dumps(result))

    def test_official_sdk_models_list_uses_tls_client_contract_without_generation(self):
        requests = []

        def handler(request):
            requests.append(request)
            return httpx.Response(200, json={"object": "list", "data": [{"id": "test/model", "object": "model", "created": 1, "owned_by": "nvidia"}]})

        with self.mock_http_client(handler):
            result = execute(config(), dns_lookup=lambda *_args, **_kwargs: [(None,)])

        self.assertTrue(result["diagnostic"]["authenticated"])
        self.assertTrue(result["diagnostic"]["modelAvailable"])
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].method, "GET")
        self.assertEqual(requests[0].url.path, "/v1/models")
        self.assertNotIn("chat", requests[0].url.path)

    def test_invalid_provider_origin_is_rejected_before_sdk_use(self):
        result = execute(config(baseUrl="http://127.0.0.1:8000/v1"), client_factory=lambda **_kwargs: self.fail("SDK should not be called"))
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["category"], "provider_url_invalid")

    def test_root_base_url_is_normalized_and_request_model_must_match_effective_config(self):
        received = {}
        client = FakeClient(completion=SimpleNamespace(model_dump=lambda **_kwargs: {"model": "test/model", "choices": [{"message": {"content": "{}"}}]}))
        result = execute(config(
            operation="complete", baseUrl="https://integrate.api.nvidia.com", request={"model": "test/model", "messages": [], "stream": False}
        ), client_factory=lambda **kwargs: (received.update(kwargs) or client))
        self.assertTrue(result["ok"])
        self.assertEqual(received["base_url"], "https://integrate.api.nvidia.com/v1")

        rejected = execute(config(
            operation="complete", request={"model": "unconfigured/model", "messages": [], "stream": False}
        ), client_factory=lambda **_kwargs: self.fail("Model mismatch should be rejected before SDK use"))
        self.assertFalse(rejected["ok"])
        self.assertEqual(rejected["error"]["category"], "model_configuration_mismatch")

    def test_completion_uses_dynamic_config_and_returns_sdk_response(self):
        completion = SimpleNamespace(model_dump=lambda **_kwargs: {
            "model": "test/model", "choices": [{"message": {"content": "{}"}}], "usage": {"prompt_tokens": 1}
        })
        client = FakeClient(completion=completion)
        received = {}
        result = execute(config(
            operation="complete", request={"model": "test/model", "messages": [{"role": "user", "content": "test"}], "stream": False}
        ), client_factory=lambda **kwargs: (received.update(kwargs) or client))
        self.assertTrue(result["ok"])
        self.assertEqual(result["response"]["model"], "test/model")
        self.assertEqual(received["base_url"], "https://integrate.api.nvidia.com/v1")

    def test_official_sdk_completion_keeps_nvidia_parameters_in_request_body(self):
        requests = []

        def handler(request):
            requests.append(request)
            return httpx.Response(200, json={
                "id": "completion-1", "object": "chat.completion", "created": 1, "model": "test/model",
                "choices": [{"index": 0, "message": {"role": "assistant", "content": '{"content":"ok"}'}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 2, "completion_tokens": 1, "total_tokens": 3},
            })

        with self.mock_http_client(handler):
            result = execute(config(
                operation="complete", request={"model": "test/model", "messages": [{"role": "user", "content": "test"}], "stream": False, "reasoning_effort": "low", "chat_template_kwargs": {"clear_thinking": True}}
            ))

        self.assertTrue(result["ok"])
        self.assertEqual(len(requests), 1)
        body = json.loads(requests[0].content)
        self.assertEqual(body["reasoning_effort"], "low")
        self.assertEqual(body["chat_template_kwargs"], {"clear_thinking": True})
        self.assertEqual(body["model"], "test/model")

    def test_sdk_timeout_is_classified_transient_without_retrying(self):
        client = FakeClient()

        def timeout(**_kwargs):
            raise APITimeoutError(request=httpx.Request("POST", "https://integrate.api.nvidia.com/v1/chat/completions"))

        client.chat.completions.create = timeout
        received = {}
        result = execute(config(
            operation="complete", request={"model": "test/model", "messages": [{"role": "user", "content": "test"}], "stream": False}
        ), client_factory=lambda **kwargs: (received.update(kwargs) or client))
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["category"], "timeout")
        self.assertTrue(result["error"]["transient"])
        self.assertEqual(received["max_retries"], 0)
        self.assertNotIn("isolated-test-credential-not-real", json.dumps(result))

    def test_streaming_chunks_are_relayed_and_a_normalized_response_is_returned(self):
        chunks = [
            SimpleNamespace(id="completion-1", model="test/model", choices=[SimpleNamespace(delta=SimpleNamespace(content='{"content":'), finish_reason=None)], usage=None,
                           model_dump=lambda **_kwargs: {"choices": []}),
            SimpleNamespace(id="completion-1", model="test/model", choices=[SimpleNamespace(delta=SimpleNamespace(content='"ok"}'), finish_reason="stop")], usage=None,
                           model_dump=lambda **_kwargs: {"choices": []}),
        ]
        client = FakeClient(completion=iter(chunks))
        events = []
        result = execute(config(
            operation="complete", request={"model": "test/model", "messages": [{"role": "user", "content": "test"}], "stream": True}
        ), client_factory=lambda **_kwargs: client, emit=events.append)
        self.assertTrue(result["ok"])
        self.assertEqual("".join(event["content"] for event in events), '{"content":"ok"}')
        self.assertEqual(result["response"]["choices"][0]["finish_reason"], "stop")


if __name__ == "__main__":
    unittest.main()
