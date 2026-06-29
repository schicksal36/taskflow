r"""로컬 확인용 설정.

로컬 확인에서는 PostgreSQL을 사용합니다.
MySQL 개발/운영 설정과 분리하기 위해 POSTGRES_DATABASE_URL을 우선 읽습니다.

사용 예:
    .\.venv\Scripts\python.exe manage.py runserver --settings=config.settings.local
"""

from .base import *  # noqa: F401,F403

DEBUG = True
ALLOWED_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "testserver", "testserver.local", "testserver.local:8000","192.168.35.82"]

POSTGRES_DATABASE_URL = localize_docker_db_host(  # noqa: F405
    env("POSTGRES_DATABASE_URL", default=env("DATABASE_URL", default=None))  # noqa: F405
)
if POSTGRES_DATABASE_URL:
    DATABASES = {"default": env.db_url_config(POSTGRES_DATABASE_URL)}  # noqa: F405
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": env("POSTGRES_DB"),  # noqa: F405
            "USER": env("POSTGRES_USER"),  # noqa: F405
            "PASSWORD": env("POSTGRES_PASSWORD"),  # noqa: F405
            "HOST": localize_db_host(env("DB_HOST", default="127.0.0.1")),  # noqa: F405
            "PORT": env("DB_PORT", default="5432"),  # noqa: F405
        }
    }
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DB_CONN_MAX_AGE", default=60)  # noqa: F405

# 로컬에서는 Redis 서버가 없어도 WebSocket 코드가 로드되게 메모리 채널을 씁니다.
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer",
    }
}

# Celery 작업도 로컬에서는 바로 실행되게 두면 흐름 확인이 쉽습니다.
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
