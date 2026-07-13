from abc import ABC, abstractmethod
from typing import Any

from app.schemas.business_transformation import ToolExecutionResult


class BaseTool(ABC):
    name: str
    description: str
    input_schema: dict[str, str]
    output_schema: dict[str, str]

    def validate_permissions(self, permissions: set[str]) -> bool:
        return self.name in permissions

    @abstractmethod
    def execute(self, payload: dict[str, Any]) -> ToolExecutionResult:
        raise NotImplementedError


class SimulatedBusinessTool(BaseTool):
    def __init__(self, name: str, description: str) -> None:
        self.name = name
        self.description = description
        self.input_schema = {"objective": "string"}
        self.output_schema = {"summary": "string", "recommendations": "array"}

    def execute(self, payload: dict[str, Any]) -> ToolExecutionResult:
        title = str(payload.get("objective", "objetivo empresarial"))
        return ToolExecutionResult(
            tool=self.name,
            success=True,
            simulated=True,
            summary=f"Simulacao {self.name} concluida para: {title}",
            data={
                "recommendations": [
                    "validar dados e baseline antes da automacao",
                    "iniciar em modo assistido",
                    "medir resultado empresarial e risco residual",
                ]
            },
        )


def default_transformation_tools() -> dict[str, BaseTool]:
    definitions = {
        "process_tool": "Mapeia processo, atores, gargalos e decisoes.",
        "data_tool": "Avalia disponibilidade e qualidade dos dados.",
        "kpi_tool": "Define baseline, meta e frequencia de medicao.",
        "automation_tool": "Simula automacoes, APIs e tools MCP.",
        "document_tool": "Simula consulta e geracao de documentos.",
    }
    return {
        name: SimulatedBusinessTool(name, description)
        for name, description in definitions.items()
    }
