"""업무요청 모델.

업무요청은 "누가 누구에게 어떤 일을 부탁했는지" 적어두는 종이쪽지와 같습니다.
상태가 바뀌면 쪽지 위에 진행중, 완료요청, 승인 같은 스티커를 붙인다고 생각하면 쉽습니다.
"""

from django.conf import settings
from django.db import models

from apps.common.models import Priority, TimeStampedModel


class WorkRequest(TimeStampedModel):
    """업무요청의 본문과 처리 상태.

    requester는 일을 요청한 사람이고 assignee는 처리 담당자입니다.
    새 요청은 PENDING 상태로 시작하고, 담당자가 ACCEPTED로 수락하면 Todo가 생성됩니다.
    완료 처리는 담당자가 COMPLETED로 올리고 requester가 APPROVED/REJECTED로
    최종 판정하는 2단계 흐름입니다.
    """

    class Status(models.TextChoices):
        PENDING = "PENDING", "대기"
        ACCEPTED = "ACCEPTED", "수락"
        REQUESTED = "REQUESTED", "요청됨"
        ASSIGNED = "ASSIGNED", "담당자 지정"
        IN_PROGRESS = "IN_PROGRESS", "진행중"
        ON_HOLD = "ON_HOLD", "보류"
        COMPLETED = "COMPLETED", "완료 요청"
        APPROVED = "APPROVED", "승인 완료"
        REJECTED = "REJECTED", "반려"
        CANCELED = "CANCELED", "취소"

    title = models.CharField(max_length=200)
    content = models.TextField()
    requester = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="created_work_requests")
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_work_requests",
    )
    assignees = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="multi_assigned_work_requests")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    priority = models.CharField(max_length=20, choices=Priority.choices, default=Priority.NORMAL)
    deadline_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    rejected_reason = models.TextField(blank=True)

    class Meta:
        # 요청자/담당자별 상태 목록과 마감일 기반 대시보드 조회가 많아 인덱스를 둡니다.
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["requester", "status"]),
            models.Index(fields=["assignee", "status"]),
            models.Index(fields=["deadline_at"]),
        ]

    def __str__(self):
        return self.title


class WorkRequestComment(TimeStampedModel):
    """업무요청 댓글.

    업무 진행 중 질문, 처리 메모, 반려 사유 보충처럼 요청자와 담당자가 공유해야 하는
    대화를 WorkRequest 아래에 시간순으로 저장합니다.
    """

    work_request = models.ForeignKey(WorkRequest, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    content = models.TextField()

    class Meta:
        ordering = ["created_at"]


class WorkRequestFile(TimeStampedModel):
    """업무요청과 MediaFile을 연결하는 첨부파일 모델."""

    work_request = models.ForeignKey(WorkRequest, on_delete=models.CASCADE, related_name="files")
    media_file = models.ForeignKey("media_files.MediaFile", on_delete=models.CASCADE)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)


class WorkRequestReadRecord(models.Model):
    """업무요청 담당자별 최초 열람 기록."""

    work_request = models.ForeignKey(WorkRequest, on_delete=models.CASCADE, related_name="read_records")
    assignee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="work_request_read_records")
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ["work_request", "assignee"]
        indexes = [
            models.Index(fields=["assignee", "is_read"]),
            models.Index(fields=["work_request", "read_at"]),
        ]
