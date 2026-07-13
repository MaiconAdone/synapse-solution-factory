import subprocess
import os
from pathlib import Path
from typing import Any

from app.adapters.ruflo_mcp import RufloMcpClient, RufloMcpError


class RufloService:
    def __init__(self, client: RufloMcpClient | None = None) -> None:
        self.client = client or RufloMcpClient()

    def swarm_status(self) -> dict[str, Any]:
        return self._call("swarm_status")

    def agent_list(self) -> dict[str, Any]:
        return self._call("agent_list")

    def memory_stats(self) -> dict[str, Any]:
        return self._call("memory_stats")

    def route_task(self, task: str, context: str, top_k: int = 5) -> dict[str, Any]:
        return self._call("hooks_route", {
            "task": task,
            "context": context,
            "topK": top_k,
        })

    def store_memory(
        self,
        namespace: str,
        key: str,
        value: str,
        *,
        upsert: bool = True,
    ) -> dict[str, Any]:
        return self._call("memory_store", {
            "namespace": namespace,
            "key": key,
            "value": value,
            "upsert": upsert,
        })

    def search_memory(
        self,
        query: str,
        namespace: str,
        *,
        limit: int = 5,
        threshold: float = 0.35,
    ) -> dict[str, Any]:
        return self._call("memory_search", {
            "query": query,
            "namespace": namespace,
            "limit": limit,
            "threshold": threshold,
            "smart": True,
        })

    def record_task_outcome(
        self,
        task_id: str,
        task: str,
        *,
        agent: str,
        success: bool,
        quality: float,
    ) -> dict[str, Any]:
        return self._call("hooks_post-task", {
            "taskId": task_id,
            "task": task,
            "agent": agent,
            "success": success,
            "quality": quality,
            "storeDecisions": True,
        })

    def execute_workflow(self, workflow_id: str, agent_ids: list[str] | None = None, parallel: bool = False) -> dict[str, Any]:
        result = self._call("daa_workflow_execute", {
            "workflowId": workflow_id,
            "agentIds": agent_ids,
            "parallelExecution": parallel,
        })
        if result["available"]:
            return result
        return self._run_workflow_cli(workflow_id, parallel)

    def _call(self, tool_name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            return {
                "source": "ruflo_mcp",
                "available": True,
                "tool": tool_name,
                "data": self.client.call_tool(tool_name, arguments),
            }
        except (OSError, RufloMcpError) as error:
            return {
                "source": "ruflo_mcp",
                "available": False,
                "tool": tool_name,
                "error": str(error),
            }

    def _run_workflow_cli(self, workflow_id: str, parallel: bool) -> dict[str, Any]:
        root = Path(__file__).resolve().parents[3]
        workflow_file = root / "config" / "workflows" / "ruflo" / f"{workflow_id}.json"
        if not workflow_file.exists():
            return {
                "source": "ruflo_cli",
                "available": False,
                "tool": "workflow run",
                "error": f"Workflow file not found: {workflow_file}",
            }

        if parallel:
            validate_command = self._ruflo_command(
                root,
                "workflow",
                "validate",
                "-f",
                str(workflow_file),
            )
            validate_result = subprocess.run(
                validate_command,
                cwd=root,
                capture_output=True,
                text=True,
                timeout=120,
                check=False,
            )
            if validate_result.returncode != 0:
                return {
                    "source": "ruflo_cli",
                    "available": False,
                    "tool": "workflow validate",
                    "workflow_file": str(workflow_file),
                    "returncode": validate_result.returncode,
                    "stdout": validate_result.stdout,
                    "stderr": validate_result.stderr,
                }

            command = self._ruflo_command(
                root,
                "swarm",
                "start",
                "-o",
                f"Execute workflow {workflow_id} from {workflow_file.name}",
                "-s",
                "specialized",
                "--parallel",
            )
            tool = "swarm start"
        else:
            command = self._ruflo_command(
                root,
                "workflow",
                "validate",
                "-f",
                str(workflow_file),
            )
            tool = "workflow validate"
        try:
            completed = subprocess.run(
                command,
                cwd=root,
                capture_output=True,
                text=True,
                timeout=120,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            return {
                "source": "ruflo_cli",
                "available": False,
                "tool": tool,
                "workflow_file": str(workflow_file),
                "error": f"Timed out after {error.timeout} seconds",
                "stdout": error.stdout or "",
                "stderr": error.stderr or "",
            }
        except OSError as error:
            return {
                "source": "ruflo_cli",
                "available": False,
                "tool": tool,
                "workflow_file": str(workflow_file),
                "error": str(error),
            }

        return {
            "source": "ruflo_cli",
            "available": completed.returncode == 0,
            "tool": tool,
            "workflow_file": str(workflow_file),
            "returncode": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
        }

    def _ruflo_command(self, root: Path, *args: str) -> list[str]:
        suffix = ".cmd" if os.name == "nt" else ""
        local_ruflo = root / "node_modules" / ".bin" / f"ruflo{suffix}"
        if local_ruflo.exists():
            if os.name == "nt":
                return ["cmd", "/c", str(local_ruflo), *args]
            return [str(local_ruflo), *args]
        if os.name == "nt":
            return ["cmd", "/c", "npm", "exec", "--", "ruflo", *args]
        return ["npm", "exec", "--", "ruflo", *args]
