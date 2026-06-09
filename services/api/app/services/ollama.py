import json
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx


class OllamaError(RuntimeError):
    pass


class OllamaClient:
    def __init__(
        self,
        base_url: str,
        model: str,
        timeout_seconds: int = 180,
        context_tokens: int = 8192,
        keep_alive: str = "4h",
        think: str = "medium",
        http_client: httpx.AsyncClient | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.context_tokens = context_tokens
        self.keep_alive = keep_alive
        self.think = think
        self.http_client = http_client

    def _payload(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
        stream: bool,
        format_json: bool = False,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": stream,
            "options": {
                "num_predict": max_tokens,
                "num_ctx": self.context_tokens,
                "temperature": temperature,
            },
            "keep_alive": self.keep_alive,
            "think": self.think,
        }
        if format_json:
            payload["format"] = "json"
        return payload

    async def chat(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float = 0.2,
        format_json: bool = False,
    ) -> str:
        payload = self._payload(
            messages,
            max_tokens=max_tokens,
            temperature=temperature,
            stream=False,
            format_json=format_json,
        )
        if self.http_client is not None:
            response = await self.http_client.post(
                f"{self.base_url}/api/chat",
                json=payload,
                timeout=self.timeout_seconds,
            )
        else:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/api/chat",
                    json=payload,
                    timeout=self.timeout_seconds,
                )
        try:
            response.raise_for_status()
            data = response.json()
            content = data["message"]["content"]
        except Exception as exc:
            raise OllamaError("Invalid Ollama response") from exc
        if not isinstance(content, str) or not content.strip():
            raise OllamaError("Invalid Ollama response")
        return content.strip()

    async def stream_chat(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float = 0.3,
    ) -> AsyncIterator[str]:
        payload = self._payload(messages, max_tokens=max_tokens, temperature=temperature, stream=True)
        client: httpx.AsyncClient | None = None
        if self.http_client is not None:
            stream_context = self.http_client.stream(
                "POST",
                f"{self.base_url}/api/chat",
                json=payload,
                timeout=self.timeout_seconds,
            )
        else:
            client = httpx.AsyncClient()
            stream_context = client.stream(
                "POST",
                f"{self.base_url}/api/chat",
                json=payload,
                timeout=self.timeout_seconds,
            )

        try:
            async with stream_context as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    content = (data.get("message") or {}).get("content")
                    if isinstance(content, str) and content:
                        yield content
        except Exception as exc:
            raise OllamaError("Ollama stream failed") from exc
        finally:
            if client is not None:
                await client.aclose()

    async def status(self) -> dict[str, Any]:
        loaded = False
        if self.http_client is not None and hasattr(self.http_client, "get"):
            response = await self.http_client.get(f"{self.base_url}/api/ps", timeout=10)
            response.raise_for_status()
            loaded = any(item.get("name") == self.model for item in response.json().get("models", []))
        elif self.http_client is None:
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{self.base_url}/api/ps", timeout=10)
                response.raise_for_status()
                loaded = any(item.get("name") == self.model for item in response.json().get("models", []))

        started = time.perf_counter()
        first_token_latency_ms: int | None = None
        try:
            async for _chunk in self.stream_chat(
                [{"role": "user", "content": "Réponds OK."}],
                max_tokens=1,
                temperature=0,
            ):
                first_token_latency_ms = int((time.perf_counter() - started) * 1000)
                break
        except Exception:
            first_token_latency_ms = None

        return {
            "model": self.model,
            "loaded": loaded,
            "load_duration_ms": None,
            "first_token_latency_ms": first_token_latency_ms,
            "keep_alive": self.keep_alive,
            "context_tokens": self.context_tokens,
            "think": self.think,
        }
