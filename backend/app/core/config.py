"""
Application configuration using pydantic-settings.
Loads from environment variables and .env file.
"""

from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # --- Application ---
    app_env: str = "development"
    app_debug: bool = False
    app_name: str = "3D Development Platform"
    app_version: str = "0.1.0"

    # --- Database ---
    database_url: str = "postgresql+asyncpg://devuser:devpassword@localhost:5432/dev_platform"
    database_url_sync: str = "postgresql://devuser:devpassword@localhost:5432/dev_platform"

    # --- Redis ---
    redis_url: str = "redis://localhost:6379/0"

    # --- Security ---
    jwt_secret_key: str = "change-this-in-production"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 30
    jwt_refresh_token_expire_days: int = 7
    allowed_origins: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origins(self) -> List[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",")]

    # --- OAuth2 Social Login ---
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/v1/auth/oauth/google/callback"
    microsoft_client_id: str = ""
    microsoft_client_secret: str = ""
    microsoft_redirect_uri: str = "http://localhost:8000/api/v1/auth/oauth/microsoft/callback"
    frontend_url: str = "http://localhost:5173"

    # --- API Keys ---
    anthropic_api_key: str = ""
    mapbox_access_token: str = ""
    meshy_api_key: str = ""
    meshy_api_base: str = "https://api.meshy.ai"

    # --- Object Storage ---
    s3_bucket_name: str = "dev-platform-uploads"
    s3_region: str = "us-east-1"
    s3_endpoint_url: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"

    # --- Monitoring ---
    sentry_dsn: str = ""
    log_level: str = "INFO"

    # --- Upload Limits ---
    max_upload_size_mb: int = 100
    processing_workers: int = 2

    @property
    def max_upload_size_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024


@lru_cache()
def get_settings() -> Settings:
    return Settings()
