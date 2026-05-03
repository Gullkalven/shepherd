import logging
import os
from typing import Any, Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


def _env_has_nonempty(key: str) -> bool:
    raw = os.environ.get(key)
    return raw is not None and bool(str(raw).strip())


def log_jwt_secret_env_status(log: logging.Logger) -> None:
    """Log whether JWT-related env vars are present (never log values)."""
    log.info("JWT_SECRET_KEY configured: %s", "yes" if _env_has_nonempty("JWT_SECRET_KEY") else "no")
    log.info("SECRET_KEY configured: %s", "yes" if _env_has_nonempty("SECRET_KEY") else "no")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=False, extra="ignore")

    database_url: str = "sqlite:///./construction.db"

    # Application
    app_name: str = "FastAPI Modular Template"
    debug: bool = False
    version: str = "1.0.0"

    # Server
    host: str = "0.0.0.0"
    port: int = 8000

    # AWS Lambda Configuration
    is_lambda: bool = False
    lambda_function_name: str = "fastapi-backend"
    aws_region: str = "us-east-1"

    # Object storage integration (used by /api/v1/storage/* endpoints)
    oss_service_url: str = ""
    oss_api_key: str = ""
    public_backend_url: str = ""
    frontend_origin: str = "https://shepherd-frontend.onrender.com"

    #: Comma-separated extra browser origins for CORS (preview URLs, etc.). Merged in main.py with defaults.
    cors_origins: str = ""

    #: Primary JWT signing secret (env: JWT_SECRET_KEY)
    jwt_secret_key: Optional[str] = Field(default=None)
    #: Fallback application secret used for JWT signing if JWT_SECRET_KEY is unset (env: SECRET_KEY)
    secret_key: Optional[str] = Field(default=None)
    #: Signing algorithm for app-issued JWTs (env: JWT_ALGORITHM). Required at runtime — default avoids prod misconfig.
    jwt_algorithm: str = Field(default="HS256")
    #: Default access-token lifetime in minutes (env: JWT_EXPIRE_MINUTES)
    jwt_expire_minutes: int = Field(default=60)

    @property
    def backend_url(self) -> str:
        """Generate backend URL from host and port."""
        if self.is_lambda:
            # In Lambda environment, return the API Gateway URL
            return os.environ.get(
                "PYTHON_BACKEND_URL", f"https://{self.lambda_function_name}.execute-api.{self.aws_region}.amazonaws.com"
            )
        else:
            # Use localhost for external callbacks instead of 0.0.0.0
            display_host = "127.0.0.1" if self.host == "0.0.0.0" else self.host
            return os.environ.get("PYTHON_BACKEND_URL", f"http://{display_host}:{self.port}")

    @property
    def upload_base_url(self) -> str:
        """Public URL used in browser-facing upload/download links."""
        explicit = (self.public_backend_url or "").strip()
        if explicit:
            return explicit.rstrip("/")
        return self.backend_url.rstrip("/")

    def __getattr__(self, name: str) -> Any:
        """
        Dynamically read attributes from environment variables.
        For example: settings.opapi_key reads from OPAPI_KEY environment variable.

        Args:
            name: Attribute name (e.g., 'opapi_key')

        Returns:
            Value from environment variable

        Raises:
            AttributeError: If attribute doesn't exist and not found in environment variables
        """
        # Convert attribute name to environment variable name (snake_case -> UPPER_CASE)
        env_var_name = name.upper()

        # Check if environment variable exists
        if env_var_name in os.environ:
            value = os.environ[env_var_name]
            # Cache the value in instance dict to avoid repeated lookups
            self.__dict__[name] = value
            logger.debug(f"Read dynamic attribute {name} from environment variable {env_var_name}")
            return value

        # If not found, raise AttributeError to maintain normal Python behavior
        raise AttributeError(f"'{self.__class__.__name__}' object has no attribute '{name}'")


# Global settings instance
settings = Settings()


def get_jwt_signing_secret() -> Optional[str]:
    """Return the secret used to sign/verify app JWTs.

    Priority: ``JWT_SECRET_KEY`` (primary), then ``SECRET_KEY`` (fallback), then
    :attr:`Settings.jwt_secret_key` / :attr:`Settings.secret_key` from pydantic env loading.

    Reads ``os.environ`` first so production uses the live process environment.
    Never log the return value.
    """
    for env_key in ("JWT_SECRET_KEY", "SECRET_KEY"):
        raw = os.environ.get(env_key)
        if raw is not None and str(raw).strip():
            return str(raw).strip()
    if settings.jwt_secret_key and str(settings.jwt_secret_key).strip():
        return str(settings.jwt_secret_key).strip()
    if settings.secret_key and str(settings.secret_key).strip():
        return str(settings.secret_key).strip()
    return None
