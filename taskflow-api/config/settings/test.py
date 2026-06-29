"""테스트 실행용 설정.

기본은 PostgreSQL 테스트 DB입니다.
다만 로컬에서 PostgreSQL이 바로 안 잡힐 때는 `TASKFLOW_TEST_USE_SQLITE=true` 또는
`TEST_DATABASE_URL=sqlite:///...`로 SQLite 테스트도 돌릴 수 있습니다.
"""

from .base import *  # noqa: F401,F403

DEBUG = False
ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1"]
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

if env.bool("TASKFLOW_TEST_USE_SQLITE", default=False):  # noqa: F405
    DATABASES = {  # noqa: F405
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.test.sqlite3",  # noqa: F405
        }
    }
elif env("TEST_DATABASE_URL", default=None):  # noqa: F405
    DATABASES = {"default": env.db("TEST_DATABASE_URL")}  # noqa: F405
else:
    test_name = env("POSTGRES_TEST_DB", default=f"test_{DATABASES['default']['NAME']}")  # noqa: F405
    DATABASES["default"]["TEST"] = {"NAME": test_name}  # noqa: F405

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    }
}
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
