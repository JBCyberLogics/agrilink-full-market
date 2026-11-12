#!/usr/bin/env python3
"""Short-lived NVIDIA transport worker for the AgriLink Node.js AI gateway.

The only input is one JSON object on stdin. It is never persisted or logged.
The worker writes JSON Lines to stdout so streamed SDK chunks can be relayed to
Node without adding a second application-facing API or configuration store.
"""

from __future__ import annotations

import json
import socket
import sys
import time
from typing import Any, Callable
from urllib.parse import urlsplit

MAX_INPUT_BYTES = 256_000
ALLOWED_HOST = "integrate.api.nvidia.com"
ALLOWED_PATHS = {"", "/", "/v1"}


def _emit(value: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(value, separators=(",", ":"), ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _validate_request(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("invalid_request")
    if value.get("operation") not in {"complete", "connectivity", "health"}:
        raise ValueError("invalid_request")
    try:
        timeout_ms = int(value.get("timeoutMs"))
    except (TypeError, ValueError):
        raise ValueError("invalid_request") from None
    if timeout_ms < 1_000 or timeout_ms > 120_000:
        raise ValueError("invalid_request")
    if value.get("operation") == "health":
        return {"operation": "health", "timeoutMs": timeout_ms}
    api_key = value.get("apiKey")
    if not isinstance(api_key, str) or not api_key.strip() or len(api_key) > 500:
        raise ValueError("credential_not_configured")
    base_url = value.get("baseUrl")
    if not isinstance(base_url, str) or len(base_url) > 300:
        raise ValueError("provider_url_invalid")
    parsed = urlsplit(base_url)
    if (
        parsed.scheme != "https"
        or parsed.hostname != ALLOWED_HOST
        or parsed.port not in (None, 443)
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path.rstrip("/") not in ALLOWED_PATHS
    ):
        raise ValueError("provider_url_invalid")
    model = value.get("model")
    if not isinstance(model, str) or not model.strip() or len(model) > 160:
        raise ValueError("model_not_configured")
    return value


def _error_category(error: Exception) -> tuple[str, bool, int | None, int | None, bool | None]:
    """Return sanitized transport classification without exception text."""
    try:
        from openai import APIConnectionError, APIStatusError, APITimeoutError
    except ImportError:
        return "python_sdk_unavailable", True, None, None, None

    if isinstance(error, APITimeoutError):
        return "timeout", True, None, None, None
    if isinstance(error, APIConnectionError):
        return "connection", True, None, None, None
    if isinstance(error, APIStatusError):
        status = int(error.status_code)
        headers = getattr(getattr(error, "response", None), "headers", {})
        raw_retry = headers.get("retry-after") if headers else None
        retry_after_ms = None
        if raw_retry:
            try:
                retry_after_ms = max(0, min(120_000, int(float(raw_retry) * 1000)))
            except (TypeError, ValueError):
                retry_after_ms = None
        category = (
            "authentication" if status in (401, 403)
            else "model_not_found" if status == 404
            else "request_rejected" if status in (400, 422)
            else "timeout" if status == 408
            else "rate_limited" if status == 429
            else "provider_unavailable" if status >= 500
            else "provider_rejected"
        )
        transient = status in (408, 429) or status >= 500
        # Any HTTP response proves DNS, TCP and TLS reached the provider.
        return category, transient, status, retry_after_ms, True
    return "transport_error", False, None, None, None


def _make_client(value: dict[str, Any], client_factory: Callable[..., Any] | None = None) -> Any:
    try:
        import httpx
        from openai import OpenAI
    except ImportError as error:
        raise RuntimeError("python_sdk_unavailable") from error
    factory = client_factory or OpenAI
    timeout = max(1.0, min(120.0, int(value["timeoutMs"]) / 1000.0))
    parsed = urlsplit(value["baseUrl"])
    sdk_base_url = value["baseUrl"].rstrip("/")
    if parsed.path.rstrip("/") == "":
        sdk_base_url = f"{parsed.scheme}://{parsed.netloc}/v1"
    # Redirects stay disabled so the configured public NVIDIA origin cannot
    # redirect the provider credential to a different host.
    http_client = httpx.Client(timeout=timeout, follow_redirects=False)
    return factory(
        api_key=value["apiKey"],
        base_url=sdk_base_url,
        timeout=timeout,
        max_retries=0,
        http_client=http_client,
    )


def _completion_payload(request: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(request, dict) or len(json.dumps(request).encode("utf-8")) > 200_000:
        raise ValueError("request_too_large")
    if not isinstance(request.get("model"), str) or not isinstance(request.get("messages"), list):
        raise ValueError("invalid_request")
    params = dict(request)
    # NVIDIA template options are provider-specific body fields. The SDK's
    # explicit arguments remain limited to the verified OpenAI-compatible API.
    provider_fields = {}
    for key in ("reasoning_effort", "chat_template_kwargs"):
        if key in params:
            provider_fields[key] = params.pop(key)
    if provider_fields:
        params["extra_body"] = provider_fields
    return params


def _run_connectivity(
    value: dict[str, Any],
    client_factory: Callable[..., Any] | None,
    dns_lookup: Callable[..., Any],
) -> dict[str, Any]:
    started = time.monotonic()
    dns_reachable = False
    try:
        dns_lookup(ALLOWED_HOST, 443, type=socket.SOCK_STREAM)
        dns_reachable = True
    except Exception:
        elapsed = round((time.monotonic() - started) * 1000)
        return {
            "ok": True,
            "diagnostic": {
                "stage": "connectivity", "dnsReachable": False, "reachable": False,
                "tlsVerified": False, "authenticated": None, "modelAvailable": None,
                "requestedModel": value["model"], "modelsCount": None,
                "httpStatus": None, "latencyMs": elapsed, "errorCategory": "dns",
            },
        }

    client = None
    http_status = None
    try:
        client = _make_client(value, client_factory)
        # This is a single non-generative GET. Use only the first SDK page to
        # avoid turning a connectivity diagnostic into a paginated crawl.
        page = client.models.list()
        models = list(getattr(page, "data", []) or [])
        available = any(getattr(item, "id", None) == value["model"] for item in models)
        elapsed = round((time.monotonic() - started) * 1000)
        return {
            "ok": True,
            "diagnostic": {
                "stage": "connectivity", "dnsReachable": dns_reachable,
                "reachable": True, "tlsVerified": True, "authenticated": True,
                "modelAvailable": available, "requestedModel": value["model"],
                "modelsCount": len(models), "httpStatus": 200, "latencyMs": elapsed,
                "errorCategory": None if available else "model_unavailable",
            },
        }
    except Exception as error:
        category, _transient, status, _retry_after, tls_verified = _error_category(error)
        if status == 404:
            category = "provider_endpoint_not_found"
        elapsed = round((time.monotonic() - started) * 1000)
        authenticated = False if category == "authentication" else None
        return {
            "ok": True,
            "diagnostic": {
                "stage": "connectivity", "dnsReachable": dns_reachable,
                "reachable": tls_verified is True,
                "tlsVerified": tls_verified, "authenticated": authenticated,
                "modelAvailable": None,
                "requestedModel": value["model"], "modelsCount": None,
                "httpStatus": status, "latencyMs": elapsed,
                "errorCategory": category,
            },
        }
    finally:
        if client is not None:
            try:
                client.close()
            except Exception:
                pass


def _run_completion(
    value: dict[str, Any],
    client_factory: Callable[..., Any] | None,
    emit: Callable[[dict[str, Any]], None],
) -> dict[str, Any]:
    client = None
    try:
        client = _make_client(value, client_factory)
        params = _completion_payload(value.get("request"))
        if params.get("stream") is not True:
            completion = client.chat.completions.create(**params)
            return {"ok": True, "response": completion.model_dump(mode="json")}

        # Relay provider chunks to Node as bounded JSON Lines, then send a
        # normalized final envelope used by the existing gateway contract.
        stream = client.chat.completions.create(**params)
        content_parts: list[str] = []
        completion_id = None
        model = value["model"]
        finish_reason = None
        usage = None
        for chunk in stream:
            chunk_data = chunk.model_dump(mode="json", exclude_none=True)
            completion_id = getattr(chunk, "id", completion_id)
            model = getattr(chunk, "model", model) or model
            chunk_usage = getattr(chunk, "usage", None)
            if chunk_usage is not None:
                usage = chunk_usage.model_dump(mode="json")
            for choice in getattr(chunk, "choices", []) or []:
                delta = getattr(getattr(choice, "delta", None), "content", None)
                if isinstance(delta, str):
                    content_parts.append(delta)
                    emit({"type": "chunk", "content": delta})
                if getattr(choice, "finish_reason", None):
                    finish_reason = choice.finish_reason
            # Preserve non-text metadata such as tool-call deltas for a caller
            # that may later opt into a native stream contract.
            if not any(getattr(getattr(choice, "delta", None), "content", None) for choice in getattr(chunk, "choices", []) or []):
                emit({"type": "chunk_metadata", "data": chunk_data})
        content = "".join(content_parts)
        return {
            "ok": True,
            "response": {
                "id": completion_id, "model": model,
                "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": finish_reason}],
                "usage": usage,
            },
        }
    finally:
        if client is not None:
            try:
                client.close()
            except Exception:
                pass


def execute(
    raw: dict[str, Any],
    *,
    client_factory: Callable[..., Any] | None = None,
    dns_lookup: Callable[..., Any] = socket.getaddrinfo,
    emit: Callable[[dict[str, Any]], None] = _emit,
) -> dict[str, Any]:
    try:
        value = _validate_request(raw)
        if value["operation"] == "health":
            try:
                import httpx
                import openai
            except ImportError:
                return {"ok": False, "error": {"category": "python_sdk_unavailable", "transient": True}}
            return {"ok": True, "health": {"worker": "ready", "sdk": "openai", "sdkVersion": openai.__version__, "httpxVersion": httpx.__version__}}
        if value["operation"] == "connectivity":
            return _run_connectivity(value, client_factory, dns_lookup)
        request = value.get("request")
        if not isinstance(request, dict) or request.get("model") != value["model"]:
            raise ValueError("model_configuration_mismatch")
        return _run_completion(value, client_factory, emit)
    except ValueError as error:
        code = str(error) if str(error) in {
            "invalid_request", "credential_not_configured", "provider_url_invalid",
            "model_not_configured", "request_too_large",
            "model_configuration_mismatch",
        } else "invalid_request"
        return {"ok": False, "error": {"category": code, "transient": False}}
    except RuntimeError as error:
        category = "python_sdk_unavailable" if str(error) == "python_sdk_unavailable" else "transport_error"
        return {"ok": False, "error": {"category": category, "transient": category == "python_sdk_unavailable"}}
    except Exception as error:
        category, transient, status, retry_after_ms, _tls = _error_category(error)
        return {
            "ok": False,
            "error": {
                "category": category, "transient": transient,
                "httpStatus": status, "retryAfterMs": retry_after_ms,
            },
        }


def main() -> int:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        _emit({"ok": False, "error": {"category": "request_too_large", "transient": False}})
        return 0
    try:
        request = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        _emit({"ok": False, "error": {"category": "invalid_request", "transient": False}})
        return 0
    if not isinstance(request, dict):
        _emit({"ok": False, "error": {"category": "invalid_request", "transient": False}})
        return 0
    try:
        result = execute(request, emit=_emit)
        _emit(result)
    except Exception:
        # Never print exception text: SDK and HTTP errors can contain request
        # metadata. Node receives only a safe operational classification.
        _emit({"ok": False, "error": {"category": "transport_error", "transient": False}})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
