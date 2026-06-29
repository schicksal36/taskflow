#!/usr/bin/env python
"""Django 관리 명령 실행 진입점입니다."""
import os
import sys


def main():
    """runserver, migrate, createsuperuser 같은 Django 관리 명령을 실행합니다."""

    # 로컬에서 manage.py를 실행하면 개발 설정을 기본으로 사용합니다.
    # 이미 DJANGO_SETTINGS_MODULE이 외부에서 지정된 경우에는 그 값을 존중합니다.
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    # CLI 인자를 Django management command로 넘깁니다.
    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()
