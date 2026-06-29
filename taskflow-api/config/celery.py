"""Celery 앱 설정.

Celery는 오래 걸리는 일을 뒤에서 처리하는 일꾼입니다.
예를 들어 PDF 만들기가 10초 걸린다면 사용자를 기다리게 하지 않고,
"작업 접수!"라고 먼저 답한 뒤 일꾼이 천천히 처리하게 합니다.
"""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.prod")

app = Celery("taskflow")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
