# Import ORM models so Base.metadata and Alembic see all tables.
import models.project_workers  # noqa: F401
import models.provisional_admin_settings  # noqa: F401
import models.worker_tasks  # noqa: F401
