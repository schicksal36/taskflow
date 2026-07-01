"""TaskFlow 공통 Django 설정.

이 파일은 서버가 켜질 때 가장 먼저 읽는 "규칙표"입니다.
초등학생도 알기 쉽게 말하면, 학교 문을 열기 전에
"어떤 반이 있는지", "출입증은 어떻게 확인하는지", "DB 주소는 어디인지"를
적어 둔 안내판입니다.
"""

from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent

# django-environ은 .env 파일을 읽어서 SECRET_KEY, DATABASE_URL 같은 값을 꺼내 줍니다.
# 비밀번호를 코드에 직접 쓰지 않고 .env에 두면, 서버마다 다른 값을 안전하게 쓸 수 있습니다.
env = environ.Env(
    DEBUG=(bool, False),
)
environ.Env.read_env(BASE_DIR / ".env")

# Docker Compose 안에서는 DB 호스트 이름 "db"가 맞습니다.
# 하지만 Windows PowerShell에서 manage.py를 바로 실행하면 "db"라는 이름을 찾지 못합니다.
# 그래서 Docker 밖에서만 "db"를 "127.0.0.1"로 바꿔 로컬 PostgreSQL에 연결합니다.
RUNNING_IN_DOCKER = Path("/.dockerenv").exists() or env.bool("TASKFLOW_IN_DOCKER", default=False)


def localize_docker_db_host(value: str | None) -> str | None:
    if not value or RUNNING_IN_DOCKER or env.bool("TASKFLOW_USE_DOCKER_HOSTS", default=False):
        return value
    return value.replace("@db:", "@127.0.0.1:", 1).replace("@db/", "@127.0.0.1/", 1)


def localize_db_host(value: str) -> str:
    if value == "db" and not RUNNING_IN_DOCKER and not env.bool("TASKFLOW_USE_DOCKER_HOSTS", default=False):
        return "127.0.0.1"
    return value

SECRET_KEY = env("SECRET_KEY")
DEBUG = env.bool("DEBUG", default=False)
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=[])

DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.sites",
]

THIRD_PARTY_APPS = [
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    "rest_framework",
    "rest_framework.authtoken",
    "rest_framework_simplejwt.token_blacklist",
    # dj-rest-auth와 allauth는 로그인/회원가입 흐름을 표준 방식으로 확장할 때 씁니다.
    "dj_rest_auth",
    "dj_rest_auth.registration",
    "allauth",
    "allauth.account",
    "allauth.socialaccount",
    # Celery Beat는 마감 알림 같은 반복 작업 시간을 관리합니다.
    "django_celery_beat",
    "channels",
]

TASKFLOW_APPS = [
    "apps.common",
    "apps.users",
    "apps.work_requests",
    "apps.todos",
    "apps.schedules",
    "apps.notifications",
    "apps.media_files",
    "apps.boards",
    "apps.reports",
]

# daphne는 runserver/ASGI 처리 우선순위 때문에 staticfiles보다 앞에 있어야 합니다.
INSTALLED_APPS = ["daphne"] + DJANGO_APPS + THIRD_PARTY_APPS + TASKFLOW_APPS

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "allauth.account.middleware.AccountMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# 실무 서버 기준 DB는 PostgreSQL입니다.
# .env의 DATABASE_URL 예:
# postgresql://postgres:비밀번호@db:5432/taskflow_db
DATABASE_URL = localize_docker_db_host(env("DATABASE_URL", default=None))
if DATABASE_URL:
    DATABASES = {"default": env.db_url_config(DATABASE_URL)}
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": env("POSTGRES_DB"),
            "USER": env("POSTGRES_USER"),
            "PASSWORD": env("POSTGRES_PASSWORD"),
            "HOST": localize_db_host(env("DB_HOST", default="db")),
            "PORT": env("DB_PORT", default="5432"),
        }
    }
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DB_CONN_MAX_AGE", default=60)

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "ko-kr"
TIME_ZONE = "Asia/Seoul"
USE_I18N = True
USE_TZ = True

AUTH_USER_MODEL = "users.User"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
SITE_ID = env.int("SITE_ID", default=1)

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = env("MEDIA_URL", default="/media/")
MEDIA_ROOT = Path(env("MEDIA_ROOT", default=str(BASE_DIR / "media")))

FRONTEND_URL = env("FRONTEND_URL", default="http://localhost:3000")
CORS_ALLOWED_ORIGINS = env.list(
    "CORS_ALLOWED_ORIGINS",
    default=[FRONTEND_URL, "http://localhost:3000", "http://127.0.0.1:3000"],
)
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=CORS_ALLOWED_ORIGINS)

AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=60),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}

REST_AUTH = {
    "USE_JWT": True,
    "JWT_AUTH_COOKIE": "taskflow_access",
    "JWT_AUTH_REFRESH_COOKIE": "taskflow_refresh",
}

ACCOUNT_EMAIL_VERIFICATION = env("ACCOUNT_EMAIL_VERIFICATION", default="optional")
ACCOUNT_UNIQUE_EMAIL = True
ACCOUNT_SIGNUP_FIELDS = ["email*", "username*", "password1*", "password2*"]

SPECTACULAR_SETTINGS = {
    "TITLE": "TaskFlow API",
    "DESCRIPTION": "TaskFlow 업무관리 플랫폼 API 문서",
    "VERSION": "1.0.0",
    "TAGS": [
        {"name": "🔐 인증", "description": "회원가입, 로그인, 토큰 갱신, 생체인식"},
        {"name": "👤 프로필", "description": "내 프로필 조회/수정, 비밀번호 변경, 회원탈퇴"},
        {"name": "🏅 관리자 승격", "description": "관리자 승격 신청서 제출/조회/승인/거절"},
        {"name": "👥 사용자 관리", "description": "전체 사용자 조회, 역할 변경 (CEO/ADMIN 전용)"},
        {"name": "📋 업무요청", "description": "업무요청 생성/조회/수락/거절, 첨부파일"},
        {"name": "📅 일정", "description": "일정 생성/조회/수정/삭제, 공유 일정"},
        {"name": "📝 업무보고", "description": "보고서 작성/제출/확인완료/보완요청/재제출"},
        {"name": "💰 경비지출", "description": "경비보고서+항목 통합 생성/수정, 정산 처리"},
        {"name": "📌 게시판", "description": "자유게시판/공지사항 게시글 CRUD, 첨부파일"},
        {"name": "🗄️ 자료실", "description": "자료실 게시글 CRUD, 열람 권한 설정"},
        {"name": "✅ 할일", "description": "할일 생성/조회/수정/삭제, D-Day 조회"},
    ],
    "SWAGGER_UI_SETTINGS": {
        "deepLinking": True,
        "persistAuthorization": True,
        "displayRequestDuration": True,
        "filter": True,
        "docExpansion": "none",
        "defaultModelsExpandDepth": 1,
    },
    "COMPONENT_SPLIT_REQUEST": True,
    "SORT_OPERATIONS": False,
    "SECURITY": [{"BearerAuth": []}],
    "COMPONENTS": {
        "securitySchemes": {
            "BearerAuth": {
                "type": "http",
                "scheme": "bearer",
                "bearerFormat": "JWT",
                "description": "로그인 후 발급된 Access Token을 입력하세요. 예: eyJ...",
            }
        }
    },
    "SERVE_INCLUDE_SCHEMA": False,
}

REDIS_URL = env("REDIS_URL", default="redis://redis:6379/0")
CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = REDIS_URL
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = "Asia/Seoul"

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {"hosts": [REDIS_URL]},
    }
}

FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 20 * 1024 * 1024
