from app.repositories.runtime_manifest import load_runtime_manifest


class MemoryService:
    def status(self) -> dict[str, object]:
        return load_runtime_manifest()["memory"]

    def runtime_stats(self) -> dict[str, object]:
        return self.status()
