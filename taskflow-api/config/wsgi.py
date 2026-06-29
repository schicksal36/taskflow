"""WSGI 서버가 Django 애플리케이션을 로드할 때 사용하는 진입점입니다."""

import os

from django.core.wsgi import get_wsgi_application

# Gunicorn/uWSGI 같은 WSGI 서버에서는 운영 설정을 기본으로 사용합니다.
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.prod")

# WSGI callable입니다. 서버는 이 application 객체에 HTTP 요청을 전달합니다.
application = get_wsgi_application()
