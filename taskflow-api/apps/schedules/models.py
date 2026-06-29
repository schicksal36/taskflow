"""[일정] models.py - 공유 일정 앱 모델.

역할: 개인 일정 없이 모든 일정을 공유 일정으로 저장하고 참여자 열람 권한을 관리
관련 모델: Schedule, ScheduleParticipant
작성기준: 모든 일정은 생성자 또는 참여자에게 노출
"""

from django.conf import settings
from django.db import models

from apps.common.models import TimeStampedModel


class Schedule(TimeStampedModel):
    """공유 일정 본문 모델.

    created_by는 일정을 만든 사용자이며, participants에 등록된 사용자도 열람할 수
    있습니다. 개인 일정 플래그는 두지 않고 모든 레코드를 공유 일정으로 처리합니다.
    """

    class ScheduleType(models.TextChoices):
        WORK = "WORK", "업무"
        MEETING = "MEETING", "회의"
        TODO = "TODO", "할일"
        WORK_REQUEST = "WORK_REQUEST", "업무요청"

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="created_schedules")
    title = models.CharField(max_length=200)  # 일정 제목
    description = models.TextField(blank=True)  # 일정 상세 설명
    location = models.CharField(max_length=200, blank=True)  # 장소
    start_at = models.DateTimeField()  # 시작 일시
    end_at = models.DateTimeField(null=True, blank=True)  # 종료 일시
    color = models.CharField(max_length=7, default="#4A90D9")  # HEX 색상
    alert_at = models.DateTimeField(null=True, blank=True)  # 알림 일시
    category = models.CharField(max_length=50, blank=True)  # 공유 일정 구분

    class Meta:
        # 캘린더는 시간 순서 표시가 기본이므로 start_at 기준으로 정렬합니다.
        ordering = ["start_at", "id"]
        # 사용자별 일정 목록과 날짜 범위 조회가 가장 빈번해 두 인덱스를 둡니다.
        indexes = [
            models.Index(fields=["created_by", "start_at"]),
            models.Index(fields=["start_at", "end_at"]),
        ]

    def __str__(self):
        return self.title


class ScheduleParticipant(TimeStampedModel):
    """공유 일정 참여자와 참석 응답 모델.

    unique_together로 같은 일정에 같은 사용자가 중복 초대되지 않게 막습니다.
    """

    class Response(models.TextChoices):
        PENDING = "PENDING", "대기"
        ACCEPTED = "ACCEPTED", "참석"
        DECLINED = "DECLINED", "불참"
        TENTATIVE = "TENTATIVE", "미정"

    schedule = models.ForeignKey(Schedule, on_delete=models.CASCADE, related_name="participants")  # 대상 일정
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="shared_schedules")  # 참여자
    response = models.CharField(max_length=20, choices=Response.choices, default=Response.PENDING)  # 참석 응답

    class Meta:
        unique_together = ["schedule", "user"]
