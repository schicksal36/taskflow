"""게시판 API View.

게시글 CRUD, 공지/고정, 좋아요, 댓글, 첨부파일 연결과 다운로드, 알림 생성을 처리합니다.
"""

from io import BytesIO
from zipfile import ZipFile

from django.db import IntegrityError
from django.db.models import Q
from django.http import FileResponse, HttpResponse
from rest_framework import generics, permissions
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.views import APIView

from apps.common.responses import success_response
from apps.notifications.models import Notification
from apps.notifications.services import create_notification

from .models import BoardComment, BoardFile, BoardLike, BoardPost
from .serializers import (
    BoardCommentSerializer,
    BoardFileSerializer,
    BoardPostCreateUpdateSerializer,
    BoardPostDetailSerializer,
    BoardPostListSerializer,
)


class BoardPostQuerysetMixin:
    """게시판 API 공통 조회/권한 믹스인."""

    permission_classes = [permissions.IsAuthenticated]

    def visible_posts(self):
        """삭제 처리되지 않은 게시글만 목록에 노출합니다."""
        user = self.request.user
        role = getattr(user, "role", "")
        qs = BoardPost.objects.filter(is_deleted=False)
        if role in {"ADMIN", "CEO", "SUPERUSER"}:
            return qs
        return qs.filter(
            Q(board_type__in=[BoardPost.BoardType.FREE, BoardPost.BoardType.NOTICE])
            | Q(author=user)
            | Q(permission=BoardPost.BoardPermission.PUBLIC)
            | Q(permission=BoardPost.BoardPermission.DEPARTMENT, author__department=user.department)
            | Q(permission=BoardPost.BoardPermission.SPECIFIC, specific_users=user)
        ).distinct()

    def get_queryset(self):
        return self.visible_posts()

    def get_post(self, pk):
        """삭제되지 않은 게시글 안에서 단건을 찾습니다."""
        return generics.get_object_or_404(self.visible_posts(), pk=pk)

    def ensure_author(self, post):
        """게시글 작성자만 수정/고정/첨부 관리가 가능한지 확인합니다."""
        if post.author != self.request.user:
            raise PermissionDenied("작성자만 처리할 수 있습니다.")

    def ensure_deletable(self, post):
        """작성자와 관리자는 게시글을 삭제할 수 있습니다."""
        role = getattr(self.request.user, "role", "")
        if post.author != self.request.user and role not in {"ADMIN", "CEO", "SUPERUSER"}:
            raise PermissionDenied("작성자 또는 관리자만 삭제할 수 있습니다.")


class BoardPostListCreateView(BoardPostQuerysetMixin, generics.ListCreateAPIView):
    """게시글 목록 조회와 작성 API."""

    search_fields = ["title", "content", "author__username"]
    filterset_fields = ["board_type", "is_notice"]
    ordering_fields = ["created_at", "view_count", "like_count"]

    def get_serializer_class(self):
        return BoardPostCreateUpdateSerializer if self.request.method == "POST" else BoardPostListSerializer

    def perform_create(self, serializer):
        post = serializer.save()
        if post.is_notice or post.board_type == BoardPost.BoardType.NOTICE:
            # 공지는 전체 사용자 알림으로 확장할 수 있습니다. 지금은 작성자에게 생성 확인 알림을 남깁니다.
            create_notification(post.author, Notification.Type.BOARD, "공지사항이 등록되었습니다.", post.title, "BOARD", post.id)


class BoardPostDetailView(BoardPostQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    """게시글 상세 조회, 수정, 소프트 삭제 API."""

    def get_serializer_class(self):
        if self.request.method in {"PATCH", "PUT"}:
            return BoardPostCreateUpdateSerializer
        return BoardPostDetailSerializer

    def retrieve(self, request, *args, **kwargs):
        post = self.get_object()
        # 상세 조회 때마다 view_count를 증가시켜 인기글 정렬에 사용할 수 있게 합니다.
        post.view_count += 1
        post.save(update_fields=["view_count"])
        return success_response(self.get_serializer(post).data)

    def perform_update(self, serializer):
        self.ensure_author(self.get_object())
        serializer.save()

    def perform_destroy(self, instance):
        self.ensure_deletable(instance)
        # 게시글은 이력 보존을 위해 실제 삭제 대신 목록에서 숨깁니다.
        instance.is_deleted = True
        instance.save(update_fields=["is_deleted"])


class BoardPostSearchView(BoardPostListCreateView):
    """게시글 검색 API."""

    pass


class NoticePostListView(BoardPostQuerysetMixin, generics.ListAPIView):
    """공지사항 게시글 목록 API."""

    serializer_class = BoardPostListSerializer

    def get_queryset(self):
        return super().get_queryset().filter(board_type=BoardPost.BoardType.NOTICE)


class BoardPostPinView(BoardPostQuerysetMixin, APIView):
    """게시글 고정/고정해제 공통 API."""

    pinned = True

    def patch(self, request, pk):
        post = self.get_post(pk)
        self.ensure_author(post)
        post.is_pinned = self.pinned
        post.save(update_fields=["is_pinned"])
        message = "게시글을 고정했습니다." if self.pinned else "게시글 고정을 해제했습니다."
        return success_response(BoardPostDetailSerializer(post).data, message)


class BoardPostUnpinView(BoardPostPinView):
    """게시글 고정 해제 API."""

    pinned = False


class BoardPostLikeView(BoardPostQuerysetMixin, APIView):
    """게시글 좋아요와 좋아요 취소 API."""

    def post(self, request, pk):
        post = self.get_post(pk)
        try:
            BoardLike.objects.create(post=post, user=request.user)
        except IntegrityError as exc:
            raise ValidationError("이미 좋아요한 게시글입니다.") from exc
        # unique_together로 중복 좋아요를 막고, 실제 좋아요 row 개수로 카운트를 동기화합니다.
        post.like_count = post.likes.count()
        post.save(update_fields=["like_count"])
        if post.author != request.user:
            create_notification(post.author, Notification.Type.BOARD, "내 게시글에 좋아요가 달렸습니다.", post.title, "BOARD", post.id)
        return success_response(BoardPostDetailSerializer(post).data, "좋아요를 눌렀습니다.")
    def delete(self, request, pk):
        post = self.get_post(pk)
        BoardLike.objects.filter(post=post, user=request.user).delete()
        post.like_count = post.likes.count()
        post.save(update_fields=["like_count"])
        return success_response(BoardPostDetailSerializer(post).data, "좋아요를 취소했습니다.")


class BoardCommentListCreateView(BoardPostQuerysetMixin, generics.ListCreateAPIView):
    """게시글 댓글 목록/작성 API."""

    serializer_class = BoardCommentSerializer

    def get_queryset(self):
        post = self.get_post(self.kwargs["pk"])
        return BoardComment.objects.filter(post=post, is_deleted=False)

    def perform_create(self, serializer):
        post = self.get_post(self.kwargs["pk"])
        comment = serializer.save(post=post, author=self.request.user)
        # 댓글 수는 목록 성능을 위해 게시글에 별도 저장합니다.
        post.comment_count = post.comments.filter(is_deleted=False).count()
        post.save(update_fields=["comment_count"])
        if post.author != self.request.user:
            create_notification(post.author, Notification.Type.BOARD, "내 게시글에 댓글이 달렸습니다.", comment.content, "BOARD", post.id)


class BoardCommentDetailView(generics.RetrieveUpdateDestroyAPIView):
    """게시글 댓글 단건 조회/수정/소프트 삭제 API."""

    serializer_class = BoardCommentSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_url_kwarg = "comment_id"

    def get_queryset(self):
        return BoardComment.objects.filter(is_deleted=False)

    def perform_update(self, serializer):
        if self.get_object().author != self.request.user:
            raise PermissionDenied("작성자만 수정할 수 있습니다.")
        serializer.save()

    def perform_destroy(self, instance):
        if instance.author != self.request.user:
            raise PermissionDenied("작성자만 삭제할 수 있습니다.")
        instance.is_deleted = True
        instance.save(update_fields=["is_deleted"])
        post = instance.post
        # 삭제 후에도 실제 row는 남으므로 is_deleted=False 기준으로 다시 계산합니다.
        post.comment_count = post.comments.filter(is_deleted=False).count()
        post.save(update_fields=["comment_count"])


class BoardFileListCreateView(BoardPostQuerysetMixin, generics.ListCreateAPIView):
    """게시글 첨부파일 목록/연결 API."""

    serializer_class = BoardFileSerializer

    def get_queryset(self):
        post = self.get_post(self.kwargs["pk"])
        return BoardFile.objects.filter(post=post)

    def perform_create(self, serializer):
        post = self.get_post(self.kwargs["pk"])
        self.ensure_author(post)
        serializer.save(post=post, uploaded_by=self.request.user)


class BoardFileDetailView(generics.RetrieveDestroyAPIView):
    """게시글 첨부파일 연결 조회/삭제 API."""

    serializer_class = BoardFileSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_url_kwarg = "file_id"

    def get_queryset(self):
        return BoardFile.objects.filter(post__is_deleted=False)

    def perform_destroy(self, instance):
        if instance.uploaded_by != self.request.user and instance.post.author != self.request.user:
            raise PermissionDenied("업로드한 사용자 또는 작성자만 삭제할 수 있습니다.")
        instance.delete()


class BoardFileDownloadView(APIView):
    """게시글 첨부파일 원본 다운로드 API."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, file_id):
        board_file = generics.get_object_or_404(BoardFile.objects.filter(post__is_deleted=False), pk=file_id)
        if not BoardPost.objects.filter(pk=board_file.post_id, is_deleted=False).filter(
            Q(board_type__in=[BoardPost.BoardType.FREE, BoardPost.BoardType.NOTICE])
            | Q(author=request.user)
            | Q(permission=BoardPost.BoardPermission.PUBLIC)
            | Q(permission=BoardPost.BoardPermission.DEPARTMENT, author__department=request.user.department)
            | Q(permission=BoardPost.BoardPermission.SPECIFIC, specific_users=request.user)
        ).exists() and getattr(request.user, "role", "") not in {"ADMIN", "CEO", "SUPERUSER"}:
            raise PermissionDenied("자료실 접근 권한이 없습니다.")
        media = board_file.media_file
        return FileResponse(media.file.open("rb"), as_attachment=True, filename=media.original_name)


class BoardAttachmentDownloadView(BoardPostQuerysetMixin, APIView):
    """게시글 첨부파일 개별 다운로드 API."""

    def get(self, request, pk, fid):
        post = self.get_post(pk)
        board_file = generics.get_object_or_404(BoardFile.objects.filter(post=post), pk=fid)
        media = board_file.media_file
        return FileResponse(media.file.open("rb"), as_attachment=True, filename=media.original_name)


class BoardAttachmentDownloadAllView(BoardPostQuerysetMixin, APIView):
    """게시글 첨부파일 전체 zip 다운로드 API."""

    def get(self, request, pk):
        post = self.get_post(pk)
        buffer = BytesIO()
        with ZipFile(buffer, "w") as zip_file:
            for board_file in BoardFile.objects.filter(post=post).select_related("media_file"):
                media = board_file.media_file
                zip_file.writestr(media.original_name, media.file.read())
        buffer.seek(0)
        response = HttpResponse(buffer.getvalue(), content_type="application/zip")
        response["Content-Disposition"] = f'attachment; filename="board-{post.id}-attachments.zip"'
        return response


class BoardPermissionView(BoardPostQuerysetMixin, APIView):
    """자료실 게시글 공개 범위를 변경합니다."""

    def patch(self, request, pk):
        post = self.get_post(pk)
        self.ensure_author(post)
        if post.board_type != BoardPost.BoardType.DATA_ROOM:
            raise ValidationError("자료실 게시글만 권한을 설정할 수 있습니다.")
        permission_value = request.data.get("permission", BoardPost.BoardPermission.PUBLIC)
        if permission_value not in BoardPost.BoardPermission.values:
            raise ValidationError("올바른 권한 값이 아닙니다.")
        post.permission = permission_value
        post.save(update_fields=["permission"])
        user_ids = request.data.get("specific_user_ids", [])
        if isinstance(user_ids, list):
            post.specific_users.set(user_ids)
        return success_response(BoardPostDetailSerializer(post, context={"request": request}).data, "자료실 권한이 변경되었습니다.")
