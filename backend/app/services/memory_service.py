from app.repositories.runtime_manifest import load_runtime_manifest
from app.services.ruflo_service import RufloService


class MemoryService:
    def __init__(self, ruflo_service: RufloService | None = None) -> None:
        self.ruflo_service = ruflo_service or RufloService()

    def status(self) -> dict[str, object]:
        return load_runtime_manifest()["memory"]

    def runtime_stats(self) -> dict[str, object]:
        runtime = self.ruflo_service.memory_stats()
        if runtime["available"]:
            return runtime
        return {"runtime": runtime, "fallback": self.status()}
