"""사내 게시판 모델.

게시글, 댓글, 좋아요, 첨부파일을 분리해 저장합니다. 게시글/댓글은 실제 삭제 대신
is_deleted로 숨김 처리해 운영자가 이력을 추적할 수 있게 합니다.
"""

from django.conf import settings
from django.db import models

from apps.common.models import TimeStampedModel


class BoardPost(TimeStampedModel):
    """게시글 본문 모델.

    is_notice는 공지 여부, is_pinned는 목록 상단 고정 여부입니다. view_count,
    like_count, comment_count는 목록 성능을 위해 denormalized count로 저장하고
    View에서 관련 이벤트가 생길 때 다시 계산합니다.
    """

    class BoardType(models.TextChoices):
        NOTICE = "NOTICE", "공지사항"
        FREE = "FREE", "자유게시판"
        DATA_ROOM = "DATA_ROOM", "자료실"

    class BoardPermission(models.TextChoices):
        PUBLIC = "PUBLIC", "전체공개"
        DEPARTMENT = "DEPARTMENT", "부서공개"
        SPECIFIC = "SPECIFIC", "지정인원"

    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="board_posts")
    board_type = models.CharField(max_length=30, choices=BoardType.choices, default=BoardType.FREE)
    title = models.CharField(max_length=200)
    content = models.TextField()
    is_notice = models.BooleanField(default=False)
    is_pinned = models.BooleanField(default=False)
    view_count = models.PositiveIntegerField(default=0)
    like_count = models.PositiveIntegerField(default=0)
    comment_count = models.PositiveIntegerField(default=0)
    is_deleted = models.BooleanField(default=False)
    permission = models.CharField(max_length=20, choices=BoardPermission.choices, default=BoardPermission.PUBLIC)
    specific_users = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="permitted_board_posts")

    class Meta:
        # 고정글을 먼저 보여주고, 같은 그룹 안에서는 최신글이 먼저 보이게 합니다.
        ordering = ["-is_pinned", "-created_at"]
        indexes = [
            models.Index(fields=["board_type", "is_deleted"]),
            models.Index(fields=["author", "created_at"]),
        ]

    def __str__(self):
        return self.title


class BoardComment(TimeStampedModel):
    """게시글 댓글 모델.

    parent를 통해 대댓글 구조를 확장할 수 있습니다. 삭제는 is_deleted=True로 처리해
    댓글 수와 이력을 안정적으로 관리합니다.
    """

    post = models.ForeignKey(BoardPost, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.CASCADE, related_name="replies")
    content = models.TextField()
    is_deleted = models.BooleanField(default=False)

    class Meta:
        ordering = ["created_at"]


class BoardLike(TimeStampedModel):
    """게시글 좋아요 모델.

    unique_together로 사용자가 같은 게시글에 좋아요를 여러 번 누를 수 없게 합니다.
    """

    post = models.ForeignKey(BoardPost, on_delete=models.CASCADE, related_name="likes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)

    class Meta:
        unique_together = ["post", "user"]


class BoardFile(TimeStampedModel):
    """게시글과 MediaFile을 연결하는 첨부파일 모델."""

    post = models.ForeignKey(BoardPost, on_delete=models.CASCADE, related_name="files")
    media_file = models.ForeignKey("media_files.MediaFile", on_delete=models.CASCADE)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
