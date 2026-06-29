"""알림 모델.

알림은 학교 방송처럼 "누구에게, 어떤 소식을, 어떤 대상과 연결해서" 보여줄지
저장하는 작은 쪽지입니다.
"""

from django.conf import settings
from django.db import models

from apps.common.models import TimeStampedModel


class Notification(TimeStampedModel):
    """사용자별 알림 메시지.

    target_type과 target_id는 알림을 클릭했을 때 이동할 업무요청/보고서/게시글 같은
    원본 도메인을 가리킵니다. 알림 자체는 읽음 여부만 관리하고, 원본 데이터 권한은
    각 도메인 API가 다시 검사합니다.
    """

    class Type(models.TextChoices):
        WORK_REQUEST = "WORK_REQUEST", "업무요청"
        TODO = "TODO", "할일"
        SCHEDULE = "SCHEDULE", "일정"
        BOARD = "BOARD", "게시판"
        REPORT = "REPORT", "보고서"
        EXPENSE = "EXPENSE", "경비"
        SYSTEM = "SYSTEM", "시스템"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    notification_type = models.CharField(max_length=30, choices=Type.choices, default=Type.SYSTEM)
    title = models.CharField(max_length=120)
    message = models.TextField(blank=True)
    target_type = models.CharField(max_length=50, blank=True)
    target_id = models.PositiveIntegerField(null=True, blank=True)
    is_read = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


class NotificationSetting(TimeStampedModel):
    """사용자별 알림 수신 설정.

    업무요청/할 일/일정/게시판/보고서처럼 알림 종류별 수신 여부와 이메일/실시간
    채널 사용 여부를 저장합니다. 설정 row가 없으면 API에서 get_or_create로 만듭니다.
    """

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notification_setting")
    work_request_enabled = models.BooleanField(default=True)
    todo_enabled = models.BooleanField(default=True)
    schedule_enabled = models.BooleanField(default=True)
    board_enabled = models.BooleanField(default=True)
    report_enabled = models.BooleanField(default=True)
    email_enabled = models.BooleanField(default=False)
    realtime_enabled = models.BooleanField(default=True)
