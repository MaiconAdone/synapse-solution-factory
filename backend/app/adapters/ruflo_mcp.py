import asyncio
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


class RufloMcpError(RuntimeError):
    pass


class RufloMcpClient:
    def __init__(self, config_path: str = ".mcp.json", timeout_seconds: float = 30.0) -> None:
        root = Path(__file__).resolve().parents[3]
        self.config_path = root / config_path
        self.timeout_seconds = timeout_seconds

    def call_tool(self, tool_name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            try:
                asyncio.get_running_loop()
            except RuntimeError:
                return asyncio.run(self._call_tool(tool_name, arguments or {}))

            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(
                    asyncio.run,
                    self._call_tool(tool_name, arguments or {}),
                )
                return future.result(timeout=self.timeout_seconds + 5)
        except RufloMcpError:
            raise
        except Exception as error:
            raise RufloMcpError(str(error)) from error

    async def _call_tool(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        command, args, env = self._load_server_config()
        parameters = StdioServerParameters(
            command=command,
            args=args,
            env=env,
            cwd=self.config_path.parent,
        )
        try:
            result = await asyncio.wait_for(
                self._session_call(parameters, tool_name, arguments),
                timeout=self.timeout_seconds,
            )
        except asyncio.TimeoutError as error:
            raise RufloMcpError(
                f"Timed out after {self.timeout_seconds}s calling Ruflo tool {tool_name}"
            ) from error
        return self._normalize_tool_result(result)

    @staticmethod
    async def _session_call(
        parameters: StdioServerParameters,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> Any:
        async with stdio_client(parameters) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                return await session.call_tool(tool_name, arguments)

    def _load_server_config(self) -> tuple[str, list[str], dict[str, str]]:
        if not self.config_path.exists():
            raise RufloMcpError(f"MCP config not found: {self.config_path}")

        config = json.loads(self.config_path.read_text(encoding="utf-8"))
        server = config["mcpServers"]["ruflo"]
        env = dict(os.environ)
        for key, value in server.get("env", {}).items():
            if isinstance(value, str) and value.startswith("${env:") and value.endswith("}"):
                env_name = value[6:-1]
                env[key] = env.get(env_name, "")
            else:
                env[key] = str(value)
        return str(server["command"]), [str(arg) for arg in server.get("args", [])], env

    @staticmethod
    def _normalize_tool_result(result: Any) -> dict[str, Any]:
        structured = getattr(result, "structuredContent", None)
        if isinstance(structured, dict):
            return structured

        content = getattr(result, "content", None)
        if isinstance(content, list) and content:
            first = content[0]
            text = getattr(first, "text", None)
            if isinstance(text, str):
                try:
                    parsed = json.loads(text)
                    return parsed if isinstance(parsed, dict) else {"data": parsed}
                except json.JSONDecodeError:
                    return {"text": text}

        if hasattr(result, "model_dump"):
            return result.model_dump(mode="json")
        return {"result": str(result)}
