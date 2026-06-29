"""개발/사내 서버용 설정.

개발/사내 서버에서는 MySQL을 사용합니다.
`manage.py migrate --settings=config.settings.dev`는 MYSQL_DATABASE_URL에 있는
MySQL 서버에 테이블을 만듭니다.
"""

from .base import *  # noqa: F401,F403

DEBUG = env.bool("DEBUG", default=True)  # noqa: F405

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

