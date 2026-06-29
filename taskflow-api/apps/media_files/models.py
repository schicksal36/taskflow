"""공통 파일 업로드 모델."""

from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.db import models

from apps.common.models import TimeStampedModel


def upload_to(instance, filename):
    """원본 파일명 대신 UUID 파일명으로 저장해 충돌과 한글 경로 문제를 줄입니다."""

    ext = Path(filename).suffix.lower()
    folder = instance.upload_folder or "uploads"
    return f"{folder}/{uuid4().hex}{ext}"


class MediaFile(TimeStampedModel):
    """업로드 파일 메타데이터.

    실제 파일은 FileField가 MEDIA_ROOT 아래에 저장하고, 이 모델은 원본명, 저장명,
    MIME 타입, 크기, 업로드 사용자, 어느 도메인에 연결된 파일인지(target_app/target_id)를
    기록합니다. 삭제는 is_deleted=True로 처리해 첨부 이력을 추적할 수 있게 합니다.
    """

    class FileType(models.TextChoices):
        IMAGE = "IMAGE", "이미지"
        EXCEL = "EXCEL", "엑셀"
        PDF = "PDF", "PDF"
        ETC = "ETC", "기타"

    file = models.FileField(upload_to=upload_to)
    original_name = models.CharField(max_length=255)
    stored_name = models.CharField(max_length=255, blank=True)
    file_type = models.CharField(max_length=20, choices=FileType.choices, default=FileType.ETC)
    mime_type = models.CharField(max_length=120, blank=True)
    size = models.PositiveIntegerField(default=0)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="media_files")
    target_app = models.CharField(max_length=50, blank=True)
    target_id = models.PositiveIntegerField(null=True, blank=True)
    upload_folder = models.CharField(max_length=50, default="uploads")
    is_deleted = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.original_name


class AsyncTaskLog(TimeStampedModel):
    """Celery 등 비동기 작업의 진행 상태 기록.

    Excel 파싱, PDF/Excel 생성, 파일 검사처럼 요청 즉시 끝나지 않을 수 있는 작업은
    먼저 이 테이블에 PENDING 로그를 만들고 task_id를 클라이언트에 돌려줍니다.
    클라이언트는 task_id로 상태 조회 API를 호출해 진행 결과를 확인합니다.
    """

    class Status(models.TextChoices):
        PENDING = "PENDING", "대기"
        STARTED = "STARTED", "시작"
        SUCCESS = "SUCCESS", "성공"
        FAILURE = "FAILURE", "실패"
        RETRY = "RETRY", "재시도"

    class TaskType(models.TextChoices):
        EMAIL_SEND = "EMAIL_SEND", "이메일 발송"
        PDF_GENERATE = "PDF_GENERATE", "PDF 생성"
        EXCEL_GENERATE = "EXCEL_GENERATE", "엑셀 생성"
        EXCEL_PARSE = "EXCEL_PARSE", "엑셀 파싱"
        FILE_SCAN = "FILE_SCAN", "파일 검사"
        DUE_NOTIFICATION = "DUE_NOTIFICATION", "마감 알림"

    task_id = models.CharField(max_length=120, unique=True)
    task_type = models.CharField(max_length=30, choices=TaskType.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    result_file = models.ForeignKey(MediaFile, null=True, blank=True, on_delete=models.SET_NULL)
    error_message = models.TextField(blank=True)

    class Meta:
        ordering = ["-created_at"]
