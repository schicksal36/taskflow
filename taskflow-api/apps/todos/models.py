"""개인 할일과 체크리스트 모델.

Todo는 사용자 개인 업무를 관리하는 상위 단위이고, TodoItem은 Todo 안에서 세부
체크리스트를 관리하는 하위 단위입니다.
"""

from django.conf import settings
from django.db import models

from apps.common.models import Priority, TimeStampedModel


class Todo(TimeStampedModel):
    """사용자 개인 할 일.

    user 기준으로 완전히 분리되는 개인 데이터입니다. 완료 API는 status를 DONE으로
    바꾸면서 completed_at을 기록하고, 완료 취소 API는 status를 TODO로 되돌리면서
    completed_at을 비웁니다.
    """

    class Status(models.TextChoices):
        TODO = "TODO", "할일"
        DOING = "DOING", "진행중"
        DONE = "DONE", "완료"
        CANCELED = "CANCELED", "취소"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="todos")
    title = models.CharField(max_length=200)
    content = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.TODO)
    priority = models.CharField(max_length=20, choices=Priority.choices, default=Priority.NORMAL)
    deadline_at = models.DateTimeField(null=True, blank=True)
    remind_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        # 사용자별 상태 목록과 마감일 기반 대시보드 조회를 빠르게 처리합니다.
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "status"]),
            models.Index(fields=["deadline_at"]),
        ]

    def __str__(self):
        return self.title


class TodoItem(TimeStampedModel):
    """Todo 하위 체크리스트 항목.

    is_checked와 checked_at을 함께 저장해 단순 체크 여부뿐 아니라 언제 체크했는지도
    기록합니다. sort_order는 프론트에서 사용자가 항목 순서를 정렬할 수 있게 둔 필드입니다.
    """

    todo = models.ForeignKey(Todo, on_delete=models.CASCADE, related_name="items")
    content = models.CharField(max_length=255)
    is_checked = models.BooleanField(default=False)
    checked_at = models.DateTimeField(null=True, blank=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "id"]
