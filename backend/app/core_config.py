from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Enterprise AI/ML Multi-Agent SaaS"
    environment: str = "local"
    app_api_key: str = ""
    allow_insecure_local_auth: bool = True
    cors_origins: str = "http://localhost:3000"
    project_factory_base_path: str = "C:\\Users\\malves\\Documents\\Projetos"
    project_factory_timeout_seconds: int = 600
    synapse_project_index_path: str = "./artifacts/projects/synapse-projects.json"
    ruflo_mcp_server: str = "ruflo"
    readiness_require_ruflo: bool = False
    swarm_topology: str = "hierarchical-mesh"
    swarm_consensus: str = "majority"
    memory_backend: str = "hybrid"
    vector_db_path: str = "./vector_db"
    project_creation_mode: str = "local"
    database_url: str = ""
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""
    project_storage_backend: str = "supabase"
    project_storage_bucket: str = "Synapse-projects"
    github_projects_owner: str = ""
    github_projects_visibility: str = "private"
    local_llm_enabled: bool = True
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen2.5-coder:3b"
    ollama_general_model: str = "qwen3:8b"
    ollama_balanced_model: str = "deepseek-coder-v2:lite"
    ollama_code_review_model: str = "deepseek-coder-v2:lite"
    ollama_code_strong_model: str = "qwen2.5-coder:14b"
    ollama_planning_strong_model: str = "qwen3:14b"
    ollama_reasoning_strong_model: str = "deepseek-r1:14b"
    ollama_code_critical_model: str = "qwen2.5-coder:32b"
    ollama_large_model: str = "qwen2.5-coder:32b"
    ollama_embedding_model: str = "nomic-embed-text:latest"
    ollama_timeout_seconds: float = 600.0
    ollama_context_window: int = 4096
    ollama_max_output_tokens: int = 512
    ollama_seed: int = 42
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-5.5"
    openai_timeout_seconds: float = 180.0
    llm_routing_metrics_path: str = "./artifacts/llm-routing/events.jsonl"
    llm_gateway_cache_path: str = "./artifacts/llm-routing/cache.jsonl"
    llm_gateway_audit_path: str = "./artifacts/llm-routing/audit.jsonl"
    llm_gateway_max_input_tokens: int = 30000
    llm_gateway_daily_cloud_token_budget: int = 200000
    llm_gateway_per_request_cloud_token_budget: int = 12000
    governed_swarm_audit_path: str = "./artifacts/governance/swarm-executions.jsonl"
    business_transformation_store_path: str = "./artifacts/business-transformations"
    learning_events_path: str = "./memory/synapse_learning_memory.jsonl"
    local_training_dataset_path: str = "./data/learning/ollama_training.jsonl"
    peer_messaging_db_path: str = "./artifacts/peers/synapse-peers.db"
    peer_messaging_max_message_chars: int = 1200
    peer_messaging_max_summary_chars: int = 360

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [
            origin.strip()
            for origin in self.cors_origins.split(",")
            if origin.strip()
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
