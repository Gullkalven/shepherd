import importlib
import logging
import os
import pkgutil
import traceback
from contextlib import asynccontextmanager
from datetime import datetime

from core.config import get_jwt_signing_secret, log_jwt_secret_env_status, settings
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.routing import APIRouter
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response

# MODULE_IMPORTS_START
from services.database import initialize_database, close_database
from services.mock_data import initialize_mock_data
from services.auth import ensure_bootstrap_admin_user_record, initialize_admin_user
# MODULE_IMPORTS_END


def setup_logging():
    """Configure the logging system."""
    if os.environ.get("IS_LAMBDA") == "true":
        return

    # Create the logs directory
    log_dir = "logs"
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)

    # Generate log filename with timestamp
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = f"{log_dir}/app_{timestamp}.log"

    # Configure log format
    log_format = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

    # Configure the root logger
    logging.basicConfig(
        level=logging.DEBUG,
        format=log_format,
        handlers=[
            # File handler
            logging.FileHandler(log_file, encoding="utf-8"),
            # Console handler
            logging.StreamHandler(),
        ],
    )

    # Set log levels for specific modules
    logging.getLogger("uvicorn").setLevel(logging.DEBUG)
    logging.getLogger("fastapi").setLevel(logging.DEBUG)

    # Log configuration details
    logger = logging.getLogger(__name__)
    logger.info("=== Logging system initialized ===")
    logger.info(f"Log file: {log_file}")
    logger.info("Log level: INFO")
    logger.info(f"Timestamp: {timestamp}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger = logging.getLogger(__name__)
    logger.info("=== Application startup initiated ===")

    log_jwt_secret_env_status(logger)

    # MODULE_STARTUP_START
    await initialize_database()
    await initialize_mock_data()
    await initialize_admin_user()
    from core.database import db_manager
    from services.project_workers import ensure_dev_seed_worker

    if db_manager.async_session_maker:
        async with db_manager.async_session_maker() as _s:
            await ensure_dev_seed_worker(_s)
            from services.provisional_admin_auth import ensure_seed_from_env

            await ensure_seed_from_env(_s)
            await ensure_bootstrap_admin_user_record(_s)

            from services.provisional_admin_auth import _plaintext_pin_from_env, get_settings_row

            row = await get_settings_row(_s)
            if not row or not row.pin_hash:
                pin_plain, _src = _plaintext_pin_from_env()
                if pin_plain:
                    logger.error(
                        "provisional_admin_settings.pin_hash is empty after startup seed — "
                        "run database migrations (alembic upgrade head) so provisional admin login can work."
                    )
                else:
                    logger.error(
                        "Provisional admin login disabled: set ADMIN_PASSWORD or SHEPHERD_PROVISIONAL_ADMIN_PIN "
                        "in the backend environment."
                    )
            if not get_jwt_signing_secret():
                logger.error(
                    "No JWT signing secret — set JWT_SECRET_KEY (primary) or SECRET_KEY (fallback) so "
                    "POST /api/v1/admin/provisional/login can issue tokens."
                )
    # MODULE_STARTUP_END

    logger.info("=== Application startup completed successfully ===")
    yield
    # MODULE_SHUTDOWN_START
    await close_database()
    # MODULE_SHUTDOWN_END


app = FastAPI(
    title="FastAPI Modular Template",
    description="A best-practice FastAPI template with modular architecture",
    version="1.0.0",
    lifespan=lifespan,
)


def _build_cors_allow_origins() -> list[str]:
    """Merge FRONTEND_ORIGIN, required defaults, and CORS_ORIGINS (comma-separated). Preserves order, dedupes."""
    merged: list[str] = []
    for o in (
        settings.frontend_origin,
        "https://shepherd-frontend.onrender.com",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ):
        t = (o or "").strip()
        if t:
            merged.append(t)
    extra = (settings.cors_origins or "").strip()
    if extra:
        for part in extra.split(","):
            p = part.strip()
            if p:
                merged.append(p)
    return list(dict.fromkeys(merged))


def _cors_header_dict(request: Request) -> dict[str, str]:
    """Mirror CORSMiddleware allowlist so JSON error responses from handlers include CORS headers."""
    origin = request.headers.get("origin")
    allow = _build_cors_allow_origins()
    if origin and origin in allow:
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
        }
    return {}


def add_cors_headers(request: Request, response: Response) -> Response:
    for key, val in _cors_header_dict(request).items():
        response.headers[key] = val
    return response


# Single CORS middleware — avoid stacking duplicate CORSMiddleware instances.
# MODULE_MIDDLEWARE_START
app.add_middleware(
    CORSMiddleware,
    allow_origins=_build_cors_allow_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)
# MODULE_MIDDLEWARE_END


# Auto-discover and include all routers from the local `routers` package
def include_routers_from_package(app: FastAPI, package_name: str = "routers") -> None:
    """Discover and include all APIRouter objects from a package.

    This scans the given package (and subpackages) for module-level variables that
    are instances of FastAPI's APIRouter. It supports "router", "admin_router" names.
    """

    logger = logging.getLogger(__name__)

    try:
        pkg = importlib.import_module(package_name)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.debug("Routers package '%s' not loaded: %s", package_name, exc)
        return

    discovered: int = 0
    for _finder, module_name, is_pkg in pkgutil.walk_packages(pkg.__path__, pkg.__name__ + "."):
        # Only import leaf modules; subpackages will be walked automatically
        if is_pkg:
            continue
        try:
            module = importlib.import_module(module_name)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.warning("Failed to import module '%s': %s", module_name, exc)
            continue

        # Check for router variable names: router and admin_router
        for attr_name in ("router", "admin_router"):
            if not hasattr(module, attr_name):
                continue

            attr = getattr(module, attr_name)

            if isinstance(attr, APIRouter):
                app.include_router(attr)
                discovered += 1
                logger.info("Included router: %s.%s", module_name, attr_name)
            elif isinstance(attr, (list, tuple)):
                for idx, item in enumerate(attr):
                    if isinstance(item, APIRouter):
                        app.include_router(item)
                        discovered += 1
                        logger.info("Included router from list: %s.%s[%d]", module_name, attr_name, idx)

    if discovered == 0:
        logger.debug("No routers discovered in package '%s'", package_name)


# Setup logging before router discovery
setup_logging()
include_routers_from_package(app, "routers")


@app.get("/api/config")
def frontend_runtime_config() -> JSONResponse:
    """Public runtime JSON for the SPA (matches Lambda `handle_config_request` shape)."""
    base = settings.upload_base_url.rstrip("/")
    return JSONResponse(
        content={"API_BASE_URL": base},
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=300",
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(request: Request, exc: RequestValidationError):
    """Include CORS on validation failures (browser shows them as network/CORS when headers missing)."""
    return add_cors_headers(
        request,
        JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"detail": exc.errors()}),
    )


@app.exception_handler(StarletteHTTPException)
async def starlette_http_exception_handler(request: Request, exc: StarletteHTTPException):
    """HTTPException (FastAPI) subclasses this — ensures CORS headers on 401/403/503 etc."""
    return add_cors_headers(
        request,
        JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}),
    )


# Add exception handler for all exceptions except HTTPException
@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle unexpected exceptions with JSON + CORS (failed handlers bypass CORSMiddleware response path)."""
    if isinstance(exc, StarletteHTTPException):
        return await starlette_http_exception_handler(request, exc)

    logger = logging.getLogger(__name__)
    error_message = str(exc)
    error_type = type(exc).__name__

    logger.error("Unhandled exception: %s: %s\n%s", error_type, error_message, traceback.format_exc())

    is_dev = os.getenv("ENVIRONMENT", "prod").lower() == "dev"

    if is_dev:
        error_detail = f"{error_type}: {error_message}\n{traceback.format_exc()}"
        body = {"detail": error_detail}
    else:
        body = {"detail": "Internal Server Error"}

    return add_cors_headers(
        request,
        JSONResponse(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content=body),
    )


@app.get("/")
def root():
    return {"message": "FastAPI Modular Template is running"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}


def run_in_debug_mode(app: FastAPI):
    """Run the FastAPI app in debug mode with proper asyncio handling.

    This function handles the special case of running in a debugger (PyCharm, VS Code, etc.)
    where asyncio is patched, causing conflicts with uvicorn's asyncio_run.

    It loads environment variables from ../.env and uses asyncio.run() directly
    to avoid uvicorn's asyncio_run conflicts.

    Args:
        app: The FastAPI application instance
    """
    import asyncio
    from pathlib import Path

    import uvicorn
    from dotenv import load_dotenv

    # Load environment variables from ../.env in debug mode
    # If `LOCAL_DEBUG=true` is set, then MetaGPT's `ProjectBuilder.build()` will generate the `.env` file
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path, override=True)
        logger = logging.getLogger(__name__)
        logger.info(f"Loaded environment variables from {env_path}")

    # In debug mode, use asyncio.run() directly to avoid uvicorn's asyncio_run conflicts
    config = uvicorn.Config(
        app,
        host="0.0.0.0",
        port=int(settings.port),
        log_level="info",
    )
    server = uvicorn.Server(config)
    asyncio.run(server.serve())


if __name__ == "__main__":
    import sys

    import uvicorn

    # Detect if running in debugger (PyCharm, VS Code, etc.)
    # Debuggers patch asyncio which conflicts with uvicorn's asyncio_run
    is_debugging = "pydevd" in sys.modules or (hasattr(sys, "gettrace") and sys.gettrace() is not None)

    if is_debugging:
        run_in_debug_mode(app)
    else:
        # Enable reload in normal mode
        uvicorn.run(
            app,
            host="0.0.0.0",
            port=int(settings.port),
            reload_excludes=["**/*.py"],
        )
