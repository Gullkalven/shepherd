# FastAPI Modular Template

A best-practice FastAPI framework template designed for rapid module development and integration.

## 🚀 Features

- **Modular Architecture**: Clean separation of concerns with routers, models, and services
- **Injection Points**: Easy module integration with marked injection points
- **Configuration Management**: Environment-based configuration with Pydantic Settings
- **Development Ready**: Pre-configured with CORS, testing, and development tools

## 📁 Project Structure

```
backend/
├── main.py                # FastAPI app with MODULE_ injection points
├── requirements.txt       # Python dependencies
├── .env.example           # Environment variables template
├── core/
│   ├── __init__.py
│   └── config.py          # Pydantic settings with MODULE_CONFIG injection
├── routers/               # API route handlers
│   ├── __init__.py
├── models/                # Database and Pydantic data models
│   ├── __init__.py
├── services/              # Business logic services
│   ├── __init__.py
├── dependencies/          # Dependency injection modules
│   ├── __init__.py
├── middlewares/           # Custom middleware components
│   ├── __init__.py
├── schemas/               # Pydantic request/response models
│   ├── __init__.py
├── tests/                 # Test files
│   ├── __init__.py
│   ├── conftest.py        # Pytest configuration
│   └── test_main.py       # Main app tests
└── utils/                 # Utility functions
    ├── __init__.py
```

## 🛠 Quick Start

1. **Install Dependencies**

   ```bash
   pip install -r requirements.txt
   ```

2. **Configure Environment**

   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Run the Server**

   ```bash
   python main.py
   ```

4. **Test the API**
   ```bash
   curl http://localhost:8000/health
   ```

## Database Safety (Production)

- Local development may use SQLite (for example `sqlite+aiosqlite:///./construction.db`).
- Production (`ENVIRONMENT=production` or `RENDER=true`) must use PostgreSQL via `DATABASE_URL`.
- In production, startup fails loudly when:
  - `DATABASE_URL` is missing, or
  - `DATABASE_URL` uses SQLite, or
  - `DATABASE_URL` uses a non-PostgreSQL dialect.
- Startup logs include sanitized database details (`database dialect` and `database target`) without credentials.
- Use `GET /health/db` to verify runtime DB config (dialect/host/database name/warnings) safely.

## 🔌 Module Injection Points

This template includes predefined injection points for easy module integration. All injection points use the `MODULE_` prefix for easy identification:

### main.py

```python
# MODULE_IMPORTS_START
# Module imports will be injected here
# MODULE_IMPORTS_END

@asynccontextmanager
async def lifespan(app: FastAPI):
    # MODULE_STARTUP_START
    # Module startup code will be injected here
    # MODULE_STARTUP_END
    yield
    # MODULE_SHUTDOWN_START
    # Module shutdown code will be injected here
    # MODULE_SHUTDOWN_END

# MODULE_MIDDLEWARE_START
# Module middleware will be injected here
# MODULE_MIDDLEWARE_END

# MODULE_ROUTERS_START
# Module routers will be injected here
# MODULE_ROUTERS_END
```

### core/config.py

```python
class Settings(BaseSettings):
    # ... existing settings ...

    # MODULE_CONFIG_START
    # Module configuration will be injected here
    # MODULE_CONFIG_END
```

## 📦 Module Integration

To integrate modules with this template:

1. **Use the module manager**:

   ```bash
   python manager.py install base <module-name>
   ```

2. **Manual integration** (modules automatically handle these):
   - Add imports to `MODULE_IMPORTS` section
   - Add startup/shutdown logic to respective sections
   - Add configuration to `MODULE_CONFIG` section
   - Add routers and middleware to respective sections

## 🧪 Testing

Run tests with pytest:

```bash
pytest tests/ -v
```

The template includes:

- Basic API endpoint tests
- Application lifecycle tests
- Test client configuration in `conftest.py`
