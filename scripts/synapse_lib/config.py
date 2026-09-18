from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    peer_messaging_db_path: str = "./artifacts/peers/synapse-peers.db"
    peer_messaging_max_message_chars: int = 1200
    peer_messaging_max_summary_chars: int = 360

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
