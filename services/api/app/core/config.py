from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "HealthConnect API"
    api_v1_prefix: str = "/api/v1"
    database_url: str = "sqlite+aiosqlite:///./alis-dev.db"
    secret_key: str = Field(default="local-development-secret-only", min_length=8)
    pairing_code: str = ""
    debug: bool = False
    cors_allowed_origins: list[str] = ["http://localhost:5173"]
    health_llm_provider: str = "ollama"
    health_llm_base_url: str = "http://host.docker.internal:11434"
    health_llm_model: str = "gpt-oss:20b"
    health_llm_think: str = "medium"
    health_llm_advice_max_tokens: int = 180
    health_llm_chat_max_tokens: int = 1200
    health_llm_context_tokens: int = 8192
    health_llm_advice_timeout_seconds: int = 12
    health_llm_stream_first_token_timeout_seconds: int = 90
    health_llm_timeout_seconds: int = 180
    health_llm_keep_alive: str = "4h"
    nutrition_llm_base_url: str = "http://host.docker.internal:11434"
    nutrition_vision_model: str = "qwen3-vl:30b"
    nutrition_llm_timeout_seconds: int = 240
    nutrition_photo_storage_dir: str = "storage/nutrition/photos"
    nutrition_photo_retention: str = "thumbnail_only"
    nutrition_max_photos_per_meal: int = 8
    nutrition_max_photo_bytes: int = 10 * 1024 * 1024
    nutrition_allowed_photo_content_types: list[str] = ["image/jpeg", "image/png", "image/webp"]
    nutrition_job_stale_after_seconds: int = 30 * 60

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
