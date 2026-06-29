# Django가 "config.settings"를 설정 모듈로 읽을 때 기본적으로 개발 설정을 사용합니다.
# ASGI/WSGI는 prod.py를 직접 지정하므로 서버 배포 진입점과 로컬 실행 진입점이 분리됩니다.
from .dev import *  # noqa: F401,F403
